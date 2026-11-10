// Marks flagged cells on a workbook that Univer's own import read from the file, so the sheet keeps the file's
// formatting (fonts, fills, widths, merged cells, number formats) and only the flagged cells change.
import type { ICellData, IStyleData, IWorkbookData } from '@univerjs/core';
import { parseCell } from '../engine/a1.ts';
import type { Finding } from '../engine/types.ts';
import { cellKey } from '../engine/xlsx.ts';
import { RANK, toneOf, type Tone } from './tone.ts';

/** The most serious tone for each flagged cell, keyed by sheet name, row and column. */
export function flaggedCells(findings: Finding[]) {
  const map = new Map<string, Tone>();
  for (const finding of findings) {
    if (finding.where.kind !== 'cell') continue;
    const tone = toneOf(finding);
    for (const ref of finding.where.refs ?? [finding.where.ref]) {
      const at = parseCell(ref);
      if (!at) continue;
      const key = cellKey(finding.where.sheet, at.r, at.c);
      if (!map.has(key) || RANK[tone] > RANK[map.get(key)!]) map.set(key, tone);
    }
  }
  return map;
}

/** A copy of the imported workbook with every flagged cell given its tone on top of the style the file gave it. */
export function markWorkbook(data: IWorkbookData, findings: Finding[], tones: Record<Tone, IStyleData>, id: string): IWorkbookData {
  const marked = flaggedCells(findings);
  const styles: IWorkbookData['styles'] = { ...(data.styles ?? {}) };
  const sheets: IWorkbookData['sheets'] = { ...data.sheets };
  let inline = 0;
  for (const sheetId of data.sheetOrder ?? Object.keys(data.sheets ?? {})) {
    const source = data.sheets[sheetId];
    if (!source?.name) continue;
    const mine = [...marked].filter(([key]) => key.split('\u0000')[0] === source.name);
    if (!mine.length) continue;
    const cellData: Record<number, Record<number, ICellData>> = { ...(source.cellData as Record<number, Record<number, ICellData>> ?? {}) };
    let rows = source.rowCount ?? 0, cols = source.columnCount ?? 0;
    for (const [key, tone] of mine) {
      const [r, c] = key.split('\u0000')[1].split(',').map(Number);
      const row = cellData[r] = { ...(cellData[r] ?? {}) };
      const cell = row[c] ?? {};
      const base = typeof cell.s === 'string' ? styles[cell.s] : cell.s;
      const styleId = `officeproof-${tone}-${typeof cell.s === 'string' ? cell.s : cell.s ? `inline${inline++}` : 'plain'}`;
      if (!styles[styleId]) styles[styleId] = { ...(base ?? {}), ...tones[tone] };
      row[c] = { ...cell, s: styleId };
      rows = Math.max(rows, r + 1); cols = Math.max(cols, c + 1);
    }
    sheets[sheetId] = { ...source, cellData, rowCount: rows, columnCount: cols };
  }
  return { ...data, id, styles, sheets };
}
