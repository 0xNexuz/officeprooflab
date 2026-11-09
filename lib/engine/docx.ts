// Reads a .docx package into the engine's document model: paragraphs with their heading level, tables, page setup, images and review marks.
import { deep, kid, kids, path, walk, type Package, type XNode } from './zip.ts';
import { EngineError, type DocBlock, type DocumentModel } from './types.ts';

/** Marks a table cell that is covered by the merged cell to its left. */
export const MERGED = '\u0000';

function paragraphText(node: XNode): string {
  let out = '';
  const visit = (item: XNode) => {
    if (item.name === 'w:del' || item.name === 'w:moveFrom' || item.name === 'w:instrText') return;
    if (item.name === 'w:t') { out += item.text; return; }
    if (item.name === 'w:tab') { out += '\t'; return; }
    if (item.name === 'w:br' || item.name === 'w:cr') { out += '\n'; return; }
    for (const child of item.children) visit(child);
  };
  visit(node);
  return out;
}

export function readDocument(pkg: Package): DocumentModel {
  const root = pkg.xml('word/document.xml');
  const body = kid(root, 'w:body');
  if (!body) throw new EngineError('corrupt', 'The document has no body');
  const rels = pkg.rels('word/document.xml');

  // Styles: heading level by style name or outline level, following "based on".
  const styles = new Map<string, { name: string; level: number | null; basedOn: string | null }>();
  const stylesRoot = pkg.xml('word/styles.xml');
  for (const style of kids(stylesRoot, 'w:style')) {
    const name = kid(style, 'w:name')?.attrs['w:val'] ?? '';
    const heading = /^heading (\d)$/i.exec(name);
    const outline = path(style, 'w:pPr', 'w:outlineLvl')?.attrs['w:val'];
    styles.set(style.attrs['w:styleId'] ?? '', { name, level: heading ? Number(heading[1]) : outline !== undefined ? Number(outline) + 1 : /^title$/i.test(name) ? 0 : null,
      basedOn: kid(style, 'w:basedOn')?.attrs['w:val'] ?? null });
  }
  const levelOf = (styleId: string): number | null => {
    for (let id: string | null = styleId, hops = 0; id && hops < 10; hops++) {
      const style = styles.get(id);
      if (!style) return null;
      if (style.level !== null) return style.level;
      id = style.basedOn;
    }
    return null;
  };
  const defaultFont = path(stylesRoot, 'w:docDefaults', 'w:rPrDefault', 'w:rPr', 'w:rFonts')?.attrs['w:ascii'] ?? null;

  const blocks: DocBlock[] = [];
  const fonts = new Set<string>();
  const images: DocumentModel['images'] = [];
  let tableIndex = 0;
  let words = 0;
  const countWords = (text: string) => { words += (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length; };

  const collectImages = (node: XNode) => {
    for (const drawing of deep(node, 'w:drawing')) {
      const blip = deep(drawing, 'a:blip')[0];
      const id = blip?.attrs['r:embed'] ?? blip?.attrs['r:link'];
      const rel = id ? rels.get(id) : undefined;
      const described = deep(drawing, 'wp:docPr').some(item => (item.attrs.descr ?? '').trim());
      if (id) images.push({ target: rel?.target ?? id, missing: !rel || (!rel.external && !pkg.names.has(rel.target)), alt: described });
    }
    for (const image of deep(node, 'v:imagedata')) {
      const rel = rels.get(image.attrs['r:id'] ?? '');
      images.push({ target: rel?.target ?? image.attrs['r:id'] ?? '', missing: !rel || (!rel.external && !pkg.names.has(rel.target)), alt: Boolean(image.attrs['o:title']) });
    }
  };

  const visit = (node: XNode) => {
    if (node.name === 'w:p') {
      const pPr = kid(node, 'w:pPr');
      const styleId = kid(pPr, 'w:pStyle')?.attrs['w:val'] ?? '';
      const outline = kid(pPr, 'w:outlineLvl')?.attrs['w:val'];
      const level = outline !== undefined && Number(outline) < 9 ? Number(outline) + 1 : levelOf(styleId) ?? -1;
      const text = paragraphText(node);
      const runFonts = new Set<string>();
      for (const item of walk(node)) if (item.name === 'w:rFonts' && item.attrs['w:ascii']) { runFonts.add(item.attrs['w:ascii']); fonts.add(item.attrs['w:ascii']); }
      const hasDrawing = deep(node, 'w:drawing').length > 0 || deep(node, 'w:pict').length > 0;
      collectImages(node);
      countWords(text);
      blocks.push({ type: 'p', index: blocks.length, text, style: styles.get(styleId)?.name ?? styleId, level, list: Boolean(kid(pPr, 'w:numPr')), fonts: [...runFonts], empty: !text.trim() && !hasDrawing });
    } else if (node.name === 'w:tbl') {
      const rows: string[][] = [];
      for (const tr of kids(node, 'w:tr')) {
        const row: string[] = [];
        for (const tc of kids(tr, 'w:tc')) {
          const text = kids(tc, 'w:p').map(paragraphText).join('\n').trim();
          countWords(text);
          row.push(text);
          const span = Number(path(tc, 'w:tcPr', 'w:gridSpan')?.attrs['w:val'] ?? 1);
          for (let i = 1; i < span; i++) row.push(MERGED);
          collectImages(tc);
        }
        rows.push(row);
      }
      blocks.push({ type: 'table', index: blocks.length, tableIndex: tableIndex++, rows });
    } else if (node.name === 'w:sdt') {
      for (const child of kids(kid(node, 'w:sdtContent'), 'w:p').concat(kids(kid(node, 'w:sdtContent'), 'w:tbl'))) visit(child);
    }
  };
  for (const child of body.children) visit(child);

  const sect = kids(body, 'w:sectPr').pop() ?? deep(body, 'w:sectPr').pop() ?? null;
  const size = kid(sect, 'w:pgSz'), margin = kid(sect, 'w:pgMar');
  const page = size ? {
    width: Number(size.attrs['w:w'] ?? 0), height: Number(size.attrs['w:h'] ?? 0),
    orientation: (size.attrs['w:orient'] === 'landscape' || Number(size.attrs['w:w']) > Number(size.attrs['w:h']) ? 'landscape' : 'portrait') as 'portrait' | 'landscape',
    margins: { top: Number(margin?.attrs['w:top'] ?? 0), right: Number(margin?.attrs['w:right'] ?? 0), bottom: Number(margin?.attrs['w:bottom'] ?? 0), left: Number(margin?.attrs['w:left'] ?? 0) },
  } : null;

  const partText = (type: string) => [...rels.values()].filter(rel => rel.type === type).map(rel => deep(pkg.xml(rel.target), 'w:p').map(paragraphText).join('\n').trim()).filter(Boolean);
  const commentsPath = [...rels.values()].find(rel => rel.type === 'comments')?.target;
  return {
    kind: 'docx', blocks, page, fonts: [...fonts].sort(), defaultFont, images,
    comments: commentsPath ? kids(pkg.xml(commentsPath), 'w:comment').length : 0,
    trackedChanges: deep(body, 'w:ins').length + deep(body, 'w:del').length,
    headers: partText('header'), footers: partText('footer'), words,
  };
}
