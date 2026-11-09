// Reads a .xlsx package into the engine's workbook model: stored values, formulas and whether each formula has a stored result.
import { LexerTreeBuilder } from '@univerjs/engine-formula';
import { parseCell } from './a1.ts';
import { deep, kid, kids, parseXml, path, refuseDoctype, scan, type Package } from './zip.ts';
import { EngineError, type Cell, type Sheet, type Workbook } from './types.ts';

export const MAX_CELLS = 400_000;
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
const BUILTIN_FORMATS: Record<number, string> = { 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00', 49: '@' };

function isDateFormat(code: string) {
  const bare = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return /[dmyhs]/i.test(bare) && !/general/i.test(bare);
}

function sharedStrings(pkg: Package, file: string | undefined): string[] {
  const source = file ? pkg.text(file) : null;
  if (source === null) return [];
  refuseDoctype(source);
  const out: string[] = [];
  for (const si of scan(source, 'si')) {
    const direct = kid(si, 't');
    out.push(direct ? direct.text : kids(si, 'r').map(run => kid(run, 't')?.text ?? '').join(''));
  }
  return out;
}

function formats(pkg: Package, file: string | undefined): { code: string | null; date: boolean }[] {
  const root = file ? pkg.xml(file) : null;
  if (!root) return [];
  const custom = new Map<number, string>();
  for (const fmt of kids(kid(root, 'numFmts'), 'numFmt')) custom.set(Number(fmt.attrs.numFmtId), fmt.attrs.formatCode ?? '');
  return kids(kid(root, 'cellXfs'), 'xf').map(xf => {
    const id = Number(xf.attrs.numFmtId ?? 0);
    const code = custom.get(id) ?? BUILTIN_FORMATS[id] ?? null;
    return { code, date: custom.has(id) ? isDateFormat(custom.get(id)!) : BUILTIN_DATE_FORMATS.has(id) };
  });
}

/** Functions newer than the file format are stored with a prefix; the formula engine expects the plain name. */
const plainFormula = (text: string) => text.replace(/_xlfn\.(?:_xlws\.)?|_xlws\./g, '');

export function readWorkbook(pkg: Package): Workbook {
  const workbook = pkg.xml('xl/workbook.xml');
  if (!workbook) throw new EngineError('corrupt', 'The spreadsheet has no workbook part');
  const rels = pkg.rels('xl/workbook.xml');
  const byType = (type: string) => [...rels.values()].find(rel => rel.type === type)?.target;
  const strings = sharedStrings(pkg, byType('sharedStrings'));
  const xfs = formats(pkg, byType('styles'));
  const lexer = new LexerTreeBuilder();
  let budget = MAX_CELLS;
  let truncated = false;

  const sheets: Sheet[] = [];
  for (const entry of kids(kid(workbook, 'sheets'), 'sheet')) {
    const rel = rels.get(entry.attrs['r:id'] ?? '');
    const state = entry.attrs.state === 'hidden' ? 'hidden' : entry.attrs.state === 'veryHidden' ? 'veryHidden' : 'visible';
    const sheet: Sheet = { name: entry.attrs.name ?? `Sheet${sheets.length + 1}`, state, cells: [], rows: 0, cols: 0, merges: [] };
    sheets.push(sheet);
    // Chart sheets and macro sheets have no cell grid.
    if (!rel || rel.type !== 'worksheet') continue;
    const source = pkg.text(rel.target);
    if (source === null) continue;
    refuseDoctype(source);
    // The rows are read one at a time; everything around them (merged cells and so on) is read as a small tree.
    const dataStart = source.indexOf('<sheetData');
    const dataEnd = dataStart < 0 ? -1 : source.indexOf('</sheetData>', dataStart);
    const root = dataEnd < 0 ? parseXml(source) : parseXml(`${source.slice(0, dataStart)}<sheetData/>${source.slice(dataEnd + 12)}`);
    const rows = dataEnd < 0 ? kids(kid(root, 'sheetData'), 'row') : scan(source.slice(dataStart, dataEnd), 'row');
    const shared = new Map<string, { formula: string; r: number; c: number }>();
    let rowIndex = -1;
    for (const row of rows) {
      rowIndex = row.attrs.r ? Number(row.attrs.r) - 1 : rowIndex + 1;
      let colIndex = -1;
      for (const c of kids(row, 'c')) {
        const at = c.attrs.r ? parseCell(c.attrs.r) : null;
        colIndex = at ? at.c : colIndex + 1;
        const r = at ? at.r : rowIndex;
        const fNode = kid(c, 'f');
        const vNode = kid(c, 'v');
        const type = c.attrs.t ?? 'n';
        let formula: string | undefined;
        if (fNode) {
          if (fNode.attrs.t === 'shared' && fNode.attrs.si !== undefined) {
            const master = shared.get(fNode.attrs.si);
            if (fNode.text) { formula = `=${plainFormula(fNode.text)}`; shared.set(fNode.attrs.si, { formula, r, c: colIndex }); }
            else if (master) formula = lexer.moveFormulaRefOffset(master.formula, colIndex - master.c, r - master.r);
          } else if (fNode.text) formula = `=${plainFormula(fNode.text)}`;
        }
        const raw = vNode?.text ?? '';
        let cell: Cell | null = null;
        if (type === 's') cell = { r, c: colIndex, v: strings[Number(raw)] ?? '', t: 's' };
        else if (type === 'inlineStr') cell = { r, c: colIndex, v: deep(kid(c, 'is'), 't').map(t => t.text).join(''), t: 's' };
        else if (type === 'str') cell = { r, c: colIndex, v: raw, t: 's' };
        else if (type === 'b') cell = { r, c: colIndex, v: raw === '1', t: 'b' };
        else if (type === 'e') cell = { r, c: colIndex, v: raw, t: 'e' };
        else if (type === 'd') cell = { r, c: colIndex, v: raw, t: 's', date: true };
        else if (raw !== '' && Number.isFinite(Number(raw))) cell = { r, c: colIndex, v: Number(raw), t: 'n' };
        else if (formula) cell = { r, c: colIndex, v: null, t: 'z' };
        if (!cell) continue;
        if (formula) {
          cell.f = formula;
          // A formula written by a generator that never calculated it has no stored result.
          cell.cached = type === 'str' ? Boolean(vNode) : cell.t !== 'z';
        }
        const xf = xfs[Number(c.attrs.s ?? -1)];
        if (xf?.code && xf.code !== '@') cell.fmt = xf.code;
        if (xf?.date && cell.t === 'n') cell.date = true;
        if (budget-- <= 0) { truncated = true; break; }
        sheet.cells.push(cell);
        if (r + 1 > sheet.rows) sheet.rows = r + 1;
        if (colIndex + 1 > sheet.cols) sheet.cols = colIndex + 1;
      }
      if (truncated) break;
    }
    sheet.merges = kids(kid(root, 'mergeCells'), 'mergeCell').map(merge => merge.attrs.ref).filter(Boolean);
  }
  if (!sheets.length) throw new EngineError('corrupt', 'The spreadsheet has no sheets');
  return {
    kind: 'xlsx', sheets,
    definedNames: kids(kid(workbook, 'definedNames'), 'definedName').filter(name => !name.attrs.name?.startsWith('_xlnm.')).map(name => ({ name: name.attrs.name ?? '', ref: name.text })),
    externalLinks: kids(path(workbook, 'externalReferences'), 'externalReference').length,
    hasMacros: pkg.names.has('xl/vbaProject.bin'),
    truncated,
  };
}

export const cellKey = (sheet: string, r: number, c: number) => `${sheet}\u0000${r},${c}`;
export function indexWorkbook(workbook: Workbook) {
  const map = new Map<string, Cell>();
  for (const sheet of workbook.sheets) for (const cell of sheet.cells) map.set(cellKey(sheet.name, cell.r, cell.c), cell);
  return map;
}
