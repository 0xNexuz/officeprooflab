// Deterministic spreadsheet checks. Recalculated values come from Univer's formula engine (see recalc.ts).
import { cellRef, colName, compactRefs, type Area } from './a1.ts';
import { Collector, clip, show } from './collect.ts';
import { analyze, shift, type FormulaInfo } from './formula.ts';
import { SUPPORTED_FUNCTIONS } from './supported.ts';
import type { Recalculation } from './recalc.ts';
import { cellKey } from './xlsx.ts';
import type { Cell, CellValue, Sheet, Workbook } from './types.ts';

const ERRORS = /^#(REF!|DIV\/0!|VALUE!|NAME\?|N\/A|NUM!|NULL!|SPILL!|CALC!|GETTING_DATA|ERROR!|CIRC!?)$/i;
const isError = (value: CellValue | undefined): value is string => typeof value === 'string' && ERRORS.test(value);
const TOTAL_LABEL = /^\s*(grand\s+|sub\s*-?\s*|net\s+|overall\s+)?totals?\b|^\s*sum\b/i;
const NUMBER_TEXT = /^\s*[-+(]?\s*[$€£₦¥]?\s*\d[\d,]*(\.\d+)?\s*%?\)?\s*$/;
const ID_HEADER = /\b(id|code|zip|postal|phone|tel|no\.?|number|ref|sku|year|account|invoice)\b/i;
const NOT_SUMMED_HEADER = /%|\b(rate|percent|avg|average|price|unit|ratio|margin)\b/i;
const ENUMERATE_LIMIT = 4000;

export function same(a: CellValue | undefined, b: CellValue | undefined): boolean {
  const blank = (value: CellValue | undefined) => value === null || value === undefined || value === '';
  if (blank(a) && blank(b)) return true;
  if (typeof a === 'boolean' && typeof b === 'number') return (a ? 1 : 0) === b;
  if (typeof b === 'boolean' && typeof a === 'number') return (b ? 1 : 0) === a;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  return a === b;
}

export function textNumber(value: string): number | null {
  if (!NUMBER_TEXT.test(value) || /^\s*0\d/.test(value)) return null;
  const negative = /^\s*[-(]/.test(value);
  const digits = value.replace(/[^\d.]/g, '');
  const parsed = Number(digits);
  if (!Number.isFinite(parsed)) return null;
  return (negative ? -parsed : parsed) / (value.includes('%') ? 100 : 1);
}

export type Table = { sheet: string; headerRow: number; firstRow: number; lastRow: number; c1: number; c2: number; headers: Map<number, string>; totalRows: number[] };

/** One sheet, indexed for the checks. */
export class Grid {
  sheet: Sheet;
  cells = new Map<string, Cell>();
  rows = new Map<number, Cell[]>();
  private recalc: Recalculation | null;

  constructor(sheet: Sheet, recalc: Recalculation | null) {
    this.sheet = sheet;
    this.recalc = recalc;
    for (const cell of sheet.cells) {
      this.cells.set(`${cell.r},${cell.c}`, cell);
      const row = this.rows.get(cell.r);
      if (row) row.push(cell); else this.rows.set(cell.r, [cell]);
    }
  }
  at(r: number, c: number) { return this.cells.get(`${r},${c}`); }
  /** The recalculated value of a formula, when Univer finished it. */
  computed(cell: Cell): CellValue | undefined { return cell.f ? this.recalc?.values.get(cellKey(this.sheet.name, cell.r, cell.c)) : undefined; }
  /** The value a reader would see after recalculation: Univer's result for a formula, the stored value otherwise. */
  value(cell: Cell | undefined): CellValue {
    if (!cell) return null;
    if (cell.f) { const computed = this.computed(cell); return computed !== undefined ? computed : cell.v; }
    return cell.v;
  }
  filled(cell: Cell | undefined) { return Boolean(cell && (cell.f || (cell.v !== null && cell.v !== ''))); }
  anyFilled(area: Area): boolean {
    const size = (area.r2 - area.r1 + 1) * (area.c2 - area.c1 + 1);
    if (size <= ENUMERATE_LIMIT) {
      for (let r = area.r1; r <= area.r2; r++) for (let c = area.c1; c <= area.c2; c++) if (this.filled(this.at(r, c))) return true;
      return false;
    }
    return this.sheet.cells.some(cell => cell.r >= area.r1 && cell.r <= area.r2 && cell.c >= area.c1 && cell.c <= area.c2 && this.filled(cell));
  }
  /** Cells inside an area that satisfy a test (used to follow errors and stale values to their source). */
  some(area: Area, set: Set<string>): boolean {
    const size = (area.r2 - area.r1 + 1) * (area.c2 - area.c1 + 1);
    if (size <= ENUMERATE_LIMIT) {
      for (let r = area.r1; r <= area.r2; r++) for (let c = area.c1; c <= area.c2; c++) if (set.has(cellKey(this.sheet.name, r, c))) return true;
      return false;
    }
    const prefix = `${this.sheet.name}\u0000`;
    for (const key of set) {
      if (!key.startsWith(prefix)) continue;
      const [r, c] = key.slice(prefix.length).split(',').map(Number);
      if (r >= area.r1 && r <= area.r2 && c >= area.c1 && c <= area.c2) return true;
    }
    return false;
  }
}

export function findTables(grid: Grid): Table[] {
  const tables: Table[] = [];
  const rowNumbers = [...grid.rows.keys()].filter(r => grid.rows.get(r)!.some(cell => grid.filled(cell))).sort((a, b) => a - b);
  let block: number[] = [];
  const flush = () => {
    if (block.length >= 2) {
      // The header is the first row made mostly of text with at least two cells; a lone title line above it is skipped.
      for (let i = 0; i < Math.min(block.length - 1, 4); i++) {
        const cells = grid.rows.get(block[i])!.filter(cell => grid.filled(cell));
        const strings = cells.filter(cell => cell.t === 's' && !cell.f);
        if (cells.length >= 2 && strings.length >= Math.max(2, Math.ceil(cells.length * 0.6))) {
          const body = block.slice(i + 1);
          const all = [block[i], ...body].flatMap(r => grid.rows.get(r)!.filter(cell => grid.filled(cell)));
          const c1 = Math.min(...all.map(cell => cell.c)), c2 = Math.max(...all.map(cell => cell.c));
          const headers = new Map<number, string>();
          for (const cell of cells) headers.set(cell.c, String(cell.v ?? '').trim());
          const totalRows = body.filter(r => grid.rows.get(r)!.some(cell => cell.t === 's' && !cell.f && TOTAL_LABEL.test(String(cell.v))));
          tables.push({ sheet: grid.sheet.name, headerRow: block[i], firstRow: body[0], lastRow: body[body.length - 1], c1, c2, headers, totalRows });
          break;
        }
      }
    }
    block = [];
  };
  for (const r of rowNumbers) {
    if (block.length && r !== block[block.length - 1] + 1) flush();
    block.push(r);
  }
  flush();
  return tables;
}

type FormulaCell = { sheet: string; grid: Grid; cell: Cell; info: FormulaInfo; key: string };

export function checkWorkbook(workbook: Workbook, recalc: Recalculation | null, out: Collector) {
  const grids = new Map(workbook.sheets.map(sheet => [sheet.name, new Grid(sheet, recalc)]));
  const sheetNames = new Map(workbook.sheets.map(sheet => [sheet.name.toLowerCase(), sheet.name]));
  const definedNames = new Set(workbook.definedNames.map(item => item.name.toLowerCase()));
  const formulas: FormulaCell[] = [];
  for (const [name, grid] of grids) for (const cell of grid.sheet.cells) if (cell.f) formulas.push({ sheet: name, grid, cell, info: analyze(cell.f, cell.r, cell.c), key: cellKey(name, cell.r, cell.c) });
  const gridOf = (formula: FormulaCell, sheet: string | null) => sheet === null ? formula.grid : grids.get(sheetNames.get(sheet.toLowerCase()) ?? '') ?? null;
  const reads = (formula: FormulaCell, set: Set<string>) => formula.info.refs.some(ref => { const grid = ref.area ? gridOf(formula, ref.sheet) : null; return Boolean(grid && grid.some(ref.area!, set)); });
  const where = (formula: FormulaCell) => ({ kind: 'cell' as const, sheet: formula.sheet, ref: cellRef(formula.cell.r, formula.cell.c) });

  for (const sheet of workbook.sheets) if (!sheet.cells.length && sheet.state === 'visible') out.add('XL-EMPTY-SHEET', { kind: 'sheet', sheet: sheet.name }, `Sheet "${sheet.name}" is empty`, 'The sheet has no content.');

  // ---- Formulas ----
  if (formulas.length) {
    if (!recalc) for (const id of ['XL-STALE', 'XL-ERROR']) out.note(id, 'Checked against stored results only: recalculation was not run');
    else if (recalc.unfinished) out.note('XL-STALE', `${recalc.unfinished} formula${recalc.unfinished === 1 ? '' : 's'} did not finish recalculating and were left unchecked`);

    // Formulas that use a volatile function, or read a cell that does, change on every calculation and cannot be compared.
    const volatile = new Set<string>();
    for (const formula of formulas) if (formula.info.volatile) volatile.add(formula.key);
    for (let pass = 0, grew = volatile.size > 0; grew && pass < 40; pass++) {
      grew = false;
      for (const formula of formulas) if (!volatile.has(formula.key) && reads(formula, volatile)) { volatile.add(formula.key); grew = true; }
    }

    const missingSheet = new Set<string>();
    const external: FormulaCell[] = [];
    const unverified: FormulaCell[] = [];
    const noResult: FormulaCell[] = [];
    const errorCells = new Set<string>();
    const errors: { formula: FormulaCell; value: string; stored: CellValue }[] = [];
    const stale: FormulaCell[] = [];
    const staleKeys = new Set<string>();

    for (const formula of formulas) {
      const { cell, info, grid } = formula;
      if (info.refs.some(ref => ref.external)) { external.push(formula); continue; }
      const gone = info.refs.find(ref => ref.sheet !== null && !sheetNames.has(ref.sheet.toLowerCase()));
      if (gone) {
        missingSheet.add(formula.key); errorCells.add(formula.key);
        out.add('XL-MISSING-SHEET', where(formula), `${formula.sheet}!${cellRef(cell.r, cell.c)} points to a sheet named "${gone.sheet}", which is not in the workbook`,
          `Formula: ${cell.f}`, { actual: cell.f });
        continue;
      }
      if (cell.cached === false) noResult.push(formula);
      const computed = grid.computed(cell);
      const unsupported = info.functions.filter(name => !SUPPORTED_FUNCTIONS.has(name));
      const unknownName = info.names.some(name => !definedNames.has(name.toLowerCase()));
      if (info.refError || cell.t === 'e') {
        errorCells.add(formula.key);
        errors.push({ formula, value: cell.t === 'e' ? String(cell.v) : '#REF!', stored: cell.v });
        continue;
      }
      if (computed === undefined) { if (recalc) unverified.push(formula); continue; }
      if (isError(computed)) {
        // An error from a function Univer does not implement says nothing about the file.
        if (unsupported.length || (computed.toUpperCase() === '#NAME?' && !unknownName && info.names.length > 0)) { unverified.push(formula); continue; }
        errorCells.add(formula.key);
        errors.push({ formula, value: computed, stored: cell.v });
        continue;
      }
      if (unsupported.length) { unverified.push(formula); continue; }
      if (cell.cached !== false && !volatile.has(formula.key) && !same(cell.v, computed)) { stale.push(formula); staleKeys.add(formula.key); }
    }

    // Report the first formula in each chain; the ones that only inherit the problem are counted.
    const roots = errors.filter(item => !reads(item.formula, errorCells));
    const inherited = errors.length - roots.length;
    roots.forEach(({ formula, value, stored }, index) => {
      const ref = `${formula.sheet}!${cellRef(formula.cell.r, formula.cell.c)}`;
      const storedNote = formula.cell.cached !== false && !isError(stored) ? ` The file stores ${show(stored)}, but the formula returns ${value} when recalculated.` : '';
      const tail = index === 0 && inherited ? ` ${inherited} other formula${inherited === 1 ? " returns an error only because it reads" : "s return an error only because they read"} a cell that has one.` : '';
      out.add('XL-ERROR', where(formula), `${ref} returns ${value}`, `Formula: ${formula.cell.f}.${storedNote}${tail}`, { actual: value });
    });

    const staleRoots = stale.filter(formula => !reads(formula, staleKeys));
    const staleInherited = stale.length - staleRoots.length;
    staleRoots.forEach((formula, index) => {
      const ref = `${formula.sheet}!${cellRef(formula.cell.r, formula.cell.c)}`;
      const computed = formula.grid.computed(formula.cell);
      const tail = index === 0 && staleInherited ? ` ${staleInherited} other stored result${staleInherited === 1 ? ' is' : 's are'} wrong only because they depend on a cell like this one.` : '';
      out.add('XL-STALE', where(formula), `${ref} stores ${show(formula.cell.v)}, but its formula gives ${show(computed)}`,
        `Formula: ${formula.cell.f}. Recalculated with Univer's formula engine.${tail}`, { expected: show(computed), actual: show(formula.cell.v) });
    });

    const bySheet = (list: FormulaCell[]) => { const map = new Map<string, FormulaCell[]>(); for (const item of list) (map.get(item.sheet) ?? map.set(item.sheet, []).get(item.sheet)!).push(item); return map; };
    for (const [sheet, list] of bySheet(noResult)) {
      const refs = list.map(item => cellRef(item.cell.r, item.cell.c));
      out.add('XL-NO-RESULT', { kind: 'cell', sheet, ref: refs[0], refs: refs.slice(0, 200) }, `${list.length} formula${list.length === 1 ? ' has' : 's have'} no stored result on "${sheet}"`,
        `${compactRefs(refs)}. Excel calculates them on opening, but previews, importers and data libraries read an empty cell. Open and save the file in a spreadsheet app, or have the generator write the results.`,
        { count: list.length }, `sheet:${sheet}`);
    }
    for (const [sheet, list] of bySheet(external)) {
      const refs = list.map(item => cellRef(item.cell.r, item.cell.c));
      out.add('XL-EXTERNAL', { kind: 'cell', sheet, ref: refs[0], refs: refs.slice(0, 200) }, `${list.length} formula${list.length === 1 ? '' : 's'} on "${sheet}" depend${list.length === 1 ? 's' : ''} on another workbook`,
        `${compactRefs(refs)}. For example ${list[0].cell.f}. These were not recalculated.`, { count: list.length }, `sheet:${sheet}`);
    }
    for (const [sheet, list] of bySheet(unverified)) {
      const refs = list.map(item => cellRef(item.cell.r, item.cell.c));
      const functions = [...new Set(list.flatMap(item => item.info.functions.filter(name => !SUPPORTED_FUNCTIONS.has(name))))];
      out.add('XL-NOT-VERIFIED', { kind: 'cell', sheet, ref: refs[0], refs: refs.slice(0, 200) }, `${list.length} formula${list.length === 1 ? '' : 's'} on "${sheet}" could not be verified`,
        `${compactRefs(refs)}. ${functions.length ? `Univer's formula engine does not implement ${functions.join(', ')}.` : 'The formula engine did not return a value.'} Their stored results were left unchecked.`,
        { count: list.length }, `sheet:${sheet}`);
    }

    // Circular references: follow each formula to the formulas it reads.
    if (out.on('XL-CIRCULAR')) {
      const byKey = new Map(formulas.map(formula => [formula.key, formula]));
      const formulaKeys = new Set(byKey.keys());
      const edges = (formula: FormulaCell): string[] => {
        const next: string[] = [];
        for (const ref of formula.info.refs) {
          const grid = ref.area ? gridOf(formula, ref.sheet) : null;
          if (!grid) continue;
          const area = ref.area!;
          const size = (area.r2 - area.r1 + 1) * (area.c2 - area.c1 + 1);
          if (size <= ENUMERATE_LIMIT) { for (let r = area.r1; r <= area.r2; r++) for (let c = area.c1; c <= area.c2; c++) { const key = cellKey(grid.sheet.name, r, c); if (formulaKeys.has(key)) next.push(key); } }
          else for (const other of formulas) if (other.sheet === grid.sheet.name && other.cell.r >= area.r1 && other.cell.r <= area.r2 && other.cell.c >= area.c1 && other.cell.c <= area.c2) next.push(other.key);
        }
        return next;
      };
      const state = new Map<string, 1 | 2>();
      const reported = new Set<string>();
      for (const start of formulas) {
        if (state.has(start.key)) continue;
        const stack: { key: string; next: string[]; i: number }[] = [{ key: start.key, next: edges(start), i: 0 }];
        state.set(start.key, 1);
        while (stack.length) {
          const top = stack[stack.length - 1];
          if (top.i >= top.next.length) { state.set(top.key, 2); stack.pop(); continue; }
          const key = top.next[top.i++];
          const seen = state.get(key);
          if (seen === 1) {
            const loop = stack.slice(stack.findIndex(item => item.key === key)).map(item => byKey.get(item.key)!);
            const first = [...loop].sort((a, b) => a.key.localeCompare(b.key))[0];
            if (!reported.has(first.key)) {
              reported.add(first.key);
              const chain = loop.map(item => `${item.sheet}!${cellRef(item.cell.r, item.cell.c)}`);
              out.add('XL-CIRCULAR', where(first), `Circular reference through ${chain.slice(0, 4).join(' → ')}${chain.length > 4 ? ' …' : ''}`,
                `${chain.join(' → ')} → ${chain[0]}. A formula in this loop depends on its own result.`, { count: loop.length });
            }
          } else if (!seen) { state.set(key, 1); stack.push({ key, next: edges(byKey.get(key)!), i: 0 }); }
        }
      }
    }

    // Formulas that read nothing but empty cells.
    for (const formula of formulas) {
      const { info } = formula;
      if (!info.refs.length || missingSheet.has(formula.key) || info.refs.some(ref => ref.external || !ref.area)) continue;
      const anything = info.refs.some(ref => gridOf(formula, ref.sheet)?.anyFilled(ref.area!));
      if (!anything) out.add('XL-EMPTY-INPUT', where(formula), `${formula.sheet}!${cellRef(formula.cell.r, formula.cell.c)} reads only empty cells`,
        `Formula: ${formula.cell.f}. Every cell it refers to (${info.refs.map(ref => ref.raw).join(', ')}) is empty.`);
    }
  }

  // ---- Tables: headers, blanks, types, totals, formula patterns ----
  const flaggedTotals = new Set<string>();
  for (const [sheetName, grid] of grids) {
    for (const table of findTables(grid)) {
      const totalRows = new Set(table.totalRows);
      const dataRows: number[] = [];
      for (let r = table.firstRow; r <= table.lastRow; r++) if (!totalRows.has(r)) dataRows.push(r);
      const cellWhere = (refs: string[]) => ({ kind: 'cell' as const, sheet: sheetName, ref: refs[0], refs: refs.slice(0, 200) });

      // Headers
      const seen = new Map<string, number>();
      for (let c = table.c1; c <= table.c2; c++) {
        const header = table.headers.get(c);
        const hasData = dataRows.some(r => grid.filled(grid.at(r, c)));
        if (!header && hasData) out.add('XL-HEADER', { kind: 'cell', sheet: sheetName, ref: cellRef(table.headerRow, c) }, `Column ${colName(c)} on "${sheetName}" has data but no header`, `${cellRef(table.headerRow, c)} is blank.`);
        if (header) {
          const lower = header.toLowerCase();
          if (seen.has(lower)) out.add('XL-HEADER', { kind: 'cell', sheet: sheetName, ref: cellRef(table.headerRow, c) }, `The header "${clip(header, 40)}" appears twice on "${sheetName}"`, `Columns ${colName(seen.get(lower)!)} and ${colName(c)} share it.`);
          else seen.set(lower, c);
        }
      }

      for (let c = table.c1; c <= table.c2; c++) {
        const header = table.headers.get(c) ?? `Column ${colName(c)}`;
        const blanks: string[] = [], textNumbers: string[] = [], otherText: { ref: string; value: string }[] = [];
        let numbers = 0, filled = 0, formulaCount = 0;
        const constants: Cell[] = [];
        const formulaCells: Cell[] = [];
        for (const r of dataRows) {
          const cell = grid.at(r, c);
          if (!grid.filled(cell)) { blanks.push(cellRef(r, c)); continue; }
          filled++;
          if (cell!.f) { formulaCount++; formulaCells.push(cell!); }
          const value = grid.value(cell);
          if (typeof value === 'number') { numbers++; if (!cell!.f) constants.push(cell!); }
          else if (typeof value === 'string' && !cell!.f) {
            if (textNumber(value) !== null) textNumbers.push(cellRef(r, c));
            else if (value.trim() && !isError(value)) otherText.push({ ref: cellRef(r, c), value });
          }
        }
        if (dataRows.length >= 4 && blanks.length && filled / dataRows.length >= 0.8) {
          out.add('XL-BLANK', cellWhere(blanks), `${blanks.length} blank cell${blanks.length === 1 ? '' : 's'} in "${clip(header, 40)}" on "${sheetName}"`,
            `${compactRefs(blanks)}. The rest of the column is filled (${filled} of ${dataRows.length}).`, { count: blanks.length }, `${sheetName}!${colName(c)}`);
        }
        const numericLike = numbers + textNumbers.length;
        if (textNumbers.length && filled >= 2 && numericLike / filled >= 0.6 && !(numbers === 0 && ID_HEADER.test(header))) {
          out.add('XL-TEXT-NUMBER', cellWhere(textNumbers), `${textNumbers.length} number${textNumbers.length === 1 ? '' : 's'} stored as text in "${clip(header, 40)}" on "${sheetName}"`,
            `${compactRefs(textNumbers)}. SUM, AVERAGE and comparisons ignore text, so totals over this column are too low.`, { count: textNumbers.length }, `${sheetName}!${colName(c)}`);
        }
        if (otherText.length && filled >= 4 && numericLike / filled >= 0.6) {
          out.add('XL-MIXED', cellWhere(otherText.map(item => item.ref)), `Text in the number column "${clip(header, 40)}" on "${sheetName}"`,
            `${otherText.slice(0, 5).map(item => `${item.ref} holds "${clip(item.value, 24)}"`).join('; ')}${otherText.length > 5 ? `; and ${otherText.length - 5} more` : ''}.`, { count: otherText.length }, `${sheetName}!${colName(c)}`);
        }

        // Formula pattern down the column.
        if (formulaCount >= 3) {
          if (constants.length && formulaCount / (formulaCount + constants.length) >= 0.7) {
            const refs = constants.map(cell => cellRef(cell.r, cell.c));
            const model = formulaCells[0];
            out.add('XL-PATTERN', cellWhere(refs), `Typed number${refs.length === 1 ? '' : 's'} in the formula column "${clip(header, 40)}" on "${sheetName}"`,
              `${compactRefs(refs)} ${refs.length === 1 ? 'holds a typed value' : 'hold typed values'} where the other ${formulaCount} rows have a formula, such as ${model.f} in ${cellRef(model.r, model.c)}.`,
              { count: refs.length, expected: shift(model.f!, 0, constants[0].r - model.r), actual: show(constants[0].v) }, `${sheetName}!${colName(c)}:typed`);
          }
          patternBreaks(formulaCells, 'down').forEach(({ cell, model }) => {
            out.add('XL-PATTERN', { kind: 'cell', sheet: sheetName, ref: cellRef(cell.r, cell.c) }, `${sheetName}!${cellRef(cell.r, cell.c)} does not follow the formula used in the rest of "${clip(header, 40)}"`,
              `It holds ${cell.f}. Filled down from ${cellRef(model.r, model.c)} it would be ${shift(model.f!, 0, cell.r - model.r)}.`, { expected: shift(model.f!, 0, cell.r - model.r), actual: cell.f });
          });
        }
      }

      // Totals
      for (const totalRow of table.totalRows) {
        const label = grid.rows.get(totalRow)!.find(cell => cell.t === 's' && !cell.f && TOTAL_LABEL.test(String(cell.v)))!;
        const subtotal = /sub/i.test(String(label.v));
        const earlierTotals = table.totalRows.filter(r => r < totalRow);
        const from = subtotal && earlierTotals.length ? earlierTotals[earlierTotals.length - 1] + 1 : table.firstRow;
        const rows: number[] = [];
        for (let r = from; r < totalRow; r++) if (!totalRows.has(r)) rows.push(r);
        const rowFormulas: Cell[] = [];
        for (let c = table.c1; c <= table.c2; c++) {
          const cell = grid.at(totalRow, c);
          if (!cell || c === label.c) continue;
          const header = table.headers.get(c) ?? `Column ${colName(c)}`;
          // Averages, rates and prices are not summed, so their total cell is built differently on purpose.
          if (NOT_SUMMED_HEADER.test(header) || cell.fmt?.includes('%')) continue;
          if (cell.f) rowFormulas.push(cell);
          let numericSum = 0, withText = 0, count = 0;
          for (const r of rows) {
            const value = grid.value(grid.at(r, c));
            if (typeof value === 'number') { numericSum += value; withText += value; count++; }
            else if (typeof value === 'string') { const parsed = textNumber(value); if (parsed !== null) withText += parsed; }
          }
          if (count < 2) continue;
          const ref = `${sheetName}!${cellRef(totalRow, c)}`;
          const whereCell = { kind: 'cell' as const, sheet: sheetName, ref: cellRef(totalRow, c) };
          const value = grid.value(cell);
          if (!cell.f) {
            if (typeof value !== 'number') continue;
            if (same(value, numericSum) || same(value, withText)) {
              out.add('XL-HARD-TOTAL', whereCell, `${ref} is a typed total`, `It equals the ${count} rows above it (${show(numericSum)}), but it is a number, not a formula, so it will not follow a change.`);
            } else {
              flaggedTotals.add(cellKey(sheetName, totalRow, c));
              out.add('XL-TOTAL', whereCell, `${ref} says ${show(value)}, but the rows above it add up to ${show(numericSum)}`,
                `"${clip(String(label.v), 30)}" for "${clip(header, 40)}": ${cellRef(rows[0], c)}:${cellRef(rows[rows.length - 1], c)} sums to ${show(numericSum)}. The total is typed in, not calculated.`,
                { expected: show(numericSum), actual: show(value) });
            }
            continue;
          }
          const info = analyze(cell.f, cell.r, cell.c);
          const area = info.refs[0]?.area;
          if (!/^=SUM\([^()]+\)$/i.test(cell.f) || info.refs.length !== 1 || !area || info.refs[0].sheet !== null || area.c1 !== c || area.c2 !== c) continue;
          const numericRows = rows.filter(r => typeof grid.value(grid.at(r, c)) === 'number');
          const left = numericRows.filter(r => r < area.r1 || r > area.r2);
          const doubled = table.totalRows.filter(r => r !== totalRow && r >= area.r1 && r <= area.r2 && typeof grid.value(grid.at(r, c)) === 'number');
          if (left.length) {
            flaggedTotals.add(cellKey(sheetName, totalRow, c));
            out.add('XL-TOTAL', whereCell, `${ref} leaves out ${compactRefs(left.map(r => cellRef(r, c)))}`,
              `${cell.f} covers ${cellRef(area.r1, c)}:${cellRef(area.r2, c)}, but "${clip(header, 40)}" has values in ${cellRef(numericRows[0], c)}:${cellRef(numericRows[numericRows.length - 1], c)}. The total gives ${show(value)}; all the rows add up to ${show(numericSum)}.`,
              { expected: show(numericSum), actual: show(value) });
          } else if (doubled.length && !subtotal) {
            flaggedTotals.add(cellKey(sheetName, totalRow, c));
            out.add('XL-TOTAL', whereCell, `${ref} counts subtotal rows as well as the rows they add up`,
              `${cell.f} includes ${compactRefs(doubled.map(r => cellRef(r, c)))}, which ${doubled.length === 1 ? 'is itself a total' : 'are themselves totals'}. The rows add up to ${show(numericSum)}; the formula gives ${show(value)}.`,
              { expected: show(numericSum), actual: show(value) });
          }
        }
        // The total row's own formulas should match each other across the columns.
        if (rowFormulas.length >= 3) {
          patternBreaks(rowFormulas, 'across').forEach(({ cell, model }) => {
            if (flaggedTotals.has(cellKey(sheetName, cell.r, cell.c))) return;
            out.add('XL-PATTERN', { kind: 'cell', sheet: sheetName, ref: cellRef(cell.r, cell.c) }, `${sheetName}!${cellRef(cell.r, cell.c)} does not follow the formula used in the rest of its row`,
              `It holds ${cell.f}. Filled across from ${cellRef(model.r, model.c)} it would be ${shift(model.f!, cell.c - model.c, 0)}.`, { expected: shift(model.f!, cell.c - model.c, 0), actual: cell.f });
          });
        }
      }
    }
  }
}

/** Formulas in a run that are built differently from the clear majority. */
function patternBreaks(cells: Cell[], _direction: 'down' | 'across'): { cell: Cell; model: Cell }[] {
  if (cells.length < 4) return [];
  const groups = new Map<string, Cell[]>();
  for (const cell of cells) {
    const signature = analyze(cell.f!, cell.r, cell.c).signature;
    (groups.get(signature) ?? groups.set(signature, []).get(signature)!).push(cell);
  }
  if (groups.size < 2) return [];
  const [majority] = [...groups.values()].sort((a, b) => b.length - a.length);
  const others = cells.length - majority.length;
  if (majority.length < 3 || majority.length / cells.length < 0.7 || others > 3) return [];
  return cells.filter(cell => !majority.includes(cell)).map(cell => ({ cell, model: majority[0] }));
}
