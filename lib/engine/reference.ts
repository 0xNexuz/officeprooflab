// Comparison with an approved reference file. Structure checks are confirmed; the slide layout score is labelled visual.
import { cellRef, colName, compactRefs } from './a1.ts';
import { Grid, findTables, type Table } from './checks-xlsx.ts';
import { headingsOf } from './checks-docx.ts';
import { hasContent } from './checks-pptx.ts';
import { Collector, clip } from './collect.ts';
import type { Recalculation } from './recalc.ts';
import type { Deck, DocumentModel, SlideShape, Workbook } from './types.ts';

const lower = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();

/** True when the items both lists share appear in a different relative order. */
function reordered(reference: string[], generated: string[]) {
  const common = reference.filter(item => generated.includes(item));
  const order = generated.filter(item => common.includes(item));
  return common.some((item, index) => order[index] !== item);
}

export function compareWorkbooks(generated: Workbook, reference: Workbook, recalc: Recalculation | null, out: Collector) {
  const sheets = new Map(generated.sheets.map(sheet => [sheet.name.toLowerCase(), sheet]));
  for (const sheet of reference.sheets) {
    if (!sheets.has(sheet.name.toLowerCase()) && sheet.state === 'visible') {
      out.add('XL-REF-SHEETS', { kind: 'file' }, `The sheet "${sheet.name}" is missing`, `The reference has it. This file has: ${generated.sheets.map(item => `"${item.name}"`).join(', ')}.`, {}, lower(sheet.name));
    }
  }
  for (const refSheet of reference.sheets) {
    const genSheet = sheets.get(refSheet.name.toLowerCase());
    if (!genSheet) continue;
    const refGrid = new Grid(refSheet, null), genGrid = new Grid(genSheet, recalc);
    const refTables = findTables(refGrid), genTables = findTables(genGrid);
    refTables.forEach((refTable, index) => {
      const names = (table: Table) => [...table.headers.entries()].sort((a, b) => a[0] - b[0]).map(([, name]) => lower(name)).filter(Boolean);
      const refNames = names(refTable);
      // The same table is the one sharing the most headers, not necessarily the one in the same position.
      const genTable = [...genTables].sort((a, b) => names(b).filter(name => refNames.includes(name)).length - names(a).filter(name => refNames.includes(name)).length)[0];
      const where = { kind: 'cell' as const, sheet: genSheet.name, ref: genTable ? cellRef(genTable.headerRow, genTable.c1) : 'A1' };
      const genNames = genTable ? names(genTable) : [];
      if (!genTable || !genNames.some(name => refNames.includes(name))) {
        out.add('XL-REF-HEADERS', where, `"${genSheet.name}" has no table with the reference's columns`, `The reference has: ${[...refTable.headers.values()].join(', ')}.`, {}, `${lower(refSheet.name)}:t${index}`);
        return;
      }
      const original = new Map([...refTable.headers.values()].map(name => [lower(name), name]));
      const missing = refNames.filter(name => !genNames.includes(name));
      if (missing.length) {
        out.add('XL-REF-HEADERS', where, `${missing.length === 1 ? 'A column is' : `${missing.length} columns are`} missing from "${genSheet.name}": ${missing.map(name => `"${clip(original.get(name) ?? name, 30)}"`).join(', ')}`,
          `The reference has ${refNames.length} columns: ${[...refTable.headers.values()].join(', ')}.`, { expected: [...refTable.headers.values()].join(', '), actual: [...genTable.headers.values()].join(', '), count: missing.length }, `${lower(refSheet.name)}:t${index}:missing`);
      } else if (reordered(refNames, genNames)) {
        out.add('XL-REF-HEADERS', where, `The columns on "${genSheet.name}" are in a different order from the reference`, 'Every reference column is present, but not in the same order.', { expected: [...refTable.headers.values()].join(', '), actual: [...genTable.headers.values()].join(', ') }, `${lower(refSheet.name)}:t${index}:order`);
      }
      // Columns and total rows that are calculated in the reference but typed here.
      const genColumn = new Map([...genTable.headers.entries()].map(([c, name]) => [lower(name), c]));
      const bodyRows = (table: Table) => { const totals = new Set(table.totalRows); const rows: number[] = []; for (let r = table.firstRow; r <= table.lastRow; r++) if (!totals.has(r)) rows.push(r); return rows; };
      const typed: string[] = [];
      for (const [refC, name] of refTable.headers) {
        const genC = genColumn.get(lower(name));
        if (genC === undefined) continue;
        const refCells = bodyRows(refTable).map(r => refGrid.at(r, refC)).filter(cell => refGrid.filled(cell));
        if (refCells.length && refCells.filter(cell => cell!.f).length / refCells.length >= 0.8) {
          for (const r of bodyRows(genTable)) { const cell = genGrid.at(r, genC); if (cell && genGrid.filled(cell) && !cell.f) typed.push(cellRef(r, genC)); }
        }
        refTable.totalRows.forEach((refRow, k) => {
          const genRow = genTable.totalRows[k];
          if (genRow === undefined) return;
          const refCell = refGrid.at(refRow, refC), genCell = genGrid.at(genRow, genC);
          if (refCell?.f && genCell && genGrid.filled(genCell) && !genCell.f && typeof genCell.v === 'number') typed.push(cellRef(genRow, genC));
        });
      }
      if (typed.length) {
        const unique = [...new Set(typed)];
        out.add('XL-REF-FORMULAS', { kind: 'cell', sheet: genSheet.name, ref: unique[0], refs: unique.slice(0, 200) }, `${unique.length} cell${unique.length === 1 ? ' is' : 's are'} typed on "${genSheet.name}" where the reference has formulas`,
          `${compactRefs(unique)}. In the reference these cells are calculated, so they follow a change to the data. Here they will not.`, { expected: 'Formulas', actual: 'Typed values', count: unique.length }, `${lower(refSheet.name)}:t${index}`);
      }
    });
    if (!refTables.length && !genTables.length) continue;
    if (refTables.length && !genTables.length) out.note('XL-REF-HEADERS', `No table was found on "${genSheet.name}"`);
  }
  void colName;
}

export function compareDocuments(generated: DocumentModel, reference: DocumentModel, out: Collector) {
  const refHeads = headingsOf(reference).filter(block => block.level <= 3), genHeads = headingsOf(generated);
  const genNames = genHeads.map(block => lower(block.text));
  const missing = refHeads.filter(block => !genNames.includes(lower(block.text)));
  missing.slice(0, 12).forEach(block => out.add('DOC-REF-HEADINGS', { kind: 'file' }, `The heading "${clip(block.text, 60)}" is missing`, 'The reference has this section. It was not found in the generated document.', {}, lower(block.text)));
  const refNames = refHeads.map(block => lower(block.text));
  if (!missing.length && reordered([...new Set(refNames)], [...new Set(genNames)])) {
    out.add('DOC-REF-HEADINGS', { kind: 'file' }, 'The sections are in a different order from the reference', `Reference order: ${refHeads.slice(0, 10).map(block => clip(block.text, 30)).join(', ')}.`,
      { expected: refHeads.slice(0, 10).map(block => clip(block.text, 30)).join(', '), actual: genHeads.slice(0, 10).map(block => clip(block.text, 30)).join(', ') }, 'order');
  }

  const tables = (doc: DocumentModel) => doc.blocks.filter((block): block is Extract<DocumentModel['blocks'][number], { type: 'table' }> => block.type === 'table');
  const refTables = tables(reference), genTables = tables(generated);
  if (refTables.length !== genTables.length) {
    out.add('DOC-REF-TABLES', { kind: 'file' }, `The document has ${genTables.length} table${genTables.length === 1 ? '' : 's'}; the reference has ${refTables.length}`, 'The number of tables differs from the approved reference.', { expected: String(refTables.length), actual: String(genTables.length) }, 'count');
  }
  refTables.forEach((refTable, index) => {
    const genTable = genTables[index];
    if (!genTable) return;
    const refHeader = (refTable.rows[0] ?? []).map(lower), genHeader = (genTable.rows[0] ?? []).map(lower);
    if (refHeader.join('|') !== genHeader.join('|')) {
      out.add('DOC-REF-TABLES', { kind: 'table', index: genTable.tableIndex, row: 0 }, `Table ${index + 1} has different column headers from the reference`, 'The first row does not match the reference table.',
        { expected: (refTable.rows[0] ?? []).join(', '), actual: (genTable.rows[0] ?? []).join(', ') }, `headers${index}`);
    }
  });

  if (reference.page && generated.page) {
    const a = reference.page, b = generated.page, parts: string[] = [];
    const pt = (twips: number) => `${(twips / 1440).toFixed(2)} in`;
    if (a.orientation !== b.orientation) parts.push(`orientation is ${b.orientation}, not ${a.orientation}`);
    else if (Math.abs(a.width - b.width) > 30 || Math.abs(a.height - b.height) > 30) parts.push(`page is ${pt(b.width)} by ${pt(b.height)}, not ${pt(a.width)} by ${pt(a.height)}`);
    for (const side of ['top', 'right', 'bottom', 'left'] as const) if (Math.abs(a.margins[side] - b.margins[side]) > 30) parts.push(`${side} margin is ${pt(b.margins[side])}, not ${pt(a.margins[side])}`);
    if (parts.length) out.add('DOC-REF-PAGE', { kind: 'file' }, 'The page setup differs from the reference', `${parts.join('; ')}.`.replace(/^./, first => first.toUpperCase()), { count: parts.length });
  }

  const fontsOf = (doc: DocumentModel) => new Set([...doc.fonts, ...(doc.defaultFont ? [doc.defaultFont] : [])].map(font => font.toLowerCase()));
  const refFonts = fontsOf(reference);
  const extra = generated.fonts.filter(font => !refFonts.has(font.toLowerCase()));
  if (extra.length && refFonts.size) out.add('DOC-REF-FONTS', { kind: 'file' }, `The document uses ${extra.length === 1 ? 'a font' : 'fonts'} the reference does not: ${extra.slice(0, 5).join(', ')}`, `The reference uses ${[...new Set([...reference.fonts, ...(reference.defaultFont ? [reference.defaultFont] : [])])].join(', ')}.`, { count: extra.length });

  if (reference.words >= 50 && (generated.words < reference.words * 0.5 || generated.words > reference.words * 2)) {
    out.add('DOC-REF-LENGTH', { kind: 'file' }, `The document is much ${generated.words < reference.words ? 'shorter' : 'longer'} than the reference`, `It has ${generated.words.toLocaleString('en-US')} words; the reference has ${reference.words.toLocaleString('en-US')}.`,
      { expected: `about ${reference.words.toLocaleString('en-US')} words`, actual: `${generated.words.toLocaleString('en-US')} words` });
  }
}

type Box = NonNullable<SlideShape['box']>;
function iou(a: Box, b: Box) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  const inter = w > 0 && h > 0 ? w * h : 0;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/** How closely one slide's boxes line up with the reference slide's: 1 is identical positions, 0 is nothing in common. */
export function layoutScore(generated: SlideShape[], reference: SlideShape[], genSize: { w: number; h: number }, refSize: { w: number; h: number }): number | null {
  const norm = (shape: SlideShape, size: { w: number; h: number }) => ({ type: shape.type, box: { x: shape.box!.x / size.w, y: shape.box!.y / size.h, w: shape.box!.w / size.w, h: shape.box!.h / size.h } });
  const gen = generated.filter(shape => shape.box && hasContent(shape)).map(shape => norm(shape, genSize));
  const ref = reference.filter(shape => shape.box && hasContent(shape)).map(shape => norm(shape, refSize));
  if (!gen.length && !ref.length) return null;
  const used = new Set<number>();
  let total = 0;
  for (const item of ref) {
    let best = -1, bestScore = 0;
    gen.forEach((candidate, index) => { if (used.has(index) || candidate.type !== item.type) return; const score = iou(item.box, candidate.box); if (score > bestScore) { bestScore = score; best = index; } });
    if (best >= 0) { used.add(best); total += bestScore; }
  }
  return total / Math.max(gen.length, ref.length);
}

export function compareDecks(generated: Deck, reference: Deck, out: Collector) {
  if (generated.slides.length !== reference.slides.length) {
    out.add('PPT-REF-COUNT', { kind: 'file' }, `The deck has ${generated.slides.length} slide${generated.slides.length === 1 ? '' : 's'}; the reference has ${reference.slides.length}`, 'The number of slides differs from the approved reference.', { expected: String(reference.slides.length), actual: String(generated.slides.length) });
  }
  const inch = (emu: number) => (emu / 914400).toFixed(2);
  if (Math.abs(generated.size.w - reference.size.w) > 9144 || Math.abs(generated.size.h - reference.size.h) > 9144) {
    out.add('PPT-REF-SIZE', { kind: 'file' }, `The slides are ${inch(generated.size.w)} by ${inch(generated.size.h)} in; the reference is ${inch(reference.size.w)} by ${inch(reference.size.h)} in`, 'A different slide size changes how every slide is laid out and projected.',
      { expected: `${inch(reference.size.w)} × ${inch(reference.size.h)} in`, actual: `${inch(generated.size.w)} × ${inch(generated.size.h)} in` });
  }
  const genTitles = new Set(generated.slides.map(slide => lower(slide.title ?? '')).filter(Boolean));
  reference.slides.forEach(slide => {
    if (slide.title && !genTitles.has(lower(slide.title))) {
      const same = generated.slides[slide.index];
      out.add('PPT-REF-TITLES', same ? { kind: 'slide', index: same.index } : { kind: 'file' }, `No slide is titled "${clip(slide.title, 60)}"`, `It is slide ${slide.index + 1} in the reference.${same ? ` Slide ${same.index + 1} here ${same.title ? `is titled "${clip(same.title, 60)}"` : 'has no title'}.` : ''}`,
        { expected: slide.title, actual: same?.title ?? 'No title' }, lower(slide.title));
    }
  });
  const fonts = (deck: Deck) => new Set([...deck.fonts, deck.themeFonts.major ?? '', deck.themeFonts.minor ?? ''].filter(Boolean).map(font => font.toLowerCase()));
  const refFonts = fonts(reference);
  const extra = generated.fonts.filter(font => !refFonts.has(font.toLowerCase()));
  if (extra.length && refFonts.size) out.add('PPT-REF-FONTS', { kind: 'file' }, `The deck uses ${extra.length === 1 ? 'a font' : 'fonts'} the reference does not: ${extra.slice(0, 5).join(', ')}`, `The reference uses ${[...new Set([...reference.fonts, reference.themeFonts.major ?? '', reference.themeFonts.minor ?? ''].filter(Boolean))].join(', ')}.`, { count: extra.length });

  generated.slides.forEach(slide => {
    const ref = reference.slides[slide.index];
    if (!ref) return;
    const score = layoutScore(slide.shapes, ref.shapes, generated.size, reference.size);
    if (score !== null && score < 0.75) {
      const percent = Math.round(score * 100);
      out.add('PPT-VIS-LAYOUT', { kind: 'slide', index: slide.index }, `Slide ${slide.index + 1} lines up with the reference at ${percent}%`,
        `${slide.shapes.filter(hasContent).length} box${slide.shapes.filter(hasContent).length === 1 ? '' : 'es'} here, ${ref.shapes.filter(hasContent).length} in the reference. The score compares where the boxes sit, not how the slide looks once rendered.`,
        { expected: '75% or more', actual: `${percent}%` });
    }
  });
}
