// Collects findings for one run and turns them into per-check results.
import { CHECKS, checksFor } from './catalog.ts';
import type { CellValue, CheckResult, FileKind, Finding, Severity, Where } from './types.ts';

export function whereKey(where: Where): string {
  switch (where.kind) {
    case 'file': return 'file';
    case 'cell': return `${where.sheet}!${where.ref}`;
    case 'sheet': return `sheet:${where.sheet}`;
    case 'paragraph': return `p${where.index}`;
    case 'table': return `t${where.index}${where.row === undefined ? '' : `r${where.row}`}${where.col === undefined ? '' : `c${where.col}`}`;
    case 'slide': return `s${where.index}${where.shape ? `:${where.shape}` : ''}`;
  }
}

export function whereText(where: Where): string {
  switch (where.kind) {
    case 'file': return 'Whole file';
    case 'cell': return `${where.sheet}!${where.ref}`;
    case 'sheet': return `Sheet "${where.sheet}"`;
    case 'paragraph': return where.heading ? `Paragraph ${where.index + 1}, under "${where.heading}"` : `Paragraph ${where.index + 1}`;
    case 'table': return `Table ${where.index + 1}${where.row === undefined ? '' : `, row ${where.row + 1}`}${where.col === undefined ? '' : `, column ${where.col + 1}`}`;
    case 'slide': return `Slide ${where.index + 1}${where.shape ? `, ${where.shape}` : ''}`;
  }
}

/** A short, stable fingerprint of text, so a finding about a paragraph keeps its id when paragraphs above it change. */
export function textKey(text: string): string {
  let hash = 2166136261;
  const clean = text.replace(/\s+/g, ' ').trim().toLowerCase();
  for (let i = 0; i < clean.length; i++) { hash ^= clean.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
}

export function show(value: CellValue | undefined): string {
  if (value === null || value === undefined || value === '') return 'empty';
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return value.toLocaleString('en-US');
    return Number(value.toPrecision(12)).toLocaleString('en-US', { maximumFractionDigits: 6 });
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return value.startsWith('#') ? value : `"${value.length > 60 ? `${value.slice(0, 57)}…` : value}"`;
}

export const clip = (text: string, max = 90) => { const flat = text.replace(/\s+/g, ' ').trim(); return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat; };

type Extra = { expected?: string; actual?: string; count?: number; severity?: Severity };

export class Collector {
  kind: FileKind;
  findings: Finding[] = [];
  disabled: Set<string>;
  notes = new Map<string, string>();
  skipped = new Map<string, string>();
  private seen = new Set<string>();

  constructor(kind: FileKind, disabled: string[] = []) {
    this.kind = kind;
    this.disabled = new Set(disabled.map(id => id.toUpperCase()));
  }

  on(check: string) { return !this.disabled.has(check); }

  /** `key` separates findings of one check in one place; leave it out when the place is enough. */
  add(check: string, where: Where, title: string, detail: string, extra: Extra = {}, key = '') {
    const info = CHECKS.get(check);
    if (!info) throw new Error(`Unknown check ${check}`);
    if (!this.on(check)) return;
    let id = `${check}:${key || whereKey(where)}`;
    for (let n = 2; this.seen.has(id); n++) id = `${check}:${key || whereKey(where)}#${n}`;
    this.seen.add(id);
    this.findings.push({ id, check, label: info.label, severity: extra.severity ?? info.severity, title, detail, where,
      ...(extra.expected !== undefined ? { expected: extra.expected } : {}), ...(extra.actual !== undefined ? { actual: extra.actual } : {}),
      ...(extra.count !== undefined ? { count: extra.count } : {}) });
  }

  skip(check: string, reason: string) { this.skipped.set(check, reason); }
  note(check: string, text: string) { this.notes.set(check, text); }

  results(context: { reference: boolean; rules: boolean; formulas: boolean }): CheckResult[] {
    const rank: Record<Severity, number> = { fail: 3, warn: 2, info: 1 };
    return checksFor(this.kind).map(info => {
      const mine = this.findings.filter(finding => finding.check === info.id);
      const base = { id: info.id, title: info.title, label: info.label, findings: mine.length };
      if (this.disabled.has(info.id)) return { ...base, status: 'skipped' as const, note: 'Turned off for this test case' };
      if (info.needs === 'reference' && !context.reference) return { ...base, status: 'skipped' as const, note: 'No reference file' };
      if (info.needs === 'rules' && !context.rules) return { ...base, status: 'skipped' as const, note: 'No rules written' };
      if (info.needs === 'formulas' && !context.formulas) return { ...base, status: 'skipped' as const, note: 'The workbook has no formulas' };
      if (this.skipped.has(info.id)) return { ...base, status: 'skipped' as const, note: this.skipped.get(info.id) };
      const note = this.notes.get(info.id);
      if (!mine.length) return { ...base, status: 'pass' as const, ...(note ? { note } : {}) };
      const worst = mine.reduce<Severity>((top, finding) => rank[finding.severity] > rank[top] ? finding.severity : top, 'info');
      return { ...base, status: worst, ...(note ? { note } : {}) };
    });
  }
}
