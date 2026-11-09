// Recalculates a workbook with Univer's formula engine, headless: no editor, no browser.
// The same code runs on the server, in the command-line tool and in CI.
import { LocaleType, LogLevel, Univer, UniverInstanceType } from '@univerjs/core';
import { FUniver } from '@univerjs/core/facade';
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import { UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula';
import '@univerjs/engine-formula/facade';
import '@univerjs/sheets/facade';
import '@univerjs/sheets-formula/facade';
import { cellKey } from './xlsx.ts';
import type { CellValue, Workbook } from './types.ts';

export type Recalculation = {
  /** Recalculated value for every formula cell that the engine finished. */
  values: Map<string, CellValue>;
  formulas: number;
  /** Formula cells the engine did not finish in time. */
  unfinished: number;
  ms: number;
};

/** Builds Univer workbook data from the model. Formulas are given without their stored result, so every value read back is Univer's own. */
export function toUniverData(workbook: Workbook, options: { keepCached?: boolean } = {}) {
  const sheets: Record<string, unknown> = {};
  const order: string[] = [];
  workbook.sheets.forEach((sheet, index) => {
    const id = `sheet-${index}`;
    order.push(id);
    const cellData: Record<number, Record<number, { v?: CellValue; f?: string; t?: number }>> = {};
    for (const cell of sheet.cells) {
      const row = cellData[cell.r] ?? (cellData[cell.r] = {});
      if (cell.f) row[cell.c] = options.keepCached && cell.v !== null ? { f: cell.f, v: cell.v } : { f: cell.f };
      else row[cell.c] = { v: cell.v, t: cell.t === 'n' ? 2 : cell.t === 'b' ? 3 : 1 };
    }
    sheets[id] = { id, name: sheet.name, cellData, rowCount: Math.max(sheet.rows + 20, 60), columnCount: Math.max(sheet.cols + 4, 16),
      hidden: sheet.state === 'visible' ? 0 : 1 };
  });
  const names: Record<string, unknown> = {};
  workbook.definedNames.forEach((item, index) => { names[`name-${index}`] = { id: `name-${index}`, name: item.name, formulaOrRefString: item.ref.startsWith('=') ? item.ref : `=${item.ref}`, comment: '' }; });
  return { id: 'workbook', name: 'workbook', sheetOrder: order, sheets,
    resources: workbook.definedNames.length ? [{ name: 'SHEET_DEFINED_NAME_PLUGIN', data: JSON.stringify(names) }] : [] };
}

export async function recalculate(workbook: Workbook, options: { timeoutMs?: number } = {}): Promise<Recalculation> {
  const started = Date.now();
  const formulaCells = workbook.sheets.flatMap(sheet => sheet.cells.filter(cell => cell.f).map(cell => ({ sheet: sheet.name, cell })));
  const values = new Map<string, CellValue>();
  if (!formulaCells.length) return { values, formulas: 0, unfinished: 0, ms: 0 };

  const univer = new Univer({ locale: LocaleType.EN_US, logLevel: LogLevel.SILENT });
  try {
    univer.registerPlugin(UniverFormulaEnginePlugin);
    univer.registerPlugin(UniverSheetsPlugin);
    univer.registerPlugin(UniverSheetsFormulaPlugin);
    univer.createUnit(UniverInstanceType.UNIVER_SHEET, toUniverData(workbook) as never);
    const api = FUniver.newAPI(univer);
    const book = api.getActiveWorkbook()!;
    const sheets = new Map(workbook.sheets.map(sheet => [sheet.name, book.getSheetByName(sheet.name)?.getSheet()]));
    const read = () => {
      let missing = 0;
      for (const { sheet, cell } of formulaCells) {
        const raw = sheets.get(sheet)?.getCellRaw(cell.r, cell.c);
        const value = raw?.v;
        if (value === undefined || value === null) { missing++; continue; }
        values.set(cellKey(sheet, cell.r, cell.c), value as CellValue);
      }
      return missing;
    };
    const formula = api.getFormula();
    const deadline = started + (options.timeoutMs ?? 20_000);
    let unfinished = formulaCells.length;
    // Done when every formula has a value. If the engine reports it has finished and some cells still have none
    // (a formula it cannot evaluate), a few quiet polls are enough: those cells are reported as not verified.
    await new Promise<void>(resolve => {
      let done = false, ended = false, quiet = 0, last = -1;
      const finish = () => { if (!done) { done = true; clearInterval(poll); subscription.dispose(); resolve(); } };
      const check = () => {
        unfinished = read();
        quiet = unfinished === last ? quiet + 1 : 0;
        last = unfinished;
        if (unfinished === 0 || Date.now() > deadline || (ended && quiet >= 4)) finish();
      };
      const subscription = formula.calculationEnd(() => { ended = true; check(); });
      const poll = setInterval(check, 150);
      formula.executeCalculation();
    });
    return { values, formulas: formulaCells.length, unfinished, ms: Date.now() - started };
  } finally {
    univer.dispose();
  }
}
