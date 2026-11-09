// Every check the engine can run: what it looks for, which label it carries and how serious a finding is.
import type { FileKind, Label, Severity } from './types.ts';

export type CheckInfo = {
  id: string; kind: FileKind; title: string; label: Label; severity: Severity;
  /** Plain-language description, used in the docs and the app. */
  about: string;
  needs?: 'reference' | 'rules' | 'formulas';
};

const xl = (id: string, title: string, severity: Severity, about: string, needs?: CheckInfo['needs']): CheckInfo => ({ id, kind: 'xlsx', title, label: 'confirmed', severity, about, needs });
const doc = (id: string, title: string, severity: Severity, about: string, needs?: CheckInfo['needs']): CheckInfo => ({ id, kind: 'docx', title, label: 'confirmed', severity, about, needs });
const ppt = (id: string, title: string, severity: Severity, about: string, needs?: CheckInfo['needs'], label: Label = 'confirmed'): CheckInfo => ({ id, kind: 'pptx', title, label, severity, about, needs });

export const CATALOG: CheckInfo[] = [
  // Spreadsheets
  xl('XL-ERROR', 'Formulas that return an error', 'fail', 'A formula returns #REF!, #DIV/0!, #VALUE!, #NAME?, #N/A, #NUM! or #NULL!. Only the first formula in a chain is reported; the cells that depend on it are counted.', 'formulas'),
  xl('XL-MISSING-SHEET', 'Formulas that point to a sheet that is not there', 'fail', 'A formula refers to a sheet name that does not exist in the workbook.', 'formulas'),
  xl('XL-STALE', 'Stored results that differ from the formula', 'fail', 'The value saved in the file is not what the formula gives when recalculated with Univer. Viewers that do not recalculate will show the wrong number.', 'formulas'),
  xl('XL-CIRCULAR', 'Circular references', 'fail', 'A formula depends on its own result, directly or through other cells.', 'formulas'),
  xl('XL-TOTAL', 'Totals that do not match their rows', 'fail', 'A row labelled Total or Subtotal does not equal the sum of the rows above it, or its SUM range leaves rows out.'),
  xl('XL-NO-RESULT', 'Formulas with no stored result', 'warn', 'The generator wrote formulas but never calculated them. Excel recalculates on open, but previews, importers and data libraries read an empty cell.', 'formulas'),
  xl('XL-EMPTY-INPUT', 'Formulas over empty cells', 'warn', 'Every cell a formula refers to is empty, so its result is 0 or blank whatever the data.', 'formulas'),
  xl('XL-PATTERN', 'Formulas that break the pattern of their neighbours', 'warn', 'In a run of formulas down a column or along a row, one formula is built differently, or a typed number sits where a formula should be.', 'formulas'),
  xl('XL-EXTERNAL', 'Formulas that depend on another workbook', 'warn', 'A formula links to a different file, which the recipient will not have.', 'formulas'),
  xl('XL-HARD-TOTAL', 'Totals typed as numbers', 'info', 'A total is correct but typed in, so it will not follow a change to the rows above.'),
  xl('XL-NOT-VERIFIED', 'Formulas the engine could not verify', 'info', 'Univer could not calculate the formula (for example an unsupported function), so the stored result was left unchecked. This is not a pass.', 'formulas'),
  xl('XL-BLANK', 'Missing values inside a table', 'warn', 'A column that is otherwise filled has blank cells.'),
  xl('XL-TEXT-NUMBER', 'Numbers stored as text', 'warn', 'Cells hold numbers as text, so SUM and other functions ignore them.'),
  xl('XL-MIXED', 'Text in a number column', 'warn', 'A numeric column contains text such as "N/A" or "TBD".'),
  xl('XL-HEADER', 'Blank or repeated column headers', 'warn', 'A column with data has no header, or two columns share one.'),
  xl('XL-PARTIAL', 'Workbooks too large to check in full', 'warn', 'The workbook has more than 400,000 filled cells. Only the first 400,000 were read, so the rest were not checked. A partly checked workbook is never reported as a pass.'),
  xl('XL-EMPTY-SHEET', 'Empty sheets', 'info', 'A sheet has no content.'),
  xl('XL-RULE', 'Test case rules', 'fail', 'Expectations written for this test case: expected values, sums, required sheets and headers.', 'rules'),
  xl('XL-REF-SHEETS', 'Sheets compared with the reference', 'fail', 'A sheet in the approved reference is missing from the generated file.', 'reference'),
  xl('XL-REF-HEADERS', 'Columns compared with the reference', 'fail', 'A column header in the approved reference is missing, or the columns are in a different order.', 'reference'),
  xl('XL-REF-FORMULAS', 'Formulas replaced by typed values', 'fail', 'A cell that is a formula in the approved reference is a typed value in the generated file.', 'reference'),

  // Documents
  doc('DOC-PLACEHOLDER', 'Leftover placeholders', 'fail', 'Template markers or filler were left in the text: {{name}}, [Insert …], TODO, TBD, Lorem ipsum.'),
  doc('DOC-AI-ARTIFACT', 'Assistant text left in the document', 'fail', 'Phrases from a model reply rather than the document: "As an AI language model", "Here is the document you asked for", "I hope this helps".'),
  doc('DOC-MARKDOWN', 'Markdown that was not converted', 'fail', 'Raw Markdown shows in the text: **bold**, ## headings, backticks or table pipes.'),
  doc('DOC-EMPTY-SECTION', 'Headings with nothing under them', 'fail', 'A heading is followed directly by another heading or the end of the document.'),
  doc('DOC-TABLE-TOTAL', 'Table totals that do not add up', 'fail', 'A table row labelled Total does not equal the sum of the rows above it.'),
  doc('DOC-IMAGE', 'Missing images', 'fail', 'The document refers to an image that is not in the file.'),
  doc('DOC-EMPTY', 'Empty document', 'fail', 'The document has no text.'),
  doc('DOC-HEADING-ORDER', 'Heading levels that skip', 'warn', 'A heading jumps more than one level, for example from Heading 1 to Heading 3.'),
  doc('DOC-TABLE-CELLS', 'Empty table cells', 'warn', 'A table has empty cells or rows of different lengths.'),
  doc('DOC-REPEAT', 'Repeated paragraphs', 'warn', 'The same paragraph appears twice in a row.'),
  doc('DOC-REVIEW-MARKS', 'Comments or tracked changes left in', 'warn', 'The file still carries comments or unaccepted tracked changes.'),
  doc('DOC-RULE', 'Test case rules', 'fail', 'Expectations written for this test case: required headings and phrases, word and table counts.', 'rules'),
  doc('DOC-REF-HEADINGS', 'Headings compared with the reference', 'fail', 'A heading in the approved reference is missing, or the sections are in a different order.', 'reference'),
  doc('DOC-REF-TABLES', 'Tables compared with the reference', 'fail', 'The number of tables or their column headers differ from the approved reference.', 'reference'),
  doc('DOC-REF-PAGE', 'Page setup compared with the reference', 'warn', 'Page size, orientation or margins differ from the approved reference.', 'reference'),
  doc('DOC-REF-FONTS', 'Fonts compared with the reference', 'warn', 'The document uses fonts the approved reference does not.', 'reference'),
  doc('DOC-REF-LENGTH', 'Length compared with the reference', 'warn', 'The document is much shorter or longer than the approved reference.', 'reference'),

  // Presentations
  ppt('PPT-PLACEHOLDER', 'Leftover placeholders', 'fail', 'Template markers or filler were left on a slide: {{name}}, [Insert …], TODO, Lorem ipsum.'),
  ppt('PPT-AI-ARTIFACT', 'Assistant text left on a slide', 'fail', 'Phrases from a model reply rather than the deck.'),
  ppt('PPT-MARKDOWN', 'Markdown that was not converted', 'fail', 'Raw Markdown shows on a slide.'),
  ppt('PPT-OFF-SLIDE', 'Content outside the slide', 'fail', 'A text box, picture or table extends beyond the edge of the slide.'),
  ppt('PPT-EMPTY-SLIDE', 'Empty slides', 'fail', 'A slide has no text, pictures, tables or charts.'),
  ppt('PPT-IMAGE', 'Missing pictures', 'fail', 'A slide refers to a picture that is not in the file.'),
  ppt('PPT-NO-TITLE', 'Slides without a title', 'warn', 'A slide has no title text.'),
  ppt('PPT-EMPTY-BOX', 'Empty placeholders', 'warn', 'A title or content placeholder was left empty.'),
  ppt('PPT-OVERLAP', 'Overlapping text boxes', 'warn', 'Two text boxes cover a large part of each other.'),
  ppt('PPT-SMALL-TEXT', 'Text too small to read', 'warn', 'Text is set smaller than 10 points.'),
  ppt('PPT-REPEAT-TITLE', 'Repeated slide titles', 'info', 'Two or more slides share the same title.'),
  ppt('PPT-RULE', 'Test case rules', 'fail', 'Expectations written for this test case: slide count, titles, required and banned phrases.', 'rules'),
  ppt('PPT-REF-COUNT', 'Slide count compared with the reference', 'fail', 'The deck has a different number of slides from the approved reference.', 'reference'),
  ppt('PPT-REF-SIZE', 'Slide size compared with the reference', 'fail', 'The slide size or aspect ratio differs from the approved reference.', 'reference'),
  ppt('PPT-REF-TITLES', 'Slide titles compared with the reference', 'warn', 'A slide title in the approved reference is missing from the deck.', 'reference'),
  ppt('PPT-REF-FONTS', 'Fonts compared with the reference', 'warn', 'The deck uses fonts the approved reference does not.', 'reference'),
  ppt('PPT-VIS-OVERFLOW', 'Text that may not fit its box', 'warn', 'An estimate from the font size and the amount of text. Rendering differs between apps, so this is not a confirmed failure.', undefined, 'visual'),
  ppt('PPT-VIS-LAYOUT', 'Layout compared with the reference', 'warn', 'How closely each slide\'s boxes line up with the same slide in the approved reference. A comparison of positions, not of pixels.', 'reference', 'visual'),
];

export const CHECKS = new Map(CATALOG.map(check => [check.id, check]));
export const checksFor = (kind: FileKind) => CATALOG.filter(check => check.kind === kind);
