// Runs the engine for the server, and rebuilds a report that a pipeline sent in.
import { CHECKS, checksFor } from '../engine/catalog.ts';
import { runChecks, summarise, verdictOf } from '../engine/run.ts';
import { ENGINE_VERSION, type CheckResult, type FileKind, type Finding, type Rule, type RunResult, type Severity, type Where } from '../engine/types.ts';
import { StoreError } from './errors.ts';
import { safeFileName } from './files.ts';

/** At most two files are checked at once per server instance, so memory stays bounded. */
let active = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 2) {
    if (waiting.length >= 12) throw new StoreError('rate_limited', 'The server is busy checking other files. Try again in a moment.');
    await new Promise<void>(resolve => waiting.push(resolve));
  }
  active++;
  try { return await fn(); } finally { active--; waiting.shift()?.(); }
}

export type RunSettings = { rules: Rule[]; disable: string[]; phrases: string[]; reference: { name: string; bytes: Buffer } | null };

export function executeRun(fileName: string, bytes: Buffer, settings: RunSettings): Promise<RunResult> {
  return slot(async () => (await runChecks({
    name: fileName, bytes: new Uint8Array(bytes),
    reference: settings.reference ? { name: settings.reference.name, bytes: new Uint8Array(settings.reference.bytes) } : null,
    options: { rules: settings.rules, disable: settings.disable, placeholders: settings.phrases },
    recalcTimeoutMs: 15_000,
  })).result);
}

const str = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ').slice(0, max) : '';
const int = (value: unknown, max = 1e7) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max ? value : null;

function cleanWhere(value: unknown): Where | null {
  if (!value || typeof value !== 'object') return null;
  const w = value as Record<string, unknown>;
  switch (w.kind) {
    case 'file': return { kind: 'file' };
    case 'sheet': return str(w.sheet, 80) ? { kind: 'sheet', sheet: str(w.sheet, 80) } : null;
    case 'cell': {
      const ref = str(w.ref, 12);
      if (!str(w.sheet, 80) || !/^[A-Z]{1,3}\d{1,7}$/.test(ref)) return null;
      const refs = Array.isArray(w.refs) ? w.refs.filter((item): item is string => typeof item === 'string' && /^[A-Z]{1,3}\d{1,7}$/.test(item)).slice(0, 200) : [];
      return { kind: 'cell', sheet: str(w.sheet, 80), ref, ...(refs.length ? { refs } : {}) };
    }
    case 'paragraph': { const index = int(w.index); return index === null ? null : { kind: 'paragraph', index, ...(str(w.heading, 80) ? { heading: str(w.heading, 80) } : {}) }; }
    case 'table': { const index = int(w.index); if (index === null) return null; const row = int(w.row), col = int(w.col); return { kind: 'table', index, ...(row !== null ? { row } : {}), ...(col !== null ? { col } : {}) }; }
    case 'slide': { const index = int(w.index); return index === null ? null : { kind: 'slide', index, ...(str(w.shape, 80) ? { shape: str(w.shape, 80) } : {}) }; }
    default: return null;
  }
}

/**
 * A report computed in CI is data from outside. Every field is checked and trimmed, each finding takes its label from
 * the catalog, and the verdict and counts are worked out again here, so a report cannot claim a verdict its findings
 * do not support.
 */
export function rebuildCiResult(input: unknown, fileName: string): RunResult {
  const bad = (why: string): never => { throw new StoreError('invalid', `The report is not valid: ${why}`); };
  if (!input || typeof input !== 'object') bad('it is not an object');
  const raw = input as Record<string, unknown>;
  const file = (raw.file ?? {}) as Record<string, unknown>;
  const kind = file.kind as FileKind;
  if (!['xlsx', 'docx', 'pptx'].includes(kind)) bad('unknown file kind');
  const sha = str(file.sha256, 64);
  if (!/^[0-9a-f]{64}$/.test(sha)) bad('the file hash is missing');
  if (!Array.isArray(raw.findings) || raw.findings.length > 2000) bad('findings must be a list of up to 2,000');
  const seen = new Set<string>();
  const findings: Finding[] = [];
  for (const item of raw.findings as unknown[]) {
    const f = (item ?? {}) as Record<string, unknown>;
    const info = CHECKS.get(str(f.check, 40));
    const where = cleanWhere(f.where);
    const id = str(f.id, 200), title = str(f.title, 300);
    if (!info || info.kind !== kind || !where || !id || !title || seen.has(id)) bad('a finding is malformed or names an unknown check');
    seen.add(id);
    const severity: Severity = f.severity === 'fail' || f.severity === 'warn' || f.severity === 'info' ? f.severity : info!.severity;
    const count = int(f.count);
    findings.push({ id, check: info!.id, label: info!.label, severity, title, detail: str(f.detail, 1500), where: where!,
      ...(typeof f.expected === 'string' ? { expected: str(f.expected, 300) } : {}), ...(typeof f.actual === 'string' ? { actual: str(f.actual, 300) } : {}), ...(count !== null ? { count } : {}) });
  }
  const supplied = new Map((Array.isArray(raw.checks) ? raw.checks as unknown[] : []).map(item => { const c = (item ?? {}) as Record<string, unknown>; return [str(c.id, 40), c] as const; }));
  const rank: Record<Severity, number> = { fail: 3, warn: 2, info: 1 };
  const checks: CheckResult[] = checksFor(kind).map(info => {
    const mine = findings.filter(finding => finding.check === info.id);
    const given = supplied.get(info.id);
    const base = { id: info.id, title: info.title, label: info.label, findings: mine.length };
    if (!mine.length && (!given || given.status === 'skipped')) return { ...base, status: 'skipped' as const, note: str(given?.note, 120) || 'Not reported by the pipeline' };
    if (!mine.length) return { ...base, status: 'pass' as const };
    return { ...base, status: mine.reduce<Severity>((top, finding) => rank[finding.severity] > rank[top] ? finding.severity : top, 'info') };
  });
  const stats: RunResult['stats'] = {};
  if (raw.stats && typeof raw.stats === 'object') for (const [key, value] of Object.entries(raw.stats as Record<string, unknown>).slice(0, 20)) {
    if (/^[a-zA-Z]{1,30}$/.test(key) && (typeof value === 'number' ? Number.isFinite(value) : typeof value === 'boolean')) stats[key] = value as number | boolean;
  }
  const reference = raw.reference && typeof raw.reference === 'object' && /^[0-9a-f]{64}$/.test(str((raw.reference as Record<string, unknown>).sha256, 64))
    ? { name: safeFileName((raw.reference as Record<string, unknown>).name, 'reference'), sha256: str((raw.reference as Record<string, unknown>).sha256, 64) } : null;
  return { engine: str(raw.engine, 20) || ENGINE_VERSION, file: { name: fileName, kind, size: int(file.size, 1e9) ?? 0, sha256: sha }, reference,
    verdict: verdictOf(findings), summary: summarise(findings, checks), checks, findings, stats, durationMs: int(raw.durationMs, 1e8) ?? 0 };
}
