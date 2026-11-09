// A test case's own expectations ("rules"): validated up front, then checked like any other deterministic check.
import { areaRef, cellRef, parseArea, type Area } from './a1.ts';
import { Grid, same } from './checks-xlsx.ts';
import { Collector, clip, show } from './collect.ts';
import { describeRule } from './describe.ts';
export { describeRule } from './describe.ts';
import { headingsOf } from './checks-docx.ts';
import type { Recalculation } from './recalc.ts';
import { EngineError, type CellValue, type Deck, type DocumentModel, type FileKind, type Rule, type Workbook } from './types.ts';

const KINDS: Record<string, FileKind[]> = {
  cell: ['xlsx'], range: ['xlsx'], headers: ['xlsx'], sheet: ['xlsx'],
  heading: ['docx'], words: ['docx'], tables: ['docx'],
  slides: ['pptx'], slide: ['pptx'],
  contains: ['xlsx', 'docx', 'pptx'], notContains: ['xlsx', 'docx', 'pptx'],
};
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isBounds = (value: unknown) => isRecord(value) && ['min', 'max'].every(key => value[key] === undefined || (typeof value[key] === 'number' && Number.isFinite(value[key] as number)));
const text = (value: unknown, max = 300): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

/** Checks the shape of every rule and that it applies to this kind of file. Throws an EngineError naming the rule at fault. */
export function validateRules(kind: FileKind, rules: unknown): Rule[] {
  if (rules === undefined || rules === null) return [];
  if (!Array.isArray(rules)) throw new EngineError('invalid_rule', 'Rules must be a list');
  if (rules.length > 200) throw new EngineError('invalid_rule', 'A test case can have up to 200 rules');
  return rules.map((rule, index) => {
    const fail = (why: string): never => { throw new EngineError('invalid_rule', `Rule ${index + 1}: ${why}`); };
    if (!isRecord(rule)) return fail('must be an object');
    const lead = Object.keys(KINDS).find(key => key in rule);
    if (!lead) return fail(`is not a known rule. Use one of: ${Object.keys(KINDS).join(', ')}`);
    if (!KINDS[lead].includes(kind)) return fail(`"${lead}" rules do not apply to ${kind === 'xlsx' ? 'spreadsheets' : kind === 'docx' ? 'documents' : 'slides'}`);
    const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
    switch (lead) {
      case 'cell': {
        if (!text(rule.cell, 80) || !parseArea(rule.cell)) return fail('"cell" must be a cell such as "Summary!E14"');
        const forms = ['equals', 'sumOf', 'between', 'isFormula'].filter(key => key in rule);
        if (forms.length !== 1) return fail('a cell rule needs exactly one of equals, sumOf, between, isFormula');
        if ('equals' in rule && !(rule.equals === null || ['string', 'number', 'boolean'].includes(typeof rule.equals))) return fail('"equals" must be text, a number, true, false or null');
        if ('sumOf' in rule && (!text(rule.sumOf, 80) || !parseArea(rule.sumOf))) return fail('"sumOf" must be a range such as "E4:E13"');
        if ('between' in rule && !(Array.isArray(rule.between) && rule.between.length === 2 && rule.between.every(number) && rule.between[0] <= rule.between[1])) return fail('"between" must be two numbers, lowest first');
        if ('isFormula' in rule && typeof rule.isFormula !== 'boolean') return fail('"isFormula" must be true or false');
        if ('tolerance' in rule && !(number(rule.tolerance) && (rule.tolerance as number) >= 0)) return fail('"tolerance" must be a number, 0 or more');
        break;
      }
      case 'range':
        if (!text(rule.range, 80) || !parseArea(rule.range)) return fail('"range" must be a range such as "Data!A2:A50"');
        if (['noBlanks', 'allNumbers', 'unique'].filter(key => rule[key] === true).length !== 1) return fail('a range rule needs exactly one of noBlanks, allNumbers, unique set to true');
        break;
      case 'headers':
        if (!text(rule.headers, 80) || !parseArea(rule.headers)) return fail('"headers" must be a range such as "Summary!A3:G3"');
        if (!(Array.isArray(rule.equal) && rule.equal.length > 0 && rule.equal.length <= 200 && rule.equal.every(item => typeof item === 'string'))) return fail('"equal" must be a list of header names');
        break;
      case 'sheet': if (!text(rule.sheet, 80)) return fail('"sheet" must be a sheet name'); break;
      case 'heading': if (!text(rule.heading)) return fail('"heading" must be the heading text'); break;
      case 'contains': if (!text(rule.contains)) return fail('"contains" must be text'); break;
      case 'notContains': if (!text(rule.notContains)) return fail('"notContains" must be text'); break;
      case 'words': if (!isBounds(rule.words)) return fail('"words" must look like { "min": 200, "max": 900 }'); break;
      case 'tables': if (!(number(rule.tables) || isBounds(rule.tables))) return fail('"tables" must be a number or { "min": 1, "max": 3 }'); break;
      case 'slides': if (!(number(rule.slides) || isBounds(rule.slides))) return fail('"slides" must be a number or { "min": 5, "max": 12 }'); break;
      case 'slide':
        if (!(Number.isInteger(rule.slide) && (rule.slide as number) >= 1)) return fail('"slide" must be a slide number, starting at 1');
        if (!text(rule.title)) return fail('a slide rule needs "title"');
        break;
    }
    return rule as Rule;
  });
}

const within = (value: number, bound: number | { min?: number; max?: number }) => typeof bound === 'number' ? value === bound : (bound.min === undefined || value >= bound.min) && (bound.max === undefined || value <= bound.max);
const lower = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();

export function applyWorkbookRules(workbook: Workbook, recalc: Recalculation | null, rules: Rule[], out: Collector) {
  const grids = new Map(workbook.sheets.map(sheet => [sheet.name.toLowerCase(), new Grid(sheet, recalc)]));
  const first = workbook.sheets[0]?.name ?? '';
  const locate = (ref: string, fallbackSheet?: string) => {
    const area = parseArea(ref)!;
    const sheetName = area.sheet ?? fallbackSheet ?? first;
    return { area, sheetName, grid: grids.get(sheetName.toLowerCase()) ?? null };
  };
  const cells = (grid: Grid, area: Area) => {
    const r2 = Math.min(area.r2, grid.sheet.rows - 1), c2 = Math.min(area.c2, grid.sheet.cols - 1);
    const list: { r: number; c: number; value: CellValue; filled: boolean }[] = [];
    for (let r = area.r1; r <= r2; r++) for (let c = area.c1; c <= c2; c++) { const cell = grid.at(r, c); list.push({ r, c, value: grid.value(cell), filled: grid.filled(cell) }); }
    return list;
  };
  rules.forEach((rule, index) => {
    const key = `rule${index + 1}`;
    const title = `Rule ${index + 1} failed: ${describeRule(rule)}`;
    const missing = (sheetName: string) => out.add('XL-RULE', { kind: 'file' }, title, `There is no sheet named "${sheetName}".`, {}, key);
    if ('sheet' in rule) { if (!grids.has(rule.sheet.toLowerCase())) missing(rule.sheet); return; }
    if ('contains' in rule || 'notContains' in rule) {
      const needle = lower('contains' in rule ? rule.contains : rule.notContains);
      let found: { sheet: string; ref: string } | null = null;
      outer: for (const sheet of workbook.sheets) for (const cell of sheet.cells) if (typeof cell.v === 'string' && lower(cell.v).includes(needle)) { found = { sheet: sheet.name, ref: cellRef(cell.r, cell.c) }; break outer; }
      if ('contains' in rule && !found) out.add('XL-RULE', { kind: 'file' }, title, 'No cell contains this text.', {}, key);
      if ('notContains' in rule && found) out.add('XL-RULE', { kind: 'cell', sheet: found.sheet, ref: found.ref }, title, `${found.sheet}!${found.ref} contains it.`, {}, key);
      return;
    }
    if ('cell' in rule) {
      const { area, sheetName, grid } = locate(rule.cell);
      if (!grid) { missing(sheetName); return; }
      const where = { kind: 'cell' as const, sheet: grid.sheet.name, ref: cellRef(area.r1, area.c1) };
      const cell = grid.at(area.r1, area.c1);
      const value = grid.value(cell);
      if ('equals' in rule) {
        const ok = typeof rule.equals === 'number' && typeof value === 'number' && rule.tolerance !== undefined ? Math.abs(value - rule.equals) <= rule.tolerance
          : typeof rule.equals === 'string' && typeof value === 'string' ? rule.equals.trim() === value.trim() : same(value, rule.equals);
        if (!ok) out.add('XL-RULE', where, title, `${where.sheet}!${where.ref} is ${show(value)}.`, { expected: show(rule.equals), actual: show(value) }, key);
      } else if ('sumOf' in rule) {
        const range = locate(rule.sumOf, grid.sheet.name);
        if (!range.grid) { missing(range.sheetName); return; }
        const sum = cells(range.grid, range.area).reduce((total, item) => total + (typeof item.value === 'number' ? item.value : 0), 0);
        const ok = typeof value === 'number' && (rule.tolerance !== undefined ? Math.abs(value - sum) <= rule.tolerance : same(value, sum));
        if (!ok) out.add('XL-RULE', where, title, `${where.sheet}!${where.ref} is ${show(value)}; ${areaRef(range.area)} adds up to ${show(sum)}.`, { expected: show(sum), actual: show(value) }, key);
      } else if ('between' in rule) {
        if (!(typeof value === 'number' && value >= rule.between[0] && value <= rule.between[1])) out.add('XL-RULE', where, title, `${where.sheet}!${where.ref} is ${show(value)}.`, { expected: `${show(rule.between[0])} to ${show(rule.between[1])}`, actual: show(value) }, key);
      } else if (Boolean(cell?.f) !== rule.isFormula) {
        out.add('XL-RULE', where, title, `${where.sheet}!${where.ref} holds ${cell?.f ? `the formula ${cell.f}` : `the typed value ${show(value)}`}.`, { expected: rule.isFormula ? 'A formula' : 'A typed value', actual: cell?.f ?? show(value) }, key);
      }
      return;
    }
    const { area, sheetName, grid } = locate('range' in rule ? rule.range : (rule as { headers: string }).headers);
    if (!grid) { missing(sheetName); return; }
    const list = cells(grid, area);
    const at = (item: { r: number; c: number }) => cellRef(item.r, item.c);
    const where = (refs: string[]) => ({ kind: 'cell' as const, sheet: grid.sheet.name, ref: refs[0] ?? cellRef(area.r1, area.c1), ...(refs.length > 1 ? { refs: refs.slice(0, 200) } : {}) });
    if ('headers' in rule) {
      const actual = list.filter(item => item.r === area.r1).map(item => String(item.value ?? '').trim());
      while (actual.length && !actual[actual.length - 1]) actual.pop();
      const ok = actual.length === rule.equal.length && rule.equal.every((name, i) => lower(name) === lower(actual[i]));
      if (!ok) out.add('XL-RULE', where([cellRef(area.r1, area.c1)]), title, `The row holds: ${actual.length ? actual.join(', ') : 'nothing'}.`, { expected: rule.equal.join(', '), actual: actual.join(', ') }, key);
    } else if ('noBlanks' in rule) {
      const blanks = [];
      for (let r = area.r1; r <= Math.min(area.r2, Math.max(area.r1, grid.sheet.rows - 1)); r++) for (let c = area.c1; c <= Math.min(area.c2, Math.max(area.c1, grid.sheet.cols - 1)); c++) if (!grid.filled(grid.at(r, c))) blanks.push(cellRef(r, c));
      if (blanks.length) out.add('XL-RULE', where(blanks), title, `${blanks.length} blank cell${blanks.length === 1 ? '' : 's'}: ${blanks.slice(0, 8).join(', ')}${blanks.length > 8 ? ' and more' : ''}.`, { count: blanks.length }, key);
    } else if ('allNumbers' in rule) {
      const bad = list.filter(item => item.filled && typeof item.value !== 'number');
      if (bad.length) out.add('XL-RULE', where(bad.map(at)), title, `${bad.slice(0, 5).map(item => `${at(item)} holds ${show(item.value)}`).join('; ')}${bad.length > 5 ? `; and ${bad.length - 5} more` : ''}.`, { count: bad.length }, key);
    } else {
      const seen = new Map<string, string>(), repeats: string[] = [];
      for (const item of list) { if (!item.filled) continue; const id = typeof item.value === 'string' ? lower(item.value) : String(item.value); if (seen.has(id)) repeats.push(at(item)); else seen.set(id, at(item)); }
      if (repeats.length) out.add('XL-RULE', where(repeats), title, `${repeats.length} repeated value${repeats.length === 1 ? '' : 's'}: ${repeats.slice(0, 8).join(', ')}${repeats.length > 8 ? ' and more' : ''}.`, { count: repeats.length }, key);
    }
  });
}

export function applyDocumentRules(doc: DocumentModel, rules: Rule[], out: Collector) {
  const all = lower([...doc.blocks.map(block => block.type === 'p' ? block.text : block.rows.flat().join(' ')), ...doc.headers, ...doc.footers].join('\n'));
  const tables = doc.blocks.filter(block => block.type === 'table').length;
  rules.forEach((rule, index) => {
    const key = `rule${index + 1}`, title = `Rule ${index + 1} failed: ${describeRule(rule)}`;
    if ('heading' in rule) {
      if (!headingsOf(doc).some(block => lower(block.text) === lower(rule.heading))) out.add('DOC-RULE', { kind: 'file' }, title, `The document's headings are: ${headingsOf(doc).slice(0, 12).map(block => `"${clip(block.text, 40)}"`).join(', ') || 'none'}.`, {}, key);
    } else if ('contains' in rule) {
      if (!all.includes(lower(rule.contains))) out.add('DOC-RULE', { kind: 'file' }, title, 'The text was not found in the document.', {}, key);
    } else if ('notContains' in rule) {
      const hit = doc.blocks.find(block => lower(block.type === 'p' ? block.text : block.rows.flat().join(' ')).includes(lower(rule.notContains)));
      if (hit || all.includes(lower(rule.notContains))) out.add('DOC-RULE', hit ? (hit.type === 'p' ? { kind: 'paragraph', index: hit.index } : { kind: 'table', index: hit.tableIndex }) : { kind: 'file' }, title, 'The text was found in the document.', {}, key);
    } else if ('words' in rule) {
      if (!within(doc.words, rule.words)) out.add('DOC-RULE', { kind: 'file' }, title, `The document has ${doc.words.toLocaleString('en-US')} words.`, { actual: String(doc.words) }, key);
    } else if ('tables' in rule) {
      if (!within(tables, rule.tables)) out.add('DOC-RULE', { kind: 'file' }, title, `The document has ${tables} table${tables === 1 ? '' : 's'}.`, { actual: String(tables) }, key);
    }
  });
}

export function applyDeckRules(deck: Deck, rules: Rule[], out: Collector) {
  const slideText = (index: number) => lower(deck.slides[index].shapes.map(shape => shape.text).join('\n'));
  rules.forEach((rule, index) => {
    const key = `rule${index + 1}`, title = `Rule ${index + 1} failed: ${describeRule(rule)}`;
    if ('slides' in rule) {
      if (!within(deck.slides.length, rule.slides)) out.add('PPT-RULE', { kind: 'file' }, title, `The deck has ${deck.slides.length} slide${deck.slides.length === 1 ? '' : 's'}.`, { actual: String(deck.slides.length) }, key);
    } else if ('slide' in rule) {
      const slide = deck.slides[rule.slide - 1];
      if (!slide) out.add('PPT-RULE', { kind: 'file' }, title, `The deck has only ${deck.slides.length} slide${deck.slides.length === 1 ? '' : 's'}.`, {}, key);
      else if (lower(slide.title ?? '') !== lower(rule.title)) out.add('PPT-RULE', { kind: 'slide', index: slide.index }, title, slide.title ? `Its title is "${clip(slide.title, 80)}".` : 'It has no title.', { expected: rule.title, actual: slide.title ?? 'No title' }, key);
    } else if ('contains' in rule) {
      if (!deck.slides.some(slide => slideText(slide.index).includes(lower(rule.contains)))) out.add('PPT-RULE', { kind: 'file' }, title, 'The text was not found on any slide.', {}, key);
    } else if ('notContains' in rule) {
      const hit = deck.slides.find(slide => slideText(slide.index).includes(lower(rule.notContains)));
      if (hit) out.add('PPT-RULE', { kind: 'slide', index: hit.index }, title, `It appears on slide ${hit.index + 1}.`, {}, key);
    }
  });
}
