// A1 reference helpers. Rows and columns are zero-based inside the engine.

export function colName(index: number): string {
  let n = index + 1, out = '';
  while (n > 0) { const rem = (n - 1) % 26; out = String.fromCharCode(65 + rem) + out; n = Math.floor((n - 1) / 26); }
  return out;
}
export function colIndex(name: string): number {
  let n = 0;
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
export const cellRef = (r: number, c: number) => `${colName(c)}${r + 1}`;
export function parseCell(ref: string): { r: number; c: number } | null {
  const match = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(ref.trim());
  return match ? { r: Number(match[2]) - 1, c: colIndex(match[1]) } : null;
}
export type Area = { sheet: string | null; r1: number; c1: number; r2: number; c2: number };

/** Splits "Sheet!A1:B2" or "'My Sheet'!A1" into a sheet name and the A1 part. */
export function splitSheet(ref: string): { sheet: string | null; a1: string } {
  const bang = ref.lastIndexOf('!');
  if (bang < 0) return { sheet: null, a1: ref };
  let sheet = ref.slice(0, bang);
  if (sheet.startsWith("'") && sheet.endsWith("'")) sheet = sheet.slice(1, -1).replace(/''/g, "'");
  return { sheet, a1: ref.slice(bang + 1) };
}

/** Parses a cell or rectangular range (whole columns and rows are clamped to the given size). */
export function parseArea(ref: string, maxRows = 1_048_576, maxCols = 16_384): Area | null {
  const { sheet, a1 } = splitSheet(ref.trim());
  const clean = a1.replace(/\$/g, '');
  const [left, right = left] = clean.split(':');
  const single = (part: string) => parseCell(part);
  const a = single(left), b = single(right);
  if (a && b) return { sheet, r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
  if (/^[A-Za-z]{1,3}$/.test(left) && /^[A-Za-z]{1,3}$/.test(right)) {
    const c1 = colIndex(left), c2 = colIndex(right);
    return { sheet, r1: 0, c1: Math.min(c1, c2), r2: maxRows - 1, c2: Math.max(c1, c2) };
  }
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    const r1 = Number(left) - 1, r2 = Number(right) - 1;
    return { sheet, r1: Math.min(r1, r2), c1: 0, r2: Math.max(r1, r2), c2: maxCols - 1 };
  }
  return null;
}
export const areaRef = (area: Area) => area.r1 === area.r2 && area.c1 === area.c2 ? cellRef(area.r1, area.c1) : `${cellRef(area.r1, area.c1)}:${cellRef(area.r2, area.c2)}`;

/** Collapses cell refs in one column or row into ranges for display: A2, A3, A4, C1 → "A2:A4, C1". */
export function compactRefs(refs: string[], limit = 8): string {
  const cells = refs.map(parseCell).filter((cell): cell is { r: number; c: number } => Boolean(cell)).sort((a, b) => a.c - b.c || a.r - b.r);
  const parts: string[] = [];
  let start = 0;
  for (let i = 1; i <= cells.length; i++) {
    const prev = cells[i - 1], next = cells[i];
    if (next && next.c === prev.c && next.r === prev.r + 1) continue;
    const first = cells[start];
    parts.push(first === prev ? cellRef(first.r, first.c) : `${cellRef(first.r, first.c)}:${cellRef(prev.r, prev.c)}`);
    start = i;
  }
  return parts.length > limit ? `${parts.slice(0, limit).join(', ')} and ${parts.length - limit} more` : parts.join(', ');
}
