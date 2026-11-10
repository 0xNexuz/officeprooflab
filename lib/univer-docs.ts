'use client';
// Univer Docs for the run report: the checked document, read-only, with flagged paragraphs and table rows marked.
import { UniverDocsCorePreset } from '@univerjs/preset-docs-core';
import UniverPresetDocsCoreEnUS from '@univerjs/preset-docs-core/locales/en-US';
import { BooleanNumber, createUniver, LocaleType, mergeLocales, type IDocumentData, type IParagraph, type ITextRun, type ITextStyle } from '@univerjs/presets';
import '@univerjs/preset-docs-core/lib/index.css';
import type { DocumentModel, Finding, Where } from './engine/types.ts';
import { importedDocLayout } from './imported/doc.ts';
import { toneOf } from './imported/tone.ts';

const TONE_STYLE: Record<ReturnType<typeof toneOf>, ITextStyle> = {
  fail: { bg: { rgb: '#FAC9C5' } }, warn: { bg: { rgb: '#FFDDBB' } }, ai: { bg: { rgb: '#DDD6FA' } }, info: { bg: { rgb: '#E3E1DC' } },
};
/** The same tones for a document read by Univer's import: a text background, and a fill for a flagged table cell. */
const IMPORTED_STYLE = {
  fail: { text: TONE_STYLE.fail, cell: '#FAC9C5' }, warn: { text: TONE_STYLE.warn, cell: '#FFDDBB' },
  ai: { text: TONE_STYLE.ai, cell: '#DDD6FA' }, info: { text: TONE_STYLE.info, cell: '#E3E1DC' },
};
type StyledRange = { start: number; end: number; style: ITextStyle };

/** Control characters in a data stream are document structure to Univer. Each becomes a space, so nothing is hidden. */
const visible = (text: string) => text.replace(/[\x00-\x08\x0A-\x1F\x7F]/g, ' ');

function toRuns(ranges: StyledRange[], length: number): ITextRun[] {
  const cuts = new Set<number>([0, length]);
  for (const range of ranges) { cuts.add(Math.max(0, range.start)); cuts.add(Math.min(length, range.end)); }
  const points = [...cuts].sort((a, b) => a - b);
  const runs: ITextRun[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const st = points[i], ed = points[i + 1];
    if (ed <= st) continue;
    const style: ITextStyle = {};
    for (const range of ranges) if (range.start <= st && range.end >= ed) Object.assign(style, range.style);
    if (Object.keys(style).length) runs.push({ st, ed, ts: style });
  }
  return runs;
}

export type DocLayout = { data: Partial<IDocumentData>; place: (where: Where) => [number, number] | null };

/** The document as Univer data. Tables are shown one row per line, cells separated by bars. */
export function docData(id: string, doc: DocumentModel, findings: Finding[]): DocLayout {
  let stream = '';
  const ranges: StyledRange[] = [];
  const spacing: IParagraph['paragraphStyle'][] = [];
  const blockAt = new Map<number, [number, number]>();
  const rowAt = new Map<string, [number, number]>();
  const tableAt = new Map<number, [number, number]>();
  for (const block of doc.blocks) {
    if (block.type === 'p') {
      const start = stream.length;
      stream += visible(block.text);
      const end = stream.length;
      blockAt.set(block.index, [start, end]);
      if (block.level === 0) ranges.push({ start, end, style: { bl: BooleanNumber.TRUE, fs: 20 } });
      else if (block.level >= 1) ranges.push({ start, end, style: { bl: BooleanNumber.TRUE, fs: block.level === 1 ? 15.5 : block.level === 2 ? 13 : 11.5 } });
      spacing.push(block.level >= 0 ? { spaceAbove: { v: 14 }, spaceBelow: { v: 4 } } : { spaceBelow: { v: 7 }, lineSpacing: 1.25, ...(block.list ? { indentStart: { v: 14 } } : {}) });
      stream += '\r';
    } else {
      const tableStart = stream.length;
      block.rows.forEach((row, r) => {
        const start = stream.length;
        stream += visible(row.filter(cell => cell !== '\u0000').join('  |  '));
        const end = stream.length;
        rowAt.set(`${block.tableIndex}:${r}`, [start, end]);
        ranges.push({ start, end, style: { ff: 'JetBrains Mono', fs: 9.5, ...(r === 0 ? { bl: BooleanNumber.TRUE } : {}) } });
        spacing.push({ spaceBelow: { v: r === block.rows.length - 1 ? 10 : 2 }, indentStart: { v: 10 } });
        stream += '\r';
      });
      tableAt.set(block.tableIndex, [tableStart, Math.max(tableStart, stream.length - 1)]);
    }
  }
  if (!stream) { stream = '\r'; spacing.push({}); }
  const place = (where: Where): [number, number] | null => {
    if (where.kind === 'paragraph') return blockAt.get(where.index) ?? null;
    if (where.kind === 'table') return (where.row !== undefined ? rowAt.get(`${where.index}:${where.row}`) : undefined) ?? tableAt.get(where.index) ?? null;
    return null;
  };
  const rank = { info: 1, ai: 2, warn: 3, fail: 4 } as const;
  for (const finding of [...findings].sort((a, b) => rank[toneOf(a)] - rank[toneOf(b)])) {
    const at = place(finding.where);
    if (at && at[1] > at[0]) ranges.push({ start: at[0], end: at[1], style: TONE_STYLE[toneOf(finding)] });
  }
  const full = `${stream}\n`;
  ranges.unshift({ start: 0, end: stream.length, style: { ff: 'Bricolage Grotesque Variable', fs: 11, cl: { rgb: '#0C0C0C' } } });
  const paragraphs: IParagraph[] = [];
  for (let i = 0; i < full.length; i++) if (full[i] === '\r') paragraphs.push({ startIndex: i, paragraphId: `p${paragraphs.length}`, paragraphStyle: spacing[paragraphs.length] ?? {} });
  return { place, data: { id, documentStyle: { pageSize: { width: 760, height: 1075 }, marginTop: 56, marginBottom: 56, marginLeft: 64, marginRight: 64, autoHyphenation: BooleanNumber.FALSE },
    body: { dataStream: full, paragraphs, textRuns: toRuns(ranges, full.length - 2), sectionBreaks: [{ sectionId: 's0', startIndex: full.length - 1 }] } } };
}

/** `original` is true when the document is shown as Univer's import read it, with the file's own design. */
export type DocView = { select: (where: Where) => void; dispose: () => void; original: boolean };

/**
 * Mounts the document read-only: any command that would change it is cancelled, while selecting and scrolling still
 * work. `imported` is the file as read by Univer's own import. It is used when every finding can be placed on it;
 * otherwise the document is rebuilt from the engine's reading, where every finding always can.
 */
export function mountDoc(container: HTMLElement, doc: DocumentModel, findings: Finding[], imported: IDocumentData | null = null): DocView {
  const { univer, univerAPI } = createUniver({
    locale: LocaleType.EN_US,
    locales: { [LocaleType.EN_US]: mergeLocales(UniverPresetDocsCoreEnUS) },
    presets: [UniverDocsCorePreset({ container, header: false, toolbar: false, footer: false, contextMenu: false, disableAutoFocus: true })],
  });
  const guard = univerAPI.addEvent(univerAPI.Event.BeforeCommandExecute, event => {
    if (/^doc\.(command|mutation)\./.test(event.id) && !/(copy|select|cursor|scroll|zoom|focus)/i.test(event.id)) event.cancel = true;
  });
  const faithful = imported ? importedDocLayout('officeproof-document', imported, doc, findings, IMPORTED_STYLE) : null;
  const layout = faithful ?? docData('officeproof-document', doc, findings);
  univerAPI.createDocument(layout.data);
  // Univer shows a formatting bar beside a selection. Nothing here can be edited, so it is kept out of sight.
  document.documentElement.classList.add('officeproof-reading');
  // A page read from the file can be wider than the viewer; it is scaled down so a whole line shows.
  const pageWidth = faithful?.data.documentStyle?.pageSize?.width;
  const fit = () => {
    if (!pageWidth || !container.clientWidth) return;
    const zoomRatio = Math.max(0.4, Math.min(1, Math.floor((container.clientWidth - 36) / pageWidth * 100) / 100));
    try { void univerAPI.executeCommand('doc.operation.set-zoom-ratio', { unitId: 'officeproof-document', zoomRatio }); } catch { /* fitting is a convenience */ }
  };
  const timers = faithful ? [setTimeout(fit, 150), setTimeout(fit, 900)] : [];
  return {
    select(where) {
      const at = layout.place(where);
      if (!at) return;
      try { univerAPI.getActiveDocument()?.setSelection(at[0], Math.max(at[0], at[1])); } catch { /* selection is a convenience */ }
    },
    dispose() { timers.forEach(clearTimeout); document.documentElement.classList.remove('officeproof-reading'); guard.dispose(); univer.dispose(); },
    original: Boolean(faithful),
  };
}
