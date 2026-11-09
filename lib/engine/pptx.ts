// Reads a .pptx package into the engine's deck model: each slide's shapes with their position, text and font sizes.
import { deep, kid, kids, path, type Package, type XNode } from './zip.ts';
import { EngineError, type Deck, type Slide, type SlideShape } from './types.ts';

type Box = { x: number; y: number; w: number; h: number };
type Frame = { sx: number; sy: number; ox: number; oy: number };

function xfrm(node: XNode | null): Box | null {
  const off = kid(node, 'a:off'), ext = kid(node, 'a:ext');
  if (!off || !ext) return null;
  return { x: Number(off.attrs.x ?? 0), y: Number(off.attrs.y ?? 0), w: Number(ext.attrs.cx ?? 0), h: Number(ext.attrs.cy ?? 0) };
}

function textOf(txBody: XNode | null) {
  const paragraphs: string[] = [];
  const sizes: number[] = [];
  const fonts = new Set<string>();
  for (const p of kids(txBody, 'a:p')) {
    let text = '';
    for (const child of p.children) {
      if (child.name === 'a:r' || child.name === 'a:fld') {
        text += kid(child, 'a:t')?.text ?? '';
        const rPr = kid(child, 'a:rPr');
        if (rPr?.attrs.sz) sizes.push(Number(rPr.attrs.sz) / 100);
        const face = kid(rPr, 'a:latin')?.attrs.typeface;
        if (face) fonts.add(face);
      } else if (child.name === 'a:br') text += '\n';
    }
    paragraphs.push(text);
  }
  const bodyPr = kid(txBody, 'a:bodyPr');
  return { paragraphs, sizes, fonts: [...fonts], autofit: Boolean(kid(bodyPr, 'a:normAutofit') || kid(bodyPr, 'a:spAutoFit')) };
}

/** Placeholder boxes of a layout or master, by type and index, so a slide shape without its own position can inherit one. */
function placeholderBoxes(root: XNode | null) {
  const boxes = new Map<string, Box>();
  for (const sp of deep(path(root, 'p:cSld', 'p:spTree'), 'p:sp')) {
    const ph = path(sp, 'p:nvSpPr', 'p:nvPr', 'p:ph');
    const box = xfrm(path(sp, 'p:spPr', 'a:xfrm'));
    if (!ph || !box) continue;
    if (ph.attrs.idx !== undefined) boxes.set(`idx:${ph.attrs.idx}`, box);
    boxes.set(`type:${ph.attrs.type ?? 'body'}`, box);
  }
  return boxes;
}

export function readDeck(pkg: Package): Deck {
  const root = pkg.xml('ppt/presentation.xml');
  if (!root) throw new EngineError('corrupt', 'The presentation has no main part');
  const rels = pkg.rels('ppt/presentation.xml');
  const sizeNode = kid(root, 'p:sldSz');
  const size = { w: Number(sizeNode?.attrs.cx ?? 9144000), h: Number(sizeNode?.attrs.cy ?? 6858000) };
  const deckFonts = new Set<string>();
  const themeFonts: Deck['themeFonts'] = { major: null, minor: null };
  const layoutCache = new Map<string, { name: string; boxes: Map<string, Box>; master: Map<string, Box> }>();

  const layoutOf = (layoutPath: string | undefined) => {
    if (!layoutPath) return null;
    if (!layoutCache.has(layoutPath)) {
      const layout = pkg.xml(layoutPath);
      const masterPath = [...pkg.rels(layoutPath).values()].find(rel => rel.type === 'slideMaster')?.target;
      if (masterPath && themeFonts.major === null) {
        const themePath = [...pkg.rels(masterPath).values()].find(rel => rel.type === 'theme')?.target;
        const scheme = deep(themePath ? pkg.xml(themePath) : null, 'a:fontScheme')[0];
        themeFonts.major = path(scheme, 'a:majorFont', 'a:latin')?.attrs.typeface ?? null;
        themeFonts.minor = path(scheme, 'a:minorFont', 'a:latin')?.attrs.typeface ?? null;
      }
      layoutCache.set(layoutPath, { name: kid(layout, 'p:cSld')?.attrs.name ?? '', boxes: placeholderBoxes(layout), master: placeholderBoxes(masterPath ? pkg.xml(masterPath) : null) });
    }
    return layoutCache.get(layoutPath)!;
  };

  const slides: Slide[] = [];
  for (const entry of kids(kid(root, 'p:sldIdLst'), 'p:sldId')) {
    const slidePath = rels.get(entry.attrs['r:id'] ?? '')?.target;
    const slideRoot = slidePath ? pkg.xml(slidePath) : null;
    if (!slidePath || !slideRoot) continue;
    const slideRels = pkg.rels(slidePath);
    const layout = layoutOf([...slideRels.values()].find(rel => rel.type === 'slideLayout')?.target);
    const shapes: SlideShape[] = [];

    const place = (box: Box | null, frame: Frame): Box | null => box ? { x: frame.ox + box.x * frame.sx, y: frame.oy + box.y * frame.sy, w: box.w * frame.sx, h: box.h * frame.sy } : null;
    const visit = (node: XNode, frame: Frame) => {
      for (const child of node.children) {
        if (child.name === 'p:grpSp') {
          const group = path(child, 'p:grpSpPr', 'a:xfrm');
          const box = xfrm(group), chOff = kid(group, 'a:chOff'), chExt = kid(group, 'a:chExt');
          if (box && chOff && chExt && Number(chExt.attrs.cx) > 0 && Number(chExt.attrs.cy) > 0) {
            const sx = frame.sx * box.w / Number(chExt.attrs.cx), sy = frame.sy * box.h / Number(chExt.attrs.cy);
            visit(child, { sx, sy, ox: frame.ox + box.x * frame.sx - Number(chOff.attrs.x ?? 0) * sx, oy: frame.oy + box.y * frame.sy - Number(chOff.attrs.y ?? 0) * sy });
          } else visit(child, frame);
          continue;
        }
        if (child.name !== 'p:sp' && child.name !== 'p:pic' && child.name !== 'p:graphicFrame' && child.name !== 'p:cxnSp') continue;
        const nv = kid(child, child.name === 'p:sp' ? 'p:nvSpPr' : child.name === 'p:pic' ? 'p:nvPicPr' : child.name === 'p:cxnSp' ? 'p:nvCxnSpPr' : 'p:nvGraphicFramePr');
        const props = kid(nv, 'p:cNvPr');
        const ph = path(nv, 'p:nvPr', 'p:ph');
        const placeholder = ph ? ph.attrs.type ?? 'body' : null;
        let box = place(xfrm(child.name === 'p:graphicFrame' ? kid(child, 'p:xfrm') : path(child, 'p:spPr', 'a:xfrm')), frame);
        if (!box && ph && layout) {
          const keys = [ph.attrs.idx !== undefined ? `idx:${ph.attrs.idx}` : '', `type:${placeholder}`].filter(Boolean);
          const inherited = keys.map(key => layout.boxes.get(key)).find(Boolean) ?? keys.map(key => layout.master.get(key)).find(Boolean)
            ?? (placeholder === 'ctrTitle' ? layout.master.get('type:title') : placeholder === 'subTitle' ? layout.master.get('type:body') : undefined);
          if (inherited) box = { ...inherited };
        }
        const base = { id: props?.attrs.id ?? String(shapes.length + 1), name: props?.attrs.name ?? '', placeholder, box, missingMedia: false };
        if (child.name === 'p:pic') {
          const id = deep(child, 'a:blip')[0]?.attrs['r:embed'];
          const rel = id ? slideRels.get(id) : undefined;
          shapes.push({ ...base, type: 'picture', text: '', paragraphs: [], minFont: null, maxFont: null, fonts: [], autofit: false,
            missingMedia: Boolean(id) && (!rel || (!rel.external && !pkg.names.has(rel.target))) });
        } else if (child.name === 'p:graphicFrame') {
          const table = deep(child, 'a:tbl')[0];
          const cells = table ? deep(table, 'a:tc').map(tc => textOf(kid(tc, 'a:txBody')).paragraphs.join(' ')) : [];
          shapes.push({ ...base, type: table ? 'table' : deep(child, 'c:chart').length ? 'chart' : 'other', text: cells.join(' | '), paragraphs: cells, minFont: null, maxFont: null, fonts: [], autofit: false });
        } else if (child.name === 'p:sp') {
          const body = textOf(kid(child, 'p:txBody'));
          for (const font of body.fonts) if (!font.startsWith('+')) deckFonts.add(font);
          const hasFill = Boolean(kid(kid(child, 'p:spPr'), 'a:solidFill') || kid(kid(child, 'p:spPr'), 'a:gradFill') || kid(kid(child, 'p:spPr'), 'a:blipFill'));
          const text = body.paragraphs.join('\n').trim();
          shapes.push({ ...base, type: text || ph || kid(child, 'p:txBody') ? (text || ph ? 'text' : hasFill ? 'other' : 'text') : 'other', text, paragraphs: body.paragraphs,
            minFont: body.sizes.length ? Math.min(...body.sizes) : null, maxFont: body.sizes.length ? Math.max(...body.sizes) : null, fonts: body.fonts, autofit: body.autofit });
        } else {
          shapes.push({ ...base, type: 'other', text: '', paragraphs: [], minFont: null, maxFont: null, fonts: [], autofit: false });
        }
      }
    };
    const tree = path(slideRoot, 'p:cSld', 'p:spTree');
    if (tree) visit(tree, { sx: 1, sy: 1, ox: 0, oy: 0 });
    // The title is the title placeholder; a deck built from plain text boxes has none, so the largest text in the top third stands in.
    let titleShape = shapes.find(shape => (shape.placeholder === 'title' || shape.placeholder === 'ctrTitle') && shape.text);
    if (!titleShape && !shapes.some(shape => shape.placeholder === 'title' || shape.placeholder === 'ctrTitle')) {
      const top = shapes.filter(shape => shape.type === 'text' && shape.text && shape.box && shape.box.y < size.h * 0.34 && (shape.maxFont ?? 0) >= 20);
      const largest = Math.max(0, ...shapes.filter(shape => shape.type === 'text' && shape.text).map(shape => shape.maxFont ?? 0));
      titleShape = top.sort((a, b) => (b.maxFont ?? 0) - (a.maxFont ?? 0) || a.box!.y - b.box!.y).find(shape => (shape.maxFont ?? 0) >= largest);
    }
    const notesPath = [...slideRels.values()].find(rel => rel.type === 'notesSlide')?.target;
    const notes = notesPath ? deep(pkg.xml(notesPath), 'p:sp').filter(sp => path(sp, 'p:nvSpPr', 'p:nvPr', 'p:ph')?.attrs.type === 'body').map(sp => textOf(kid(sp, 'p:txBody')).paragraphs.join('\n')).join('\n').trim() : '';
    slides.push({ index: slides.length, layout: layout?.name ?? '', title: titleShape ? titleShape.text.replace(/\s+/g, ' ') : null, shapes, notes, hidden: slideRoot.attrs.show === '0' });
  }
  return { kind: 'pptx', size, slides, fonts: [...deckFonts].sort(), themeFonts };
}
