import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { compareRuns, describeRule, evaluate, readModel, runChecks, toHtml, toJUnit, toMarkdown, validateRules, EngineError } from '../lib/engine/index.ts';
import { miniDocx, miniPptx, miniXlsx } from './helpers/mini.mjs';

const sample = (name) => new Uint8Array(readFileSync(new URL(`../samples/${name}`, import.meta.url)));
const run = async (bytes, extra = {}) => (await runChecks({ name: 'file', bytes, ...extra })).result;
const ids = (result, check) => result.findings.filter(finding => finding.check === check);
const has = (result, check) => ids(result, check).length > 0;

// ---------------------------------------------------------------- spreadsheets

test('a sheet is read row by row, and the parts around the rows are still read', () => {
  const rows = '<row r="1"><c r="A1" t="inlineStr"><is><t>Region</t></is></c><c r="B1"><v>4</v></c></row><row r="2"/><row r="3"><c r="A3"><v>7</v></c></row>';
  const model = readModel(miniXlsx({ sheets: [{ name: 'S', rows, after: '<mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells><rowBreaks count="1"><brk id="2"/></rowBreaks>' }] }));
  assert.deepEqual(model.sheets[0].cells.map(cell => [cell.r, cell.c, cell.v]), [[0, 0, 'Region'], [0, 1, 4], [2, 0, 7]]);
  assert.deepEqual(model.sheets[0].merges, ['A1:B1']);
});

test('a workbook too large to read in full is a warning, never a pass', async () => {
  let rows = '';
  for (let r = 1; r <= 20001; r++) { rows += `<row r="${r}">`; for (let c = 0; c < 20; c++) rows += `<c r="${String.fromCharCode(65 + c)}${r}"><v>${r + c}</v></c>`; rows += '</row>'; }
  const result = await run(miniXlsx({ sheets: [{ name: 'Big', rows }] }));
  assert.equal(result.stats.cells, 400000);
  assert.equal(result.stats.truncated, true);
  assert.equal(result.verdict, 'warn');
  assert.equal(ids(result, 'XL-PARTIAL').length, 1);
});

test('a part too large to read as a whole is refused with a reason', () => {
  assert.throws(() => readModel(miniDocx({ blocks: ['word '.repeat(1_800_000)] })), error => error instanceof EngineError && error.code === 'too_large');
});

test('a stored result that differs from the formula is reported with both values', async () => {
  const result = await run(miniXlsx({ sheets: [{ name: 'S', cells: { A1: 10, A2: 20, A3: { f: 'SUM(A1:A2)', v: 99 } } }] }));
  const [finding] = ids(result, 'XL-STALE');
  assert.equal(result.verdict, 'fail');
  assert.equal(finding.expected, '30');
  assert.equal(finding.actual, '99');
  assert.deepEqual(finding.where, { kind: 'cell', sheet: 'S', ref: 'A3' });
});

test('only the first stale or failing formula in a chain is reported', async () => {
  const result = await run(miniXlsx({ sheets: [{ name: 'S', cells: { A1: 5, A2: { f: 'A1*2', v: 11 }, A3: { f: 'A2+1', v: 12 }, B1: 0, B2: { f: 'A1/B1', e: '#DIV/0!' }, B3: { f: 'B2+1', e: '#DIV/0!' } } }] }));
  assert.deepEqual(ids(result, 'XL-STALE').map(finding => finding.where.ref), ['A2']);
  assert.deepEqual(ids(result, 'XL-ERROR').map(finding => finding.where.ref), ['B2']);
  assert.match(ids(result, 'XL-ERROR')[0].detail, /1 other formula returns an error only because it reads/);
});

test('formulas with no stored result are a warning, and are still recalculated and checked', async () => {
  const result = await run(miniXlsx({ sheets: [{ name: 'S', cells: { A1: 1, A2: 2, A3: { f: 'SUM(A1:A2)' }, A4: { f: 'A3/0' } } }] }));
  assert.equal(ids(result, 'XL-NO-RESULT')[0].count, 2);
  assert.equal(ids(result, 'XL-ERROR')[0].where.ref, 'A4');
  assert.equal(has(result, 'XL-STALE'), false);
});

test('a correct workbook passes, and a workbook with no formulas skips the formula checks', async () => {
  const good = await run(miniXlsx({ sheets: [{ name: 'S', cells: { A1: 'Item', B1: 'Cost', A2: 'a', B2: 1, A3: 'b', B3: 2, A4: 'Total', B4: { f: 'SUM(B2:B3)', v: 3 } } }] }));
  assert.equal(good.verdict, 'pass');
  assert.equal(good.findings.length, 0);
  const plain = await run(miniXlsx({ sheets: [{ name: 'S', cells: { A1: 'x', B1: 1 } }] }));
  assert.equal(plain.checks.find(check => check.id === 'XL-STALE').status, 'skipped');
  assert.equal(plain.checks.find(check => check.id === 'XL-STALE').note, 'The workbook has no formulas');
});

test('totals: a typed total that is wrong fails, a typed total that is right is a note, a short SUM range fails', async () => {
  const rows = { A1: 'Item', B1: 'Cost', C1: 'Tax', D1: 'Fee', A2: 'a', B2: 10, C2: 1, D2: 5, A3: 'b', B3: 20, C3: 2, D3: 5, A4: 'c', B4: 30, C4: 3, D4: 5 };
  const result = await run(miniXlsx({ sheets: [{ name: 'S', cells: { ...rows, A5: 'Total', B5: 70, C5: 6, D5: { f: 'SUM(D2:D3)', v: 10 } } }] }));
  assert.equal(ids(result, 'XL-TOTAL').find(finding => finding.where.ref === 'B5').expected, '60');
  assert.equal(ids(result, 'XL-HARD-TOTAL')[0].where.ref, 'C5');
  assert.match(ids(result, 'XL-TOTAL').find(finding => finding.where.ref === 'D5').title, /leaves out D4/);
});

test('a grand total that double-counts a subtotal is caught; a subtotal summing its own group is not', async () => {
  const cells = { A1: 'Item', B1: 'Cost', A2: 'a', B2: 1, A3: 'b', B3: 2, A4: 'Subtotal', B4: { f: 'SUM(B2:B3)', v: 3 }, A5: 'c', B5: 4, A6: 'd', B6: 5, A7: 'Subtotal', B7: { f: 'SUM(B5:B6)', v: 9 }, A8: 'Total', B8: { f: 'SUM(B2:B7)', v: 24 } };
  const result = await run(miniXlsx({ sheets: [{ name: 'S', cells }] }));
  const totals = ids(result, 'XL-TOTAL');
  assert.equal(totals.length, 1);
  assert.equal(totals[0].where.ref, 'B8');
  assert.match(totals[0].title, /counts subtotal rows/);
});

test('missing sheets, circular references, text numbers and pattern breaks', async () => {
  const cells = { A1: 'n', B1: 'double', A2: 1, B2: { f: 'A2*2', v: 2 }, A3: 2, B3: { f: 'A3*2', v: 4 }, A4: '3', B4: { f: 'A4*2', v: 6 }, A5: 4, B5: { f: 'A5*3', v: 12 }, A6: 5, B6: { f: 'A6*2', v: 10 },
    D9: { f: 'Nowhere!A1', v: 0 }, E9: { f: 'E10+1', v: 0 }, E10: { f: 'E9+1', v: 0 } };
  const result = await run(miniXlsx({ sheets: [{ name: 'S', cells }] }));
  assert.match(ids(result, 'XL-MISSING-SHEET')[0].title, /"Nowhere"/);
  assert.equal(ids(result, 'XL-CIRCULAR').length, 1);
  assert.equal(ids(result, 'XL-PATTERN').find(finding => finding.where.ref === 'B5').expected, '=A5*2');
});

test('numbers stored as text are found in a mostly numeric column, and ids are left alone', async () => {
  const cells = { A1: 'Code', B1: 'Qty', A2: '0012', B2: 5, A3: '0034', B3: '7', A4: '0056', B4: 9, A5: '0078', B5: 11 };
  const result = await run(miniXlsx({ sheets: [{ name: 'S', cells }] }));
  const found = ids(result, 'XL-TEXT-NUMBER');
  assert.equal(found.length, 1);
  assert.equal(found[0].where.ref, 'B3');
});

test('volatile formulas are not compared with their stored result', async () => {
  const result = await run(miniXlsx({ sheets: [{ name: 'S', cells: { A1: { f: 'RAND()', v: 0.5 }, A2: { f: 'A1*2', v: 1 }, A3: { f: 'TODAY()', v: 1 } } }] }));
  assert.equal(has(result, 'XL-STALE'), false);
});

test('a function the engine does not implement is "not verified", never a pass or an error', async () => {
  const result = await run(miniXlsx({ sheets: [{ name: 'S', cells: { A1: 1, A2: { f: 'NOSUCHFUNCTION(A1)', v: 5 } } }] }));
  assert.equal(has(result, 'XL-ERROR'), false);
  assert.equal(ids(result, 'XL-NOT-VERIFIED')[0].count, 1);
  assert.equal(result.verdict, 'pass');
  assert.equal(result.summary.info, 1);
});

test('rules: sum, equals, headers and required sheet', async () => {
  const bytes = miniXlsx({ sheets: [{ name: 'Data', cells: { A1: 'Item', B1: 'Cost', A2: 'a', B2: 10, A3: 'b', B3: 20, A4: 'Total', B4: { f: 'SUM(B2:B2)', v: 10 } } }] });
  const rules = [{ cell: 'Data!B4', sumOf: 'B2:B3' }, { cell: 'B2', equals: 10 }, { headers: 'Data!A1:B1', equal: ['Item', 'Price'] }, { sheet: 'Summary' }, { range: 'Data!A2:A3', unique: true }];
  const result = await run(bytes, { options: { rules } });
  const failed = ids(result, 'XL-RULE').map(finding => finding.id);
  assert.deepEqual(failed, ['XL-RULE:rule1', 'XL-RULE:rule3', 'XL-RULE:rule4']);
  assert.throws(() => validateRules('xlsx', [{ heading: 'x' }]), /do not apply to spreadsheets/);
  assert.throws(() => validateRules('xlsx', [{ cell: 'A1', equals: 1, sumOf: 'A1:A2' }]), EngineError);
  assert.throws(() => validateRules('docx', [{ words: { min: 'ten' } }]), /Rule 1/);
});

test('a disabled check is skipped, not passed', async () => {
  const result = await run(miniXlsx({ sheets: [{ name: 'S', cells: { A1: 1, A2: { f: 'A1+1', v: 9 } } }] }), { options: { disable: ['XL-STALE'] } });
  assert.equal(has(result, 'XL-STALE'), false);
  assert.equal(result.checks.find(check => check.id === 'XL-STALE').status, 'skipped');
  assert.equal(result.verdict, 'pass');
});

test('the same file always gives the same findings', async () => {
  const bytes = sample('generated/revenue-summary.xlsx');
  const reference = { name: 'ref', bytes: sample('reference/revenue-summary.reference.xlsx') };
  const a = await run(bytes, { reference }), b = await run(bytes, { reference });
  assert.deepEqual(a.findings, b.findings);
  assert.deepEqual(a.checks, b.checks);
  assert.equal(a.file.sha256, b.file.sha256);
});

test('sample workbook: every seeded defect is found, and the fixed file passes', async () => {
  const reference = { name: 'ref.xlsx', bytes: sample('reference/revenue-summary.reference.xlsx') };
  const broken = await run(sample('generated/revenue-summary.xlsx'), { reference });
  assert.deepEqual(broken.findings.map(finding => finding.id).sort(), ['XL-ERROR:Summary!D9', 'XL-HARD-TOTAL:Summary!B14', 'XL-MISSING-SHEET:Forecast!B3', 'XL-PATTERN:Summary!G7',
    'XL-REF-FORMULAS:summary:t0', 'XL-STALE:Summary!F14', 'XL-TEXT-NUMBER:Summary!C', 'XL-TOTAL:Summary!E14']);
  assert.equal(broken.verdict, 'fail');
  const fixed = await run(sample('fixed/revenue-summary.xlsx'), { reference });
  assert.equal(fixed.verdict, 'pass');
  assert.equal(fixed.findings.length, 0);
  const diff = compareRuns(broken.findings, fixed.findings);
  assert.equal(diff.fixed.length, 8);
  assert.equal(diff.added.length, 0);
});

// ---------------------------------------------------------------- documents

test('document text checks: placeholder, assistant phrase, Markdown, and clean text', async () => {
  const result = await run(miniDocx({ blocks: [{ h: 1, text: 'Report' }, 'Dear [Insert client name], thank you.', 'As an AI language model, I cannot sign this.', 'See the ## Results section and **bold** text.', 'A normal sentence about the 3 * 4 grid and item [2].'] }));
  assert.equal(ids(result, 'DOC-PLACEHOLDER').length, 1);
  assert.equal(ids(result, 'DOC-AI-ARTIFACT').length, 1);
  assert.equal(ids(result, 'DOC-MARKDOWN').length, 1);
  assert.equal(ids(result, 'DOC-PLACEHOLDER')[0].where.index, 1);
});

test('custom placeholder phrases are plain text, not patterns', async () => {
  const bytes = miniDocx({ blocks: [{ h: 1, text: 'T' }, 'Value: (a+)+$ marker here', 'Other text'] });
  const result = await run(bytes, { options: { placeholders: ['(a+)+$'] } });
  assert.equal(ids(result, 'DOC-PLACEHOLDER').length, 1);
});

test('document structure: empty section, skipped level, repeated paragraph, review marks, missing image', async () => {
  const long = 'This paragraph is long enough to count as a repeat when it appears twice.';
  const result = await run(miniDocx({ comments: 2, blocks: [{ h: 1, text: 'One' }, long, long, { h: 3, text: 'Deep' }, 'text', { h: 1, text: 'Empty' }, { h: 1, text: 'Last' }, 'end', { image: 'missing' }, { image: 'present' }] }));
  assert.match(ids(result, 'DOC-EMPTY-SECTION')[0].title, /"Empty"/);
  assert.equal(ids(result, 'DOC-EMPTY-SECTION').length, 1);
  assert.equal(ids(result, 'DOC-HEADING-ORDER').length, 1);
  assert.equal(ids(result, 'DOC-REPEAT').length, 1);
  assert.equal(ids(result, 'DOC-REVIEW-MARKS')[0].count, 2);
  assert.equal(ids(result, 'DOC-IMAGE').length, 1);
});

test('document table totals: wrong total fails, whole-number rounding is a warning, right total passes', async () => {
  const table = (total) => ({ table: [['Item', 'Amount'], ['a', '1,200.50'], ['b', '300.25'], ['Total', total]] });
  assert.equal(ids(await run(miniDocx({ blocks: [{ h: 1, text: 'T' }, table('1,500.75')] })), 'DOC-TABLE-TOTAL').length, 0);
  const wrong = ids(await run(miniDocx({ blocks: [{ h: 1, text: 'T' }, table('1,600.75')] })), 'DOC-TABLE-TOTAL');
  assert.equal(wrong[0].severity, 'fail');
  assert.equal(wrong[0].expected, '1,500.75');
  const rounded = ids(await run(miniDocx({ blocks: [{ h: 1, text: 'T' }, { table: [['Item', 'Thousands'], ['a', '12'], ['b', '30'], ['c', '41'], ['Total', '84']] }] })), 'DOC-TABLE-TOTAL');
  assert.equal(rounded[0].severity, 'warn');
});

test('an empty document fails', async () => {
  const result = await run(miniDocx({ blocks: [''] }));
  assert.equal(has(result, 'DOC-EMPTY'), true);
});

test('sample letter: seeded defects found, fixed file passes', async () => {
  const reference = { name: 'ref.docx', bytes: sample('reference/client-statement.reference.docx') };
  const broken = await run(sample('generated/client-statement.docx'), { reference });
  for (const check of ['DOC-PLACEHOLDER', 'DOC-AI-ARTIFACT', 'DOC-MARKDOWN', 'DOC-EMPTY-SECTION', 'DOC-TABLE-TOTAL', 'DOC-REF-HEADINGS', 'DOC-HEADING-ORDER']) assert.equal(ids(broken, check).length, 1, check);
  assert.equal(broken.findings.length, 7);
  const fixed = await run(sample('fixed/client-statement.docx'), { reference });
  assert.equal(fixed.findings.length, 0);
});

// ---------------------------------------------------------------- slides

test('slide checks: off-slide text, empty slide, missing picture, small text, empty placeholder, overlap', async () => {
  const result = await run(miniPptx({ slides: [
    [{ ph: 'title', text: 'Title', x: 0.5, y: 0.3, w: 9, h: 0.8, size: 30 }, { text: 'Runs off', x: 8.5, y: 2, w: 3, h: 1, size: 18 }, { picture: 'missing', x: 1, y: 2, w: 2, h: 2 }],
    [],
    [{ ph: 'title', text: '', x: 0.5, y: 0.3, w: 9, h: 0.8 }, { text: 'tiny', x: 1, y: 2, w: 4, h: 1, size: 7 }, { text: 'over', x: 1.2, y: 2.1, w: 4, h: 1, size: 18 }],
  ] }));
  assert.equal(ids(result, 'PPT-OFF-SLIDE')[0].where.index, 0);
  assert.equal(ids(result, 'PPT-EMPTY-SLIDE')[0].where.index, 1);
  assert.equal(ids(result, 'PPT-IMAGE').length, 1);
  assert.equal(ids(result, 'PPT-SMALL-TEXT')[0].actual, '7 pt');
  assert.equal(ids(result, 'PPT-EMPTY-BOX').length, 1);
  assert.equal(ids(result, 'PPT-OVERLAP').length, 1);
  assert.equal(ids(result, 'PPT-NO-TITLE')[0].where.index, 2);
});

test('visual findings never change the verdict', async () => {
  const text = Array.from({ length: 12 }, (_x, i) => `Line ${i + 1} of a long list of points`).join('\n');
  const result = await run(miniPptx({ slides: [[{ ph: 'title', text: 'Title', x: 0.5, y: 0.3, w: 9, h: 0.8, size: 30 }, { text, x: 0.5, y: 1.4, w: 4, h: 1.5, size: 18 }]] }));
  assert.equal(ids(result, 'PPT-VIS-OVERFLOW').length, 1);
  assert.equal(ids(result, 'PPT-VIS-OVERFLOW')[0].label, 'visual');
  assert.equal(result.verdict, 'pass');
  assert.equal(result.summary.visual, 1);
});

test('deck reference comparison: count, size, titles and layout', async () => {
  const slide = (title, x) => [{ ph: 'title', text: title, x: 0.5, y: 0.3, w: 9, h: 0.8, size: 30 }, { text: 'Body', x, y: 1.5, w: 4, h: 3, size: 18 }];
  const reference = { name: 'ref.pptx', bytes: miniPptx({ slides: [slide('Intro', 0.5), slide('Plan', 0.5)] }) };
  const result = await run(miniPptx({ width: 13.333, height: 7.5, slides: [slide('Intro', 5.5)] }), { reference });
  assert.equal(ids(result, 'PPT-REF-COUNT').length, 1);
  assert.equal(ids(result, 'PPT-REF-SIZE').length, 1);
  assert.match(ids(result, 'PPT-REF-TITLES')[0].title, /"Plan"/);
  const same = await run(miniPptx({ slides: [slide('Intro', 0.5), slide('Plan', 0.5)] }), { reference });
  assert.equal(same.findings.length, 0);
  const moved = await run(miniPptx({ slides: [slide('Intro', 5.5), slide('Plan', 0.5)] }), { reference });
  assert.equal(ids(moved, 'PPT-VIS-LAYOUT')[0].where.index, 0);
  assert.equal(moved.verdict, 'pass');
});

test('sample deck: seeded defects found, fixed file passes', async () => {
  const reference = { name: 'ref.pptx', bytes: sample('reference/board-update.reference.pptx') };
  const broken = await run(sample('generated/board-update.pptx'), { reference });
  assert.deepEqual(broken.summary.fail, 2);
  assert.equal(ids(broken, 'PPT-PLACEHOLDER')[0].where.index, 4);
  assert.equal(ids(broken, 'PPT-OFF-SLIDE')[0].where.index, 3);
  assert.equal(broken.summary.visual, 4);
  const fixed = await run(sample('fixed/board-update.pptx'), { reference });
  assert.equal(fixed.findings.length, 0);
});

// ---------------------------------------------------------------- untrusted input and reports

test('files that are not Office files are refused with a clear reason', async () => {
  await assert.rejects(run(strToU8('just some text')), /not an Office Open XML file/);
  await assert.rejects(run(zipSync({ 'hello.txt': strToU8('hi') })), /not a spreadsheet/);
  await assert.rejects(run(new Uint8Array([0x50, 0x4b, 3, 4, 9, 9, 9, 9])), /could not be unpacked/);
  const doctype = zipSync({ 'xl/workbook.xml': strToU8('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><workbook/>') });
  await assert.rejects(run(doctype), /document type declaration/);
  await assert.rejects(run(new Uint8Array(4 * 1024 * 1024 + 1)), /up to 4 MB/);
});

test('a reference of a different kind is refused', async () => {
  const sheet = miniXlsx({ sheets: [{ name: 'S', cells: { A1: 1 } }] });
  await assert.rejects(run(sheet, { reference: { name: 'ref.docx', bytes: miniDocx({ blocks: ['x'] }) } }), /reference is a document/);
});

test('the kind comes from the content, and evaluate works on a model without recalculation', () => {
  const model = readModel(miniXlsx({ sheets: [{ name: 'S', cells: { A1: 1, A2: { f: 'A1/0', e: '#DIV/0!' } } }] }));
  assert.equal(model.kind, 'xlsx');
  const { findings, checks } = evaluate(model, null, null);
  assert.equal(findings[0].check, 'XL-ERROR');
  assert.match(checks.find(check => check.id === 'XL-ERROR').note, /stored results only/);
});

test('reports: Markdown, JUnit and HTML carry the verdict and escape file content', async () => {
  const result = await run(miniDocx({ blocks: [{ h: 1, text: 'T' }, 'Hello <script>alert(1)</script> {{name}} & more'] }));
  const html = toHtml(result), junit = toJUnit([result]), md = toMarkdown(result);
  assert.equal(html.includes('<script>alert(1)</script>'), false);
  assert.match(html, /&lt;\/script&gt;/);
  assert.match(junit, /<failure message=/);
  assert.equal(junit.includes('<script>'), false);
  assert.match(md, /\*\*FAIL: 1 confirmed failure/);
  assert.match(md, /A skipped or unverified check is not a pass/);
});

test('a rule reads as a sentence, with the noun matching its number', () => {
  assert.equal(describeRule({ tables: 1 }), 'The document has exactly 1 table');
  assert.equal(describeRule({ tables: 2 }), 'The document has exactly 2 tables');
  assert.equal(describeRule({ slides: { min: 1 } }), 'The deck has at least 1 slide');
  assert.equal(describeRule({ slides: { min: 1, max: 12 } }), 'The deck has at least 1 and at most 12 slides');
  assert.equal(describeRule({ words: { max: 600 } }), 'The document has at most 600 words');
});
