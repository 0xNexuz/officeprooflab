// The viewer's use of Univer's own Office import: the findings must land on the right cell, paragraph, table cell and
// box of the imported data, and the viewer must fall back when they cannot.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readModel, runChecks } from '../lib/engine/index.ts';
import { importedDocLayout, outline, paint } from '../lib/imported/doc.ts';
import { markWorkbook } from '../lib/imported/sheet.ts';
import { overlayDeck } from '../lib/imported/slides.ts';
import { importWithUniver, univerImportStatus } from '../lib/server/univer-import.ts';

const sample = (name) => new Uint8Array(readFileSync(new URL(`../samples/${name}`, import.meta.url)));
const TONES = { fail: { bg: { rgb: '#F00' } }, warn: { bg: { rgb: '#FA0' } }, ai: { bg: { rgb: '#00F' } }, info: { bg: { rgb: '#999' } } };
const DOC_TONES = Object.fromEntries(Object.entries(TONES).map(([tone, style]) => [tone, { text: style, cell: style.bg.rgb }]));
const finding = (where, extra = {}) => ({ id: JSON.stringify(where), check: 'T', label: 'confirmed', severity: 'fail', title: 't', detail: '', where, ...extra });
const available = (await univerImportStatus()).available;
const needsImport = { skip: available ? false : 'Univer\'s import has no native package for this platform' };

// ---------------------------------------------------------------- placing findings (no converter needed)

test('a document stream is split into top-level paragraphs and tables with their rows and cells', () => {
  const stream = 'Title\r\x1A\x1B\x1CA\r\n\x1D\x1CB\r\n\x1D\x0E\x1B\x1CC\r\n\x1D\x1CD\r\n\x1D\x0E\x0F\rAfter\r\n';
  const found = outline(stream);
  assert.deepEqual(found.paragraphs.map(item => item.text), ['Title', '', 'After']);
  assert.equal(found.tables.length, 1);
  assert.deepEqual(found.tables[0].rows.map(row => row.cells.map(cell => stream.slice(cell.start, cell.end - 2))), [['A', 'B'], ['C', 'D']]);
});

test('a mark is laid over the runs a file already has without losing their style', () => {
  const runs = paint([{ st: 0, ed: 10, ts: { bl: 1 } }], [{ start: 4, end: 14, style: { bg: { rgb: '#F00' } } }]);
  assert.deepEqual(runs, [
    { st: 0, ed: 4, ts: { bl: 1 } },
    { st: 4, ed: 10, ts: { bl: 1, bg: { rgb: '#F00' } } },
    { st: 10, ed: 14, ts: { bg: { rgb: '#F00' } } },
  ]);
});

test('a flagged cell keeps the style the file gave it and gains its tone; an empty flagged cell is created', () => {
  const data = { id: 'x', sheetOrder: ['s1'], styles: { bold: { bl: 1 } }, sheets: { s1: { id: 's1', name: 'Summary', rowCount: 2, columnCount: 2, cellData: { 0: { 0: { v: 1, s: 'bold' } } } } } };
  const marked = markWorkbook(data, [finding({ kind: 'cell', sheet: 'Summary', ref: 'A1' }), finding({ kind: 'cell', sheet: 'Summary', ref: 'D5' }, { severity: 'warn' })], TONES, 'book');
  const a1 = marked.sheets.s1.cellData[0][0], d5 = marked.sheets.s1.cellData[4][3];
  assert.deepEqual(marked.styles[a1.s], { bl: 1, bg: { rgb: '#F00' } });
  assert.equal(a1.v, 1);
  assert.deepEqual(marked.styles[d5.s], { bg: { rgb: '#FA0' } });
  assert.equal(marked.sheets.s1.rowCount, 5);
  assert.equal(marked.sheets.s1.columnCount, 4);
  assert.equal(data.sheets.s1.cellData[0][0].s, 'bold', 'the imported data is not changed');
});

test('a flagged box is outlined on its slide, the reference boxes are drawn, and the slide itself is untouched', () => {
  const shape = (name, box) => ({ id: '1', name, type: 'text', placeholder: null, box, text: 'x', paragraphs: ['x'], minFont: null, maxFont: null, fonts: [], autofit: false, missingMedia: false });
  const deck = { kind: 'pptx', size: { w: 9144000, h: 5143500 }, slides: [{ index: 0, layout: '', title: null, notes: '', hidden: false, shapes: [shape('Text 0', { x: 914400, y: 914400, w: 1828800, h: 914400 })] }], fonts: [], themeFonts: { major: null, minor: null } };
  const data = { defaultPageSize: { width: 720, height: 405 }, slideOrder: ['s1'], slides: { s1: { id: 's1', elementOrder: ['shape-1'], elements: { 'shape-1': { id: 'shape-1', name: 'Text 0', type: 'shape' } } } } };
  const out = overlayDeck(data, deck, [finding({ kind: 'slide', index: 0, shape: 'Text 0' })], deck, 'deck');
  const slide = out.slides.s1;
  assert.deepEqual(slide.elementOrder, ['shape-1', 'officeproof-flag-0-0', 'officeproof-ref-0-0']);
  assert.deepEqual(slide.elements['officeproof-flag-0-0'].transform, { left: 68, top: 68, width: 152, height: 80, rotation: 0 });
  assert.equal(slide.elements['officeproof-flag-0-0'].shapeData.stroke.color, '#D21F26');
  assert.deepEqual(slide.elements['officeproof-ref-0-0'].transform, { left: 72, top: 72, width: 144, height: 72, rotation: 0 });
  assert.deepEqual(data.slides.s1.elementOrder, ['shape-1'], 'the imported data is not changed');
});

// ---------------------------------------------------------------- Univer's import itself

test('Univer\'s import reads the sample workbook with its sheets, formulas and stored results', needsImport, async () => {
  const result = await importWithUniver(sample('generated/revenue-summary.xlsx'), 'xlsx');
  const book = result.data;
  assert.deepEqual(book.sheetOrder.map(id => book.sheets[id].name), ['Summary', 'Forecast']);
  const total = book.sheets[book.sheetOrder[0]].cellData[13][5];
  assert.equal(total.f, '=SUM(F4:F13)');
  assert.equal(Number(total.v), 309000, 'the stale stored result is kept, not recalculated');
});

test('every finding on the sample document is placed on the imported document', needsImport, async () => {
  const bytes = sample('generated/client-statement.docx');
  const [{ result }, imported] = [await runChecks({ name: 'client-statement.docx', bytes }), await importWithUniver(bytes, 'docx')];
  const layout = importedDocLayout('doc', imported.data, readModel(bytes), result.findings, DOC_TONES);
  assert.ok(layout, 'the document is shown as imported');
  const stream = layout.data.body.dataStream;
  const placeholder = result.findings.find(item => item.check === 'DOC-PLACEHOLDER');
  const [start, end] = layout.place(placeholder.where);
  assert.match(stream.slice(start, end), /\{\{client_name\}\}/);
  assert.ok(layout.data.body.textRuns.some(run => run.st <= start && run.ed >= end && run.ts?.bg?.rgb === '#F00'), 'the paragraph is marked');
  const total = result.findings.find(item => item.check === 'DOC-TABLE-TOTAL');
  const [cellStart, cellEnd] = layout.place(total.where);
  assert.equal(stream.slice(cellStart, cellEnd), '4,360.50');
  const table = Object.values(layout.data.tableSource)[0];
  assert.equal(table.tableRows[4].tableCells[2].backgroundColor.rgb, '#F00');
  assert.equal(table.tableRows[4].tableCells[0].backgroundColor, undefined);
});

test('a finding that cannot be placed on the imported document sends the viewer back to the structure view', needsImport, async () => {
  const bytes = sample('generated/client-statement.docx');
  const imported = await importWithUniver(bytes, 'docx');
  assert.equal(importedDocLayout('doc', imported.data, readModel(bytes), [finding({ kind: 'paragraph', index: 999 })], DOC_TONES), null);
});

test('Univer\'s import reads the sample deck slide for slide, in the engine\'s order and units', needsImport, async () => {
  const bytes = sample('generated/board-update.pptx');
  const [deck, imported] = [readModel(bytes), await importWithUniver(bytes, 'pptx')];
  const data = imported.data;
  assert.equal(data.slideOrder.length, deck.slides.length);
  assert.deepEqual([data.defaultPageSize.width, data.defaultPageSize.height], [deck.size.w / 12700, deck.size.h / 12700]);
  // The box the engine measured and the element Univer imported sit in the same place.
  const shape = deck.slides[3].shapes.find(item => item.name === 'Text 3');
  const element = Object.values(data.slides[data.slideOrder[3]].elements).find(item => item.name === 'Text 3');
  assert.ok(Math.abs(element.transform.left - shape.box.x / 12700) < 0.5);
  assert.ok(Math.abs(element.transform.width - shape.box.w / 12700) < 0.5);
});

test('a file that is not an Office file gives no import, and never an error', needsImport, async () => {
  assert.equal(await importWithUniver(new Uint8Array([1, 2, 3, 4]), 'docx'), null);
});
