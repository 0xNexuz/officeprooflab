// Deterministic document checks.
import { Collector, clip, textKey } from './collect.ts';
import { MERGED } from './docx.ts';
import { scanText } from './text.ts';
import type { DocBlock, DocumentModel, Where } from './types.ts';

const TOTAL_LABEL = /^\s*(grand\s+|sub\s*-?\s*|net\s+|overall\s+)?totals?\b/i;
const NOT_SUMMED = /%|\b(rate|percent|avg|average|price|unit|ratio|margin %)\b/i;
const NUMBER = /^\s*[-+(]?\s*(?:[A-Z]{3}\s*)?[$€£₦¥]?\s*\d[\d,]*(\.\d+)?\s*\)?\s*$/;

export function cellNumber(text: string): { value: number; decimals: number } | null {
  if (!NUMBER.test(text) || text.includes('%')) return null;
  const negative = /^\s*[-(]/.test(text);
  const digits = text.replace(/[^\d.]/g, '');
  if (!digits) return null;
  const value = Number(digits);
  if (!Number.isFinite(value)) return null;
  return { value: negative ? -value : value, decimals: digits.includes('.') ? digits.length - digits.indexOf('.') - 1 : 0 };
}

const KIND_CHECK = { placeholder: 'DOC-PLACEHOLDER', ai: 'DOC-AI-ARTIFACT', markdown: 'DOC-MARKDOWN' } as const;
const KIND_TITLE = { placeholder: 'A placeholder was left in', ai: 'Assistant text was left in', markdown: 'Markdown was not converted in' } as const;

export function headingsOf(doc: DocumentModel) {
  return doc.blocks.filter((block): block is Extract<DocBlock, { type: 'p' }> => block.type === 'p' && block.level >= 1 && !block.empty);
}

export function checkDocument(doc: DocumentModel, out: Collector, extraPatterns: RegExp[] = []) {
  const paragraphs = doc.blocks.filter((block): block is Extract<DocBlock, { type: 'p' }> => block.type === 'p');
  const tables = doc.blocks.filter((block): block is Extract<DocBlock, { type: 'table' }> => block.type === 'table');

  if (doc.words === 0 && !doc.images.length) {
    out.add('DOC-EMPTY', { kind: 'file' }, 'The document is empty', 'It has no text and no images.');
  }

  // Text left over from a template, a model reply or Markdown.
  let heading: string | undefined;
  const report = (text: string, where: Where, place: string) => {
    for (const hit of scanText(text, extraPatterns)) {
      out.add(KIND_CHECK[hit.kind], where, `${KIND_TITLE[hit.kind]} ${place}`, `Found ${hit.what}: ${clip(hit.context, 140)}`, { actual: clip(hit.match, 80) }, `${textKey(text)}`);
    }
  };
  for (const block of doc.blocks) {
    if (block.type === 'p') {
      if (block.level >= 0 && !block.empty) heading = clip(block.text, 60);
      if (!block.empty) report(block.text, { kind: 'paragraph', index: block.index, ...(heading && block.level < 0 ? { heading } : {}) }, `paragraph ${block.index + 1}`);
    } else {
      block.rows.forEach((row, r) => row.forEach((cell, c) => { if (cell !== MERGED && cell) report(cell, { kind: 'table', index: block.tableIndex, row: r, col: c }, `table ${block.tableIndex + 1}, row ${r + 1}`); }));
    }
  }
  doc.headers.forEach(text => report(text, { kind: 'file' }, 'the page header'));
  doc.footers.forEach(text => report(text, { kind: 'file' }, 'the page footer'));

  // Headings: empty sections and skipped levels.
  const heads = doc.blocks.map((block, position) => ({ block, position })).filter((item): item is { block: Extract<DocBlock, { type: 'p' }>; position: number } => item.block.type === 'p' && item.block.level >= 1 && !item.block.empty);
  heads.forEach(({ block, position }, index) => {
    const next = heads[index + 1];
    const end = next ? next.position : doc.blocks.length;
    const between = doc.blocks.slice(position + 1, end);
    const hasContent = between.some(item => item.type === 'table' || !item.empty);
    const nextIsDeeper = Boolean(next && next.block.level > block.level);
    if (!hasContent && !nextIsDeeper) {
      out.add('DOC-EMPTY-SECTION', { kind: 'paragraph', index: block.index }, `Nothing follows the heading "${clip(block.text, 60)}"`,
        next ? `The next thing in the document is the heading "${clip(next.block.text, 60)}".` : 'It is the last thing in the document.', {}, textKey(block.text));
    }
    if (next && next.block.level > block.level + 1) {
      out.add('DOC-HEADING-ORDER', { kind: 'paragraph', index: next.block.index }, `"${clip(next.block.text, 50)}" jumps from heading level ${block.level} to ${next.block.level}`,
        `It follows "${clip(block.text, 50)}" (level ${block.level}). A level ${block.level + 1} heading is missing in between.`, { expected: `Heading ${block.level + 1}`, actual: `Heading ${next.block.level}` }, textKey(next.block.text));
    }
  });

  // Tables.
  for (const table of tables) {
    const rows = table.rows;
    if (!rows.length) continue;
    const width = Math.max(...rows.map(row => row.length));
    const ragged = rows.filter(row => row.length !== width).length;
    const body = rows.slice(1);
    const cells = body.flatMap((row, r) => row.map((cell, c) => ({ cell, r: r + 1, c }))).filter(item => item.cell !== MERGED);
    const isTotalRow = (row: string[]) => TOTAL_LABEL.test(row.find(cell => cell !== MERGED && cell.trim()) ?? '');
    const empty = cells.filter(item => !item.cell.trim() && !isTotalRow(rows[item.r]));
    if (ragged) {
      out.add('DOC-TABLE-CELLS', { kind: 'table', index: table.tableIndex }, `Table ${table.tableIndex + 1} has rows of different lengths`,
        `${ragged} of ${rows.length} rows do not have ${width} cells.`, { count: ragged }, 'ragged');
    }
    if (empty.length && cells.length >= 4 && empty.length / cells.length <= 0.2) {
      const first = empty[0];
      out.add('DOC-TABLE-CELLS', { kind: 'table', index: table.tableIndex, row: first.r, col: first.c }, `Table ${table.tableIndex + 1} has ${empty.length} empty cell${empty.length === 1 ? '' : 's'}`,
        `${empty.slice(0, 6).map(item => `row ${item.r + 1}, column ${item.c + 1}`).join('; ')}${empty.length > 6 ? `; and ${empty.length - 6} more` : ''}. The rest of the table is filled.`, { count: empty.length }, 'empty');
    }
    // Totals.
    rows.forEach((row, r) => {
      if (r < 2) return;
      const labelCol = row.findIndex(cell => cell !== MERGED && cell.trim());
      if (labelCol < 0 || !TOTAL_LABEL.test(row[labelCol])) return;
      let from = 1;
      for (let k = r - 1; k >= 1; k--) { const firstCell = rows[k].find(cell => cell !== MERGED && cell.trim()); if (firstCell && TOTAL_LABEL.test(firstCell)) { from = /sub/i.test(row[labelCol]) ? k + 1 : 1; break; } }
      for (let c = 0; c < row.length; c++) {
        if (c === labelCol) continue;
        const total = cellNumber(row[c]);
        if (!total || NOT_SUMMED.test(rows[0][c] ?? '')) continue;
        let sum = 0, count = 0, decimals = total.decimals;
        for (let k = from; k < r; k++) {
          const firstCell = rows[k].find(cell => cell !== MERGED && cell.trim());
          if (firstCell && TOTAL_LABEL.test(firstCell)) continue;
          const value = cellNumber(rows[k][c] ?? '');
          if (value) { sum += value.value; count++; decimals = Math.max(decimals, value.decimals); }
        }
        if (count < 2) continue;
        const diff = Math.abs(sum - total.value);
        if (diff <= 1e-9 * Math.max(1, Math.abs(sum))) continue;
        // Whole numbers shown in a document may have been rounded for display; a difference inside that margin is a warning.
        const rounding = total.decimals === 0 && decimals === 0 ? 0.5 * (count + 1) : 0;
        const places = Math.min(decimals, 6);
        const shown = (value: number) => value.toLocaleString('en-US', { minimumFractionDigits: places, maximumFractionDigits: places });
        out.add('DOC-TABLE-TOTAL', { kind: 'table', index: table.tableIndex, row: r, col: c }, `Table ${table.tableIndex + 1}: "${clip(row[labelCol], 30)}" says ${clip(row[c].trim(), 30)}, but the rows add up to ${shown(sum)}`,
          `Column "${clip(rows[0][c] ?? `Column ${c + 1}`, 40)}": the ${count} rows above sum to ${shown(sum)}.${diff <= rounding ? ' The difference is small enough to be rounding, so this is a warning.' : ''}`,
          { expected: shown(sum), actual: row[c].trim(), ...(diff <= rounding ? { severity: 'warn' as const } : {}) }, `c${c}`);
      }
    });
  }

  // Images.
  doc.images.filter(image => image.missing).forEach((image, index) => {
    out.add('DOC-IMAGE', { kind: 'file' }, 'An image is missing from the file', `The document refers to "${clip(image.target, 80)}", which is not in the file.`, {}, `image${index}:${image.target}`);
  });

  // Repeated paragraphs.
  for (let i = 1; i < paragraphs.length; i++) {
    const a = paragraphs[i - 1], b = paragraphs[i];
    if (b.index !== a.index + 1 || b.empty || b.text.trim().length < 24) continue;
    if (a.text.trim() === b.text.trim() && !(i >= 2 && paragraphs[i - 2].text.trim() === b.text.trim())) {
      out.add('DOC-REPEAT', { kind: 'paragraph', index: b.index }, `Paragraph ${b.index + 1} repeats the one before it`, `"${clip(b.text, 120)}"`, {}, textKey(b.text));
    }
  }

  if (doc.comments || doc.trackedChanges) {
    const parts = [doc.comments ? `${doc.comments} comment${doc.comments === 1 ? '' : 's'}` : '', doc.trackedChanges ? `${doc.trackedChanges} tracked change${doc.trackedChanges === 1 ? '' : 's'}` : ''].filter(Boolean);
    out.add('DOC-REVIEW-MARKS', { kind: 'file' }, `The file still carries ${parts.join(' and ')}`, 'Readers who open the file can see them. Accept or reject the changes and delete the comments before sending.', { count: doc.comments + doc.trackedChanges });
  }
}
