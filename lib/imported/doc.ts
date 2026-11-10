// Places the engine's findings on a document that Univer's own import read from the file. The engine counts
// paragraphs and tables its own way, so each one is matched to Univer's by its text, in order. If a finding cannot be
// placed with certainty the caller falls back to the plain structure view, where every finding can.
import type { IDocumentData, ITextRun, ITextStyle } from '@univerjs/core';
import type { DocumentModel, Finding, Where } from '../engine/types.ts';
import { RANK, toneOf, type Tone } from './tone.ts';

// Univer's markers in a document's text stream.
const PARAGRAPH = '\r', SECTION = '\n', TABLE_START = '\x1A', ROW_START = '\x1B', CELL_START = '\x1C', CELL_END = '\x1D', ROW_END = '\x0E', TABLE_END = '\x0F';

type Span = { start: number; end: number };
type Row = Span & { cells: Span[] };
type Table = Span & { rows: Row[] };
export type DocOutline = { paragraphs: (Span & { text: string })[]; tables: Table[] };

const plain = (text: string) => text.replace(/[\x00-\x1F\x7F]+/g, ' ').replace(/\s+/g, ' ').trim();

/** The paragraphs outside tables and the tables themselves, with where each sits in the stream. */
export function outline(stream: string): DocOutline {
  const paragraphs: DocOutline['paragraphs'] = [];
  const tables: Table[] = [];
  let depth = 0, from = 0, table: Table | null = null, row: Row | null = null, cell = -1;
  for (let i = 0; i < stream.length; i++) {
    const ch = stream[i];
    if (ch === TABLE_START) { if (depth === 0) table = { start: i, end: i + 1, rows: [] }; depth++; }
    else if (ch === TABLE_END) { depth = Math.max(0, depth - 1); if (depth === 0 && table) { table.end = i + 1; tables.push(table); table = null; from = i + 1; } }
    else if (depth === 1 && ch === ROW_START) row = { start: i, end: i + 1, cells: [] };
    else if (depth === 1 && ch === ROW_END && row && table) { row.end = i + 1; table.rows.push(row); row = null; }
    else if (depth === 1 && ch === CELL_START) cell = i + 1;
    else if (depth === 1 && ch === CELL_END && row && cell >= 0) { row.cells.push({ start: cell, end: i }); cell = -1; }
    else if (depth === 0 && ch === PARAGRAPH) { paragraphs.push({ start: from, end: i, text: stream.slice(from, i) }); from = i + 1; }
    else if (depth === 0 && ch === SECTION) from = i + 1;
  }
  return { paragraphs, tables };
}

/** Background colour laid over the text runs the file already has, keeping each run's own style. */
export function paint(runs: ITextRun[], marks: { start: number; end: number; style: ITextStyle }[]): ITextRun[] {
  const live = marks.filter(mark => mark.end > mark.start);
  if (!live.length) return runs;
  const sorted = [...runs].sort((a, b) => a.st - b.st);
  const cuts = new Set<number>();
  for (const run of sorted) { cuts.add(run.st); cuts.add(run.ed); }
  for (const mark of live) { cuts.add(mark.start); cuts.add(mark.end); }
  const points = [...cuts].sort((a, b) => a - b);
  const out: ITextRun[] = [];
  let at = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const st = points[i], ed = points[i + 1];
    while (at < sorted.length && sorted[at].ed <= st) at++;
    const base = at < sorted.length && sorted[at].st <= st && sorted[at].ed >= ed ? sorted[at] : null;
    const over = live.filter(mark => mark.start <= st && mark.end >= ed);
    if (!base && !over.length) continue;
    out.push({ ...(base ?? {}), st, ed, ts: Object.assign({}, base?.ts, ...over.map(mark => mark.style)) });
  }
  return out;
}

export type ImportedDocLayout = { data: IDocumentData; place: (where: Where) => [number, number] | null };

/**
 * The imported document with the findings marked, or null when a finding could not be placed on it.
 * `styles` gives the mark for each tone: a text background for paragraphs and a cell colour for table rows.
 */
export function importedDocLayout(id: string, data: IDocumentData, doc: DocumentModel, findings: Finding[], styles: Record<Tone, { text: ITextStyle; cell: string }>): ImportedDocLayout | null {
  const body = data.body;
  if (!body?.dataStream) return null;
  const found = outline(body.dataStream);
  const blockAt = new Map<number, Span>();
  const tableAt = new Map<number, Table>();
  let next = 0, tableNo = 0;
  for (const block of doc.blocks) {
    if (block.type === 'table') { const table = found.tables[tableNo++]; if (table) tableAt.set(block.tableIndex, table); continue; }
    const want = plain(block.text);
    if (!want) continue;
    // Univer may hold a few paragraphs the engine does not count (an empty line, a field); look a short way ahead.
    for (let k = next; k < found.paragraphs.length && k <= next + 4; k++) {
      if (plain(found.paragraphs[k].text) === want) { blockAt.set(block.index, found.paragraphs[k]); next = k + 1; break; }
    }
  }
  const rowOf = (where: Extract<Where, { kind: 'table' }>) => {
    const table = tableAt.get(where.index);
    const source = doc.blocks.find(block => block.type === 'table' && block.tableIndex === where.index);
    if (!table) return null;
    // Rows are trusted only when both readings agree on how many there are.
    const rows = source?.type === 'table' && source.rows.length === table.rows.length ? table.rows : null;
    return { table, row: where.row !== undefined && rows ? rows[where.row] ?? null : null };
  };
  const place = (where: Where): [number, number] | null => {
    if (where.kind === 'paragraph') { const span = blockAt.get(where.index); return span ? [span.start, span.end] : null; }
    if (where.kind === 'table') {
      const hit = rowOf(where);
      if (!hit) return null;
      const cell = (hit.row ?? hit.table.rows[0])?.cells[hit.row && where.col !== undefined ? where.col : 0];
      // A paragraph mark ends the cell's text; the selection stops before it.
      return cell ? [cell.start, Math.max(cell.start, cell.end - 2)] : null;
    }
    return null;
  };

  const marks: { start: number; end: number; style: ITextStyle }[] = [];
  const cellTone = new Map<string, Tone>();
  const tableIds = new Map<number, string>((body.tables ?? []).map(table => [table.startIndex, table.tableId]));
  for (const finding of [...findings].sort((a, b) => RANK[toneOf(a)] - RANK[toneOf(b)])) {
    const where = finding.where, tone = toneOf(finding);
    if (where.kind === 'paragraph') {
      const span = blockAt.get(where.index);
      if (!span) return null;
      marks.push({ start: span.start, end: span.end, style: styles[tone].text });
    } else if (where.kind === 'table') {
      const hit = rowOf(where);
      const tableId = hit && tableIds.get(hit.table.start);
      if (!hit || !tableId) return null;
      const rows = hit.row ? [hit.table.rows.indexOf(hit.row)] : hit.table.rows.map((_, index) => index);
      for (const r of rows) {
        const cols = hit.row && where.col !== undefined ? [where.col] : hit.table.rows[r].cells.map((_, index) => index);
        for (const c of cols) cellTone.set(`${tableId}:${r}:${c}`, tone);
      }
    }
  }
  const tableSource = { ...(data.tableSource ?? {}) };
  for (const [key, tone] of cellTone) {
    const [tableId, r, c] = key.split(':');
    const table = tableSource[tableId];
    const cell = table?.tableRows?.[Number(r)]?.tableCells?.[Number(c)];
    if (!table || !cell) continue;
    const tableRows = table.tableRows.map((row, index) => index !== Number(r) ? row : { ...row, tableCells: row.tableCells.map((item, col) => col !== Number(c) ? item : { ...item, backgroundColor: { rgb: styles[tone].cell } }) });
    tableSource[tableId] = { ...table, tableRows };
  }
  return { place, data: { ...data, id, tableSource, body: { ...body, textRuns: paint(body.textRuns ?? [], marks) } } };
}
