// Builds the sample test cases: for each kind of file, a "generated" file with known defects seeded in, a fixed version
// and an approved reference. Every value is synthetic. Run with: npm run samples
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import * as docx from 'docx';
import pptxModule from 'pptxgenjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = (folder, name) => { mkdirSync(path.join(here, folder), { recursive: true }); return path.join(here, folder, name); };
const STAMP = new Date(Date.UTC(2026, 10, 2, 9, 0, 0));

// ---------------------------------------------------------------- spreadsheet
const MONTHS = [
  ['Jan', 118, 1420, 42600, 27100], ['Feb', 104, 1260, 37800, 24300], ['Mar', 131, 1610, 48300, 30900], ['Apr', 126, 1540, 46200, 29700],
  ['May', 142, 1730, 51900, 33000], ['Jun', 137, 1670, 50100, 32200], ['Jul', 149, 1820, 54600, 34800], ['Aug', 153, 1870, 56100, 35600],
  ['Sep', 138, 1690, 50700, 32400], ['Oct', 161, 1965, 58950, 37300],
];
const sum = (index) => MONTHS.reduce((total, row) => total + row[index], 0);

/** `broken` seeds the defects a generator typically makes; without it the workbook is correct. */
async function workbook(file, { broken }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'OfficeProof Lab samples'; wb.created = STAMP; wb.modified = STAMP;
  const ws = wb.addWorksheet('Summary');
  ws.columns = [{ width: 12 }, { width: 10 }, { width: 10 }, { width: 11 }, { width: 13 }, { width: 13 }, { width: 13 }];
  ws.getCell('A1').value = broken ? 'Q3 2026 revenue summary' : 'Revenue summary, January to October 2026';
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getRow(3).values = ['Month', 'Orders', 'Units', 'Avg price', 'Revenue', 'Costs', 'Margin'];
  ws.getRow(3).font = { bold: true };
  MONTHS.forEach(([month, orders, units, revenue, costs], index) => {
    const r = index + 4;
    // Seeded: June has no units, so its average price divides by zero. February to April hold units as text.
    const unitsValue = broken && month === 'Jun' ? 0 : broken && ['Feb', 'Mar', 'Apr'].includes(month) ? String(units) : units;
    const price = broken && month === 'Jun' ? { error: '#DIV/0!' } : revenue / units;
    // Seeded: April's margin uses a different formula from every other row.
    const margin = broken && month === 'Apr' ? { formula: `E${r}-F${r}*0.9`, result: revenue - costs * 0.9 } : { formula: `E${r}-F${r}`, result: revenue - costs };
    ws.getRow(r).values = [month, orders, unitsValue, { formula: `E${r}/C${r}`, result: price }, revenue, costs, margin];
    ws.getCell(`D${r}`).numFmt = '0.00';
    for (const col of ['B', 'C', 'E', 'F', 'G']) ws.getCell(`${col}${r}`).numFmt = '#,##0';
  });
  const marginTotal = MONTHS.reduce((total, row) => total + (row[3] - row[4]), 0);
  ws.getRow(14).values = broken
    ? ['Total',
        sum(1),                                                   // typed, where the reference has a formula
        { formula: 'SUM(C4:C13)', result: 1420 + 1730 + 1820 + 1870 + 1690 + 1965 },
        { formula: 'AVERAGE(D4:D13)', result: { error: '#DIV/0!' } },
        { formula: 'SUM(E4:E11)', result: 387600 },               // leaves out September and October
        { formula: 'SUM(F4:F13)', result: 309000 },               // stored result is stale: the rows add up to 317,300
        { formula: 'SUM(G4:G13)', result: marginTotal + (46200 - 29700 * 0.9) - (46200 - 29700) }]
    : ['Total', { formula: 'SUM(B4:B13)', result: sum(1) }, { formula: 'SUM(C4:C13)', result: sum(2) }, { formula: 'AVERAGE(D4:D13)', result: 30 },
        { formula: 'SUM(E4:E13)', result: sum(3) }, { formula: 'SUM(F4:F13)', result: sum(4) }, { formula: 'SUM(G4:G13)', result: marginTotal }];
  ws.getRow(14).font = { bold: true };
  ws.getCell('D14').numFmt = '0.00';
  for (const col of ['B', 'C', 'E', 'F', 'G']) ws.getCell(`${col}14`).numFmt = '#,##0';

  const forecast = wb.addWorksheet('Forecast');
  forecast.columns = [{ width: 22 }, { width: 14 }];
  forecast.getRow(1).values = ['Measure', 'Value'];
  forecast.getRow(1).font = { bold: true };
  forecast.getRow(2).values = ['Average monthly revenue', { formula: 'AVERAGE(Summary!E4:E13)', result: sum(3) / 10 }];
  forecast.getRow(3).values = ['November forecast', broken
    // Seeded: the generator pointed this at a sheet that does not exist.
    ? { formula: 'Summry!E13*1.03', result: 60718.5 }
    : { formula: 'Summary!E13*1.03', result: 58950 * 1.03 }];
  forecast.getCell('B2').numFmt = '#,##0'; forecast.getCell('B3').numFmt = '#,##0';
  await wb.xlsx.writeFile(file);
}

// ---------------------------------------------------------------- document
const { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } = docx;
const TRANSACTIONS = [['3 Oct 2026', 'Monthly retainer', '1,250.00'], ['11 Oct 2026', 'Site audit', '980.50'], ['24 Oct 2026', 'Data migration', '2,400.00']];

async function letter(file, { broken }) {
  const p = (text, options = {}) => new Paragraph({ children: [new TextRun({ text, font: 'Calibri', size: 22, ...options })], spacing: { after: 160 } });
  const h = (text, level) => new Paragraph({ text, heading: level });
  const cell = (text, bold = false) => new TableCell({ width: { size: 3000, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text, bold, font: 'Calibri', size: 22 })] })] });
  const table = new Table({ width: { size: 9000, type: WidthType.DXA }, rows: [
    new TableRow({ children: [cell('Date', true), cell('Description', true), cell('Amount (USD)', true)] }),
    ...TRANSACTIONS.map(row => new TableRow({ children: row.map(text => cell(text)) })),
    // Seeded: the total does not match the three rows (4,630.50).
    new TableRow({ children: [cell('Total', true), cell(''), cell(broken ? '4,360.50' : '4,630.50', true)] }),
  ] });
  const children = [
    new Paragraph({ text: 'Statement of account', heading: HeadingLevel.TITLE }),
    // Seeded: a template marker that was never filled in.
    p(broken ? 'Prepared for {{client_name}} on 31 October 2026.' : 'Prepared for Harbor Analytics on 31 October 2026.'),
    // Seeded: the model's reply was written into the document.
    ...(broken ? [p('Here is the updated statement you asked for. I hope this helps!')] : []),
    h('Summary', HeadingLevel.HEADING_1),
    p('This statement covers work carried out in October 2026. Three items were billed and no payments were received in the period.'),
    // Seeded: Markdown that was not converted to formatting.
    p(broken ? '**Payment is due within 14 days of this statement.**' : 'Payment is due within 14 days of this statement.', broken ? {} : { bold: true }),
    h('Transactions', HeadingLevel.HEADING_1),
    table,
    p(''),
    // Seeded: a heading level is skipped (1 to 3) in the broken file.
    h('How the total is worked out', broken ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_2),
    p('Each amount is the agreed fee for the item, in US dollars. The total is the sum of the three amounts.'),
    // Seeded: the Next steps section has nothing in it, and the Terms section from the reference is missing.
    h('Next steps', HeadingLevel.HEADING_1),
    ...(broken ? [] : [p('Please pay by bank transfer using the reference HA-2026-10. We will send a receipt within two working days.'),
      h('Terms', HeadingLevel.HEADING_1), p('Amounts unpaid after 30 days carry interest at the rate in the services agreement.')]),
    h('Contact', HeadingLevel.HEADING_1),
    p('Questions about this statement can be sent to accounts@example.com.'),
  ];
  const doc = new Document({ creator: 'OfficeProof Lab samples', title: 'Statement of account', sections: [{ children }] });
  writeFileSync(file, await Packer.toBuffer(doc));
}

// ---------------------------------------------------------------- slides
const PptxGenJS = pptxModule.default ?? pptxModule;

async function deck(file, { broken }) {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_16x9'; pres.author = 'OfficeProof Lab samples'; pres.title = 'Board update';
  const title = (slide, text) => slide.addText(text, { x: 0.5, y: 0.35, w: 9, h: 0.8, fontSize: 30, bold: true, fontFace: 'Arial', color: '111111' });
  const body = (slide, text, box = {}) => slide.addText(text, { x: 0.5, y: 1.4, w: 5.6, h: 3.4, fontSize: 18, fontFace: 'Arial', color: '333333', valign: 'top', ...box });

  let slide = pres.addSlide();
  slide.addText('Board update, October 2026', { x: 0.8, y: 1.6, w: 8.4, h: 1.2, fontSize: 40, bold: true, fontFace: 'Arial', color: '111111' });
  slide.addText('Month-end pack', { x: 0.8, y: 3.0, w: 6, h: 0.6, fontSize: 20, fontFace: 'Arial', color: '555555' });

  slide = pres.addSlide();
  title(slide, 'Revenue by region');
  const chartData = [{ name: 'Revenue', labels: ['North', 'West', 'South', 'East'], values: [182, 141, 96, 78] }];
  // Seeded: the chart sits lower and is narrower than in the reference, and the notes box is shorter.
  slide.addChart(pres.ChartType.bar, chartData, broken ? { x: 0.8, y: 2.3, w: 4.2, h: 2.9 } : { x: 0.5, y: 1.4, w: 5.4, h: 3.8 });
  body(slide, 'North leads.\nWest recovered in the third quarter.\nSouth is flat.', broken ? { x: 6.2, y: 1.7, w: 3.2, h: 1.6 } : { x: 6.2, y: 1.4, w: 3.3, h: 3.4 });

  slide = pres.addSlide();
  title(slide, 'What changed this month');
  // Seeded: nine lines in a box that holds about six.
  body(slide, broken
    ? 'Revenue grew 7 percent on last month.\nUnits recovered after the June gap.\nAverage price held at 30.00.\nCosts rose with volume.\nMargin widened in September.\nThe April margin formula differs.\nTwo totals need review.\nThe forecast is not verified.\nThe next pack is due 5 December.'
    : 'Revenue grew 7 percent on last month.\nUnits recovered after the June gap.\nAverage price held at 30.00.\nCosts rose with volume.', broken ? { w: 4.4, h: 2.2 } : { w: 8.8, h: 3.4 });

  slide = pres.addSlide();
  title(slide, 'Costs');
  body(slide, 'Costs totalled 317,300 for the ten months.\nThe largest month was October.');
  // Seeded: an 8 point footnote, and a callout that runs off the right edge of the slide.
  slide.addText('Figures are unaudited and exclude one-off items recorded after the month-end close.', { x: 0.5, y: 5.0, w: 6.5, h: 0.4, fontSize: broken ? 8 : 11, fontFace: 'Arial', color: '555555' });
  slide.addText('Largest month: October', broken ? { x: 8.2, y: 2.2, w: 3.2, h: 0.9, fontSize: 16, fontFace: 'Arial' } : { x: 6.4, y: 2.2, w: 3.1, h: 0.9, fontSize: 16, fontFace: 'Arial' });

  slide = pres.addSlide();
  title(slide, 'Outlook');
  // Seeded: a template marker left on the slide.
  body(slide, broken ? 'Growth is forecast at {{growth_rate}} for November.\nThe forecast uses October as its base.' : 'Growth is forecast at 3 percent for November.\nThe forecast uses October as its base.', { w: 8.8 });

  slide = pres.addSlide();
  // Seeded: the last slide has no title; the reference calls it "Next steps".
  if (!broken) title(slide, 'Next steps');
  body(slide, 'Review the two totals on the revenue summary.\nApprove the November forecast.\nAgree the date of the next board pack.', { w: 8.8, fontSize: 18 });

  writeFileSync(file, await pres.write({ outputType: 'nodebuffer' }));
}

await workbook(out('generated', 'revenue-summary.xlsx'), { broken: true });
await workbook(out('fixed', 'revenue-summary.xlsx'), { broken: false });
await workbook(out('reference', 'revenue-summary.reference.xlsx'), { broken: false });
await letter(out('generated', 'client-statement.docx'), { broken: true });
await letter(out('fixed', 'client-statement.docx'), { broken: false });
await letter(out('reference', 'client-statement.reference.docx'), { broken: false });
await deck(out('generated', 'board-update.pptx'), { broken: true });
await deck(out('fixed', 'board-update.pptx'), { broken: false });
await deck(out('reference', 'board-update.reference.pptx'), { broken: false });
console.log('Sample files written to samples/generated, samples/fixed and samples/reference');
