// Runs every check on one file: bytes in, a RunResult out. Used by the server, the command-line tool and CI.
import { checkDeck } from './checks-pptx.ts';
import { checkDocument } from './checks-docx.ts';
import { checkWorkbook } from './checks-xlsx.ts';
import { Collector } from './collect.ts';
import { readDocument } from './docx.ts';
import { readDeck } from './pptx.ts';
import { recalculate, type Recalculation } from './recalc.ts';
import { compareDecks, compareDocuments, compareWorkbooks } from './reference.ts';
import { applyDeckRules, applyDocumentRules, applyWorkbookRules, validateRules } from './rules.ts';
import { compilePatterns } from './text.ts';
import { readWorkbook } from './xlsx.ts';
import { detectKind, openPackage } from './zip.ts';
import { ENGINE_VERSION, EngineError, type CheckOptions, type CheckResult, type FileKind, type Finding, type Model, type RunResult, type Verdict } from './types.ts';

export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const KIND_NAME: Record<FileKind, string> = { xlsx: 'spreadsheet', docx: 'document', pptx: 'presentation' };

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Opens an Office file and reads it into the engine's model. The kind comes from the file's content, never its name. */
export function readModel(bytes: Uint8Array): Model {
  const pkg = openPackage(bytes);
  const kind = detectKind(pkg);
  return kind === 'xlsx' ? readWorkbook(pkg) : kind === 'docx' ? readDocument(pkg) : readDeck(pkg);
}

const LABEL_RANK = { confirmed: 0, visual: 1, ai: 2 } as const;
const SEVERITY_RANK = { fail: 0, warn: 1, info: 2 } as const;

export function verdictOf(findings: Finding[]): Verdict {
  const confirmed = findings.filter(finding => finding.label === 'confirmed');
  return confirmed.some(finding => finding.severity === 'fail') ? 'fail' : confirmed.some(finding => finding.severity === 'warn') ? 'warn' : 'pass';
}

export function summarise(findings: Finding[], checks: CheckResult[]): RunResult['summary'] {
  const confirmed = findings.filter(finding => finding.label === 'confirmed');
  return {
    fail: confirmed.filter(finding => finding.severity === 'fail').length,
    warn: confirmed.filter(finding => finding.severity === 'warn').length,
    info: confirmed.filter(finding => finding.severity === 'info').length,
    visual: findings.filter(finding => finding.label === 'visual').length,
    ai: findings.filter(finding => finding.label === 'ai').length,
    checksRun: checks.filter(check => check.status !== 'skipped').length,
    checksPassed: checks.filter(check => check.status === 'pass').length,
    checksSkipped: checks.filter(check => check.status === 'skipped').length,
  };
}

/**
 * Checks a model that is already in memory. `recalc` carries Univer's recalculated values for a workbook; pass null to
 * check against the stored values only. The same inputs always give the same findings.
 */
export function evaluate(model: Model, recalc: Recalculation | null, reference: Model | null, options: CheckOptions = {}): { checks: CheckResult[]; findings: Finding[]; stats: RunResult['stats'] } {
  const rules = validateRules(model.kind, options.rules);
  const patterns = compilePatterns(options.placeholders);
  if (reference && reference.kind !== model.kind) throw new EngineError('unsupported', `The reference is a ${KIND_NAME[reference.kind]}, but the file is a ${KIND_NAME[model.kind]}`);
  const out = new Collector(model.kind, options.disable ?? []);
  let stats: RunResult['stats'];
  let formulas = false;
  if (model.kind === 'xlsx') {
    const cells = model.sheets.reduce((sum, sheet) => sum + sheet.cells.length, 0);
    const formulaCount = model.sheets.reduce((sum, sheet) => sum + sheet.cells.filter(cell => cell.f).length, 0);
    formulas = formulaCount > 0;
    checkWorkbook(model, recalc, out);
    if (rules.length) applyWorkbookRules(model, recalc, rules, out);
    if (reference?.kind === 'xlsx') compareWorkbooks(model, reference, recalc, out);
    stats = { sheets: model.sheets.length, cells, formulas: formulaCount, recalculated: recalc ? recalc.formulas - recalc.unfinished : 0, recalcMs: recalc?.ms ?? 0,
      ...(model.truncated ? { truncated: true } : {}), ...(model.hasMacros ? { macros: true } : {}), ...(model.externalLinks ? { externalLinks: model.externalLinks } : {}) };
    if (model.truncated) out.add('XL-PARTIAL', { kind: 'file' }, 'Only part of the workbook was checked', 'The workbook has more than 400,000 filled cells. The first 400,000 were read and checked; the rest were not looked at.');
  } else if (model.kind === 'docx') {
    checkDocument(model, out, patterns);
    if (rules.length) applyDocumentRules(model, rules, out);
    if (reference?.kind === 'docx') compareDocuments(model, reference, out);
    stats = { paragraphs: model.blocks.filter(block => block.type === 'p' && !block.empty).length, words: model.words, tables: model.blocks.filter(block => block.type === 'table').length, images: model.images.length };
  } else {
    checkDeck(model, out, patterns);
    if (rules.length) applyDeckRules(model, rules, out);
    if (reference?.kind === 'pptx') compareDecks(model, reference, out);
    stats = { slides: model.slides.length, shapes: model.slides.reduce((sum, slide) => sum + slide.shapes.length, 0) };
  }
  const order = new Map(out.findings.map((finding, index) => [finding, index]));
  const findings = [...out.findings].sort((a, b) => LABEL_RANK[a.label] - LABEL_RANK[b.label] || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || order.get(a)! - order.get(b)!);
  return { checks: out.results({ reference: Boolean(reference), rules: rules.length > 0, formulas }), findings, stats };
}

export type RunInput = {
  name: string;
  bytes: Uint8Array;
  reference?: { name: string; bytes: Uint8Array } | null;
  options?: CheckOptions;
  recalcTimeoutMs?: number;
};
export type RunOutput = { result: RunResult; model: Model; reference: Model | null };

export async function runChecks(input: RunInput): Promise<RunOutput> {
  const started = Date.now();
  if (input.bytes.length > MAX_FILE_BYTES) throw new EngineError('too_large', 'Files can be up to 4 MB');
  if (input.reference && input.reference.bytes.length > MAX_FILE_BYTES) throw new EngineError('too_large', 'Reference files can be up to 4 MB');
  const model = readModel(input.bytes);
  const reference = input.reference ? readModel(input.reference.bytes) : null;
  const recalc = model.kind === 'xlsx' ? await recalculate(model, { timeoutMs: input.recalcTimeoutMs }) : null;
  const { checks, findings, stats } = evaluate(model, recalc, reference, input.options);
  const result: RunResult = {
    engine: ENGINE_VERSION,
    file: { name: input.name, kind: model.kind, size: input.bytes.length, sha256: await sha256Hex(input.bytes) },
    reference: input.reference ? { name: input.reference.name, sha256: await sha256Hex(input.reference.bytes) } : null,
    verdict: verdictOf(findings), summary: summarise(findings, checks), checks, findings, stats, durationMs: Date.now() - started,
  };
  return { result, model, reference };
}
