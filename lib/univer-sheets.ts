'use client';
// Univer Sheets for the run report: the checked workbook with every flagged cell marked. Loaded lazily.
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import UniverPresetSheetsCoreEnUS from '@univerjs/preset-sheets-core/locales/en-US';
import { createUniver, LocaleType, mergeLocales, type ICellData, type IStyleData, type IWorkbookData } from '@univerjs/presets';
import '@univerjs/preset-sheets-core/lib/index.css';
import { colName, parseCell } from './engine/a1.ts';
import type { Recalculation } from './engine/recalc.ts';
import { cellKey } from './engine/xlsx.ts';
import type { Cell, CellValue, Finding, Sheet, Where, Workbook } from './engine/types.ts';

type Tone = 'fail' | 'warn' | 'info' | 'ai';
const RANK: Record<Tone, number> = { fail: 4, warn: 3, ai: 2, info: 1 };
const edge = (rgb: string, s: number) => ({ s, cl: { rgb } });
const box = (rgb: string, s = 8) => ({ t: edge(rgb, s), b: edge(rgb, s), l: edge(rgb, s), r: edge(rgb, s) });
const TONES: Record<Tone, IStyleData> = {
  fail: { bg: { rgb: '#FBE3E1' }, bd: box('#D21F26') },
  warn: { bg: { rgb: '#FFECD9' }, bd: box('#FF8A3D') },
  ai: { bg: { rgb: '#ECE8FB' }, bd: box('#5B3FD6', 4) },
  info: { bg: { rgb: '#EFEDE8' }, bd: box('#5C5C60', 1) },
};
export const toneOf = (finding: Finding): Tone => finding.label === 'ai' ? 'ai' : finding.severity === 'fail' ? 'fail' : finding.severity === 'warn' ? 'warn' : 'info';

function flags(findings: Finding[]) {
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

/** The workbook as Univer data. Formulas keep their stored result so the sheet reads at once; Univer then recalculates. */
export function sheetData(workbook: Workbook, findings: Finding[]): Partial<IWorkbookData> {
  const marked = flags(findings);
  const styles: Record<string, IStyleData> = {};
  const styleFor = (tone: Tone | undefined, cell: Cell) => {
    if (!tone && !cell.fmt) return undefined;
    const id = `${tone ?? ''}|${cell.fmt ?? ''}`;
    if (!styles[id]) styles[id] = { ...(tone ? TONES[tone] : {}), ...(cell.fmt ? { n: { pattern: cell.fmt } } : {}) };
    return id;
  };
  const sheets: NonNullable<IWorkbookData['sheets']> = {};
  const order: string[] = [];
  workbook.sheets.forEach((sheet, index) => {
    const id = `sheet-${index}`;
    order.push(id);
    const cellData: Record<number, Record<number, ICellData>> = {};
    const widths: number[] = [];
    for (const cell of sheet.cells) {
      const row = cellData[cell.r] ?? (cellData[cell.r] = {});
      const s = styleFor(marked.get(cellKey(sheet.name, cell.r, cell.c)), cell);
      const stored = cell.v === null || cell.v === '' && cell.f ? undefined : cell.v;
      row[cell.c] = { ...(cell.f ? { f: cell.f } : {}), ...(stored !== undefined ? { v: stored, t: typeof stored === 'number' ? 2 : typeof stored === 'boolean' ? 3 : 1 } : {}), ...(s ? { s } : {}) };
      const shown = cell.f && cell.v === null ? cell.f : String(cell.v ?? '');
      // A long title is left to run over its neighbours, as it does in a spreadsheet app.
      widths[cell.c] = Math.max(widths[cell.c] ?? 0, shown.length > 26 ? 10 : shown.length);
    }
    // Flagged cells that are empty in the file still need their mark.
    for (const [key, tone] of marked) {
      const [name, at] = key.split('\u0000');
      if (name !== sheet.name) continue;
      const [r, c] = at.split(',').map(Number);
      const row = cellData[r] ?? (cellData[r] = {});
      if (!row[c]) row[c] = { s: styleFor(tone, { r, c, v: null, t: 'z' }) };
    }
    sheets[id] = { id, name: sheet.name, cellData, rowCount: Math.max(sheet.rows + 30, 60), columnCount: Math.max(sheet.cols + 6, 14), hidden: sheet.state === 'visible' ? 0 : 1,
      columnData: Object.fromEntries(widths.map((chars, c) => [c, { w: Math.max(72, Math.round((chars ?? 0) * 8.2 + 22)) }]).filter(Boolean)) };
  });
  const names: Record<string, unknown> = {};
  workbook.definedNames.forEach((item, index) => { names[`name-${index}`] = { id: `name-${index}`, name: item.name, formulaOrRefString: item.ref.startsWith('=') ? item.ref : `=${item.ref}`, comment: '' }; });
  return { id: 'officeproof-workbook', name: 'Checked workbook', sheetOrder: order, styles, sheets,
    resources: workbook.definedNames.length ? [{ name: 'SHEET_DEFINED_NAME_PLUGIN', data: JSON.stringify(names) }] : [] };
}

export type SheetView = {
  select: (where: Where) => void;
  /** The workbook as it stands in the editor, with Univer's calculated values, for a re-check in the browser. */
  snapshot: () => Promise<{ workbook: Workbook; recalc: Recalculation }>;
  onEdit: (callback: () => void) => void;
  dispose: () => void;
};

const ERROR = /^#[A-Z0-9/!?_.]+$/;

export function mountSheet(container: HTMLElement, workbook: Workbook, findings: Finding[]): SheetView {
  const { univer, univerAPI } = createUniver({
    locale: LocaleType.EN_US,
    locales: { [LocaleType.EN_US]: mergeLocales(UniverPresetSheetsCoreEnUS) },
    presets: [UniverSheetsCorePreset({ container, header: false, toolbar: false, formulaBar: true, contextMenu: false, footer: { sheetBar: true, statisticBar: false, menus: false, zoomSlider: false } })],
  });
  const book = univerAPI.createWorkbook(sheetData(workbook, findings));
  const listeners: (() => void)[] = [];
  const editSubscription = univerAPI.addEvent(univerAPI.Event.SheetEditEnded, () => { setTimeout(() => listeners.forEach(fn => fn()), 60); });
  return {
    select(where) {
      try {
        if (where.kind !== 'cell' && where.kind !== 'sheet') return;
        const sheet = book.getSheetByName(where.sheet);
        if (!sheet) return;
        book.setActiveSheet(sheet);
        if (where.kind !== 'cell') return;
        const cells = (where.refs ?? [where.ref]).map(parseCell).filter((at): at is { r: number; c: number } => Boolean(at));
        if (!cells.length) return;
        const r1 = Math.min(...cells.map(at => at.r)), r2 = Math.max(...cells.map(at => at.r)), c1 = Math.min(...cells.map(at => at.c)), c2 = Math.max(...cells.map(at => at.c));
        sheet.getRange(r1, c1, r2 - r1 + 1, c2 - c1 + 1).activate();
        sheet.scrollToCell(Math.max(0, r1 - 4), Math.max(0, c1 - 2));
      } catch { /* moving the selection is a convenience */ }
    },
    async snapshot() {
      // The sheet opens showing the file's stored results. Before a re-check every formula is calculated afresh.
      await new Promise<void>(resolve => {
        let done = false;
        const finish = () => { if (!done) { done = true; subscription.dispose(); clearTimeout(timer); setTimeout(resolve, 80); } };
        const formula = univerAPI.getFormula();
        const subscription = formula.calculationEnd(finish);
        const timer = setTimeout(finish, 6000);
        formula.executeCalculation();
      });
      const data = book.save();
      const values = new Map<string, CellValue>();
      const sheets: Sheet[] = (data.sheetOrder ?? []).map(id => {
        const source = data.sheets[id]!;
        const facade = book.getSheetBySheetId(id);
        const sheet: Sheet = { name: source.name ?? id, state: source.hidden ? 'hidden' : 'visible', cells: [], rows: 0, cols: 0, merges: [] };
        for (const [rowKey, row] of Object.entries(source.cellData ?? {})) for (const [colKey, raw] of Object.entries(row as Record<string, ICellData | null>)) {
          if (!raw) continue;
          const r = Number(rowKey), c = Number(colKey);
          let formula = typeof raw.f === 'string' && raw.f ? raw.f : '';
          if (!formula && raw.si) { try { formula = facade?.getRange(r, c).getFormula() ?? ''; } catch { formula = ''; } }
          let v = (raw.v ?? null) as CellValue;
          if (typeof v === 'string' && raw.t === 2 && v.trim() !== '' && Number.isFinite(Number(v))) v = Number(v);
          if (!formula && (v === null || v === '')) continue;
          const t: Cell['t'] = typeof v === 'number' ? 'n' : typeof v === 'boolean' ? 'b' : typeof v === 'string' && ERROR.test(v) ? 'e' : v === null ? 'z' : 's';
          const cell: Cell = { r, c, v, t };
          if (formula) { cell.f = formula.startsWith('=') ? formula : `=${formula}`; cell.cached = true; if (v !== null) values.set(cellKey(sheet.name, r, c), v); }
          sheet.cells.push(cell);
          sheet.rows = Math.max(sheet.rows, r + 1); sheet.cols = Math.max(sheet.cols, c + 1);
        }
        return sheet;
      });
      const formulas = sheets.reduce((sum, sheet) => sum + sheet.cells.filter(cell => cell.f).length, 0);
      return { workbook: { kind: 'xlsx', sheets, definedNames: workbook.definedNames, externalLinks: workbook.externalLinks, hasMacros: workbook.hasMacros, truncated: false },
        recalc: { values, formulas, unfinished: formulas - values.size, ms: 0 } };
    },
    onEdit: callback => { listeners.push(callback); },
    dispose() { editSubscription.dispose(); univer.dispose(); },
  };
}

export const columnLetter = colName;
