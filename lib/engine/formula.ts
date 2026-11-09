// Formula inspection built on Univer's formula lexer: which cells a formula reads, which functions it calls, and its shape relative to its own cell.
import { LexerTreeBuilder, sequenceNodeType } from '@univerjs/engine-formula';
import { colIndex, parseArea, splitSheet, type Area } from './a1.ts';

const lexer = new LexerTreeBuilder();
export const VOLATILE = new Set(['TODAY', 'NOW', 'RAND', 'RANDBETWEEN', 'RANDARRAY', 'OFFSET', 'INDIRECT', 'INFO', 'CELL']);

export type FormulaRef = { raw: string; sheet: string | null; area: Area | null; external: boolean };
export type FormulaInfo = { functions: string[]; refs: FormulaRef[]; names: string[]; refError: boolean; volatile: boolean; signature: string };

function relativePart(part: string, r: number, c: number): string {
  const match = /^(\$?)([A-Za-z]{1,3})?(\$?)(\d+)?$/.exec(part);
  if (!match) return part;
  const [, colAbs, col, rowAbs, row] = match;
  const colText = col === undefined ? '' : colAbs ? `$${col.toUpperCase()}` : `C[${colIndex(col) - c}]`;
  const rowText = row === undefined ? '' : rowAbs ? `$${row}` : `R[${Number(row) - 1 - r}]`;
  return `${rowText}${colText}`;
}

/** Analyses a formula sitting at (r, c). The signature is the same for formulas that were filled down or across. */
export function analyze(formula: string, r = 0, c = 0): FormulaInfo {
  const info: FormulaInfo = { functions: [], refs: [], names: [], refError: false, volatile: false, signature: '' };
  let nodes: ReturnType<LexerTreeBuilder['sequenceNodesBuilder']>;
  try { nodes = lexer.sequenceNodesBuilder(formula); } catch { nodes = undefined; }
  if (!nodes) { info.signature = formula; return info; }
  const parts: string[] = [];
  nodes.forEach((node, index) => {
    if (typeof node === 'string') { parts.push(node); return; }
    const token = node.token;
    if (node.nodeType === sequenceNodeType.REFERENCE) {
      const external = /^'?\[/.test(token);
      const { sheet, a1 } = splitSheet(token);
      const area = external ? null : parseArea(token);
      info.refs.push({ raw: token, sheet: external ? null : sheet, area, external });
      const [left, right] = a1.split(':');
      const shape = right === undefined ? relativePart(left, r, c) : `${relativePart(left, r, c)}:${relativePart(right, r, c)}`;
      parts.push(`${sheet === null ? '' : `${sheet}!`}${shape}`);
      return;
    }
    if (node.nodeType === sequenceNodeType.FUNCTION) {
      const upper = token.toUpperCase();
      if (nodes![index + 1] === '(') { info.functions.push(upper); if (VOLATILE.has(upper)) info.volatile = true; }
      else if (upper.startsWith('#')) { if (upper === '#REF!') info.refError = true; }
      else if (upper !== 'TRUE' && upper !== 'FALSE') info.names.push(token);
      parts.push(upper);
      return;
    }
    if (node.nodeType === sequenceNodeType.DEFINED_NAME) info.names.push(token);
    parts.push(token);
  });
  info.signature = parts.join('');
  return info;
}

/** The formula as it would read after being filled `dr` rows down and `dc` columns across. */
export function shift(formula: string, dc: number, dr: number): string {
  try { return lexer.moveFormulaRefOffset(formula, dc, dr); } catch { return formula; }
}
