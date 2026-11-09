// OfficeProof Lab command-line tool: runs the check engine on files or on a config of test cases.
// Exit codes: 0 no confirmed failure (and every "expect" met), 1 a confirmed failure, 2 a usage or file error.
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { CATALOG, ENGINE_VERSION, EngineError, LABEL_NAME, runChecks, summaryLine, toHtml, toJUnit, toMarkdown, whereText,
  type CheckOptions, type FileKind, type Label, type Rule, type RunResult, type Verdict } from '../lib/engine/index.ts';

type Case = { name: string; file: string; reference?: string; rules?: unknown; disable?: string[]; placeholders?: string[]; expect?: Verdict };
type Outcome = { item: Case; result: RunResult; bytes: Uint8Array; met: boolean };

class UsageError extends Error {}

const HELP = `OfficeProof Lab ${ENGINE_VERSION}
Tests generated Office files (.xlsx, .docx, .pptx). Formulas are recalculated with Univer.

Usage
  officeproof check <file> [--reference <file>] [--rules <rules.json>] [--name <test case>]
  officeproof check --config officeproof.json
  officeproof checks [xlsx|docx|pptx]

Options
  --format <text|json|markdown|junit|html>   What to print (default: text)
  --out <folder>     Also write report.json, report.md, report.junit.xml and an .html report per file
  --upload           Send the results to an OfficeProof Lab dashboard
  --url <address>    Dashboard address (or set OFFICEPROOF_URL, or "url" in the config)
  --token <token>    Project token. Prefer the OFFICEPROOF_TOKEN environment variable
  --no-color         Plain output
  --version, --help

Exit codes
  0  no confirmed failure, and every "expect" in the config was met
  1  a confirmed failure (visual and AI-assisted findings never fail a run)
  2  the command, the config or a file could not be read
`;

function parseArgs(argv: string[]) {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  const takesValue = new Set(['config', 'reference', 'rules', 'name', 'format', 'out', 'url', 'token']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const [name, inline] = arg.slice(2).split(/=(.*)/s);
    if (takesValue.has(name)) {
      const value = inline ?? argv[++i];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`--${name} needs a value`);
      flags.set(name, value);
    } else if (['upload', 'no-color', 'version', 'help'].includes(name)) flags.set(name, true);
    else throw new UsageError(`Unknown option --${name}`);
  }
  return { flags, positional };
}

function readJson(file: string, what: string): unknown {
  if (!existsSync(file)) throw new UsageError(`${what} not found: ${file}`);
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { throw new UsageError(`${what} is not valid JSON: ${file}`); }
}

function loadCases(flags: Map<string, string | true>, positional: string[]): { cases: Case[]; base: string; url?: string; project?: string } {
  const config = flags.get('config');
  if (typeof config === 'string') {
    if (positional.length) throw new UsageError('Give either a file or --config, not both');
    const data = readJson(config, 'Config') as { cases?: unknown; url?: unknown; project?: unknown };
    if (!data || typeof data !== 'object' || !Array.isArray(data.cases) || !data.cases.length) throw new UsageError('The config needs a "cases" list with at least one test case');
    const cases = data.cases.map((item, index) => {
      const entry = item as Record<string, unknown>;
      if (!entry || typeof entry !== 'object' || typeof entry.file !== 'string' || !entry.file) throw new UsageError(`Case ${index + 1} needs a "file"`);
      if (entry.expect !== undefined && !['pass', 'warn', 'fail'].includes(entry.expect as string)) throw new UsageError(`Case ${index + 1}: "expect" must be pass, warn or fail`);
      if (entry.reference !== undefined && typeof entry.reference !== 'string') throw new UsageError(`Case ${index + 1}: "reference" must be a file path`);
      for (const key of ['disable', 'placeholders']) if (entry[key] !== undefined && !(Array.isArray(entry[key]) && (entry[key] as unknown[]).every(value => typeof value === 'string'))) throw new UsageError(`Case ${index + 1}: "${key}" must be a list of text values`);
      return { name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim().slice(0, 120) : path.basename(entry.file), file: entry.file, reference: entry.reference as string | undefined,
        rules: entry.rules, disable: entry.disable as string[] | undefined, placeholders: entry.placeholders as string[] | undefined, expect: entry.expect as Verdict | undefined };
    });
    return { cases, base: path.dirname(path.resolve(config)), url: typeof data.url === 'string' ? data.url : undefined, project: typeof data.project === 'string' ? data.project : undefined };
  }
  if (positional.length !== 1) throw new UsageError('Give one file to check, or --config with a list of test cases');
  const rulesFile = flags.get('rules');
  return { base: process.cwd(), cases: [{ name: typeof flags.get('name') === 'string' ? String(flags.get('name')) : path.basename(positional[0]), file: positional[0],
    reference: typeof flags.get('reference') === 'string' ? String(flags.get('reference')) : undefined, rules: typeof rulesFile === 'string' ? readJson(rulesFile, 'Rules file') : undefined }] };
}

function paint(enabled: boolean) {
  const wrap = (code: string) => (text: string) => enabled ? `\x1b[${code}m${text}\x1b[0m` : text;
  return { red: wrap('1;31'), green: wrap('1;32'), yellow: wrap('1;33'), dim: wrap('2'), bold: wrap('1'), violet: wrap('35') };
}

function textReport(outcomes: Outcome[], color: boolean): string {
  const c = paint(color);
  const stamp = (verdict: Verdict) => verdict === 'fail' ? c.red('FAIL') : verdict === 'warn' ? c.yellow('WARN') : c.green('PASS');
  const lines = [`OfficeProof Lab ${ENGINE_VERSION}`, ''];
  for (const { item, result, met } of outcomes) {
    lines.push(`${stamp(result.verdict)}  ${c.bold(item.name)}  ${c.dim(item.file)}`);
    lines.push(`      ${summaryLine(result).replace(/^[A-Z]+: /, '')}`);
    if (item.expect) lines.push(`      Expected ${item.expect.toUpperCase()}: ${met ? 'met' : c.red('not met')}`);
    for (const label of ['confirmed', 'visual', 'ai'] as Label[]) {
      const group = result.findings.filter(finding => finding.label === label);
      if (!group.length) continue;
      lines.push(`  ${c.bold(LABEL_NAME[label])}${label === 'confirmed' ? '' : c.dim(' (reported, never fails a run)')}`);
      for (const finding of group) {
        const tag = finding.severity === 'fail' ? c.red('fail') : finding.severity === 'warn' ? c.yellow('warn') : c.dim('note');
        lines.push(`    ${tag}  ${finding.check.padEnd(17)} ${c.dim(whereText(finding.where))}`);
        lines.push(`          ${finding.title}`);
        const compare = [finding.expected !== undefined ? `expected ${finding.expected}` : '', finding.actual !== undefined ? `in the file ${finding.actual}` : ''].filter(Boolean).join('; ');
        if (compare) lines.push(c.dim(`          ${compare}`));
      }
    }
    const skipped = result.checks.filter(check => check.status === 'skipped');
    if (skipped.length) lines.push(c.dim(`  Skipped: ${skipped.map(check => `${check.id} (${check.note ?? 'skipped'})`).join(', ')}`));
    lines.push('');
  }
  const failed = outcomes.filter(outcome => !outcome.met).length;
  lines.push(failed ? c.red(`${failed} of ${outcomes.length} ${outcomes.length === 1 ? 'file' : 'files'} did not meet the bar.`) : c.green(`All ${outcomes.length} ${outcomes.length === 1 ? 'file' : 'files'} met the bar.`));
  return lines.join('\n');
}

const slug = (name: string) => name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'report';

async function upload(outcomes: Outcome[], url: string, token: string, project: string | undefined) {
  const base = url.replace(/\/+$/, '');
  if (!/^https:\/\//.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new UsageError('The dashboard address must start with https://');
  const env = process.env;
  const ci = { provider: env.GITHUB_ACTIONS ? 'GitHub Actions' : env.CI ? 'CI' : 'Command line', commit: (env.GITHUB_SHA ?? '').slice(0, 40), branch: (env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || '').slice(0, 120),
    runUrl: env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : '' };
  const links: string[] = [];
  for (const { item, result, bytes } of outcomes) {
    const form = new FormData();
    form.set('meta', JSON.stringify({ case: item.name, project, result, ci }));
    // The dashboard needs the file to open it for inspection. Requests are capped, so a large file is left out.
    if (bytes.length <= 3_500_000) form.set('file', new Blob([bytes as unknown as ArrayBuffer]), path.basename(item.file));
    let response: Response;
    for (let attempt = 1; ; attempt++) {
      try { response = await fetch(`${base}/api/ci/runs`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form }); }
      catch { throw new UsageError(`Could not reach the dashboard at ${base}`); }
      // A busy dashboard asks the sender to slow down; wait and try the same run again.
      if (response.status !== 429 || attempt === 4) break;
      await new Promise(resolve => setTimeout(resolve, attempt * 1500));
    }
    const data = await response.json().catch(() => null) as { error?: string; url?: string } | null;
    if (!response.ok) throw new UsageError(`The dashboard refused the upload for "${item.name}": ${data?.error ?? `HTTP ${response.status}`}`);
    if (data?.url) links.push(`${item.name}: ${data.url}`);
  }
  return links;
}

async function main(argv: string[]): Promise<number> {
  const { flags, positional } = parseArgs(argv);
  if (flags.has('version')) { console.log(ENGINE_VERSION); return 0; }
  const command = positional.shift();
  if (flags.has('help') || !command) { console.log(HELP); return command || flags.has('help') ? 0 : 2; }
  if (command === 'checks') {
    const kind = positional[0] as FileKind | undefined;
    if (kind && !['xlsx', 'docx', 'pptx'].includes(kind)) throw new UsageError('Choose xlsx, docx or pptx');
    for (const check of CATALOG.filter(item => !kind || item.kind === kind)) console.log(`${check.id.padEnd(18)} ${LABEL_NAME[check.label].padEnd(10)} ${check.severity.padEnd(5)} ${check.title}`);
    return 0;
  }
  if (command !== 'check') throw new UsageError(`Unknown command "${command}"`);
  const format = (flags.get('format') as string | undefined) ?? 'text';
  if (!['text', 'json', 'markdown', 'junit', 'html'].includes(format)) throw new UsageError('--format must be text, json, markdown, junit or html');
  const { cases, base, url: configUrl, project } = loadCases(flags, positional);

  const outcomes: Outcome[] = [];
  for (const item of cases) {
    const filePath = path.resolve(base, item.file);
    if (!existsSync(filePath)) throw new UsageError(`File not found: ${item.file}`);
    const referencePath = item.reference ? path.resolve(base, item.reference) : null;
    if (referencePath && !existsSync(referencePath)) throw new UsageError(`Reference file not found: ${item.reference}`);
    const bytes = new Uint8Array(readFileSync(filePath));
    const options: CheckOptions = { disable: item.disable, placeholders: item.placeholders };
    try {
      const reference = referencePath ? { name: path.basename(referencePath), bytes: new Uint8Array(readFileSync(referencePath)) } : null;
      const { result } = await runChecks({ name: path.basename(filePath), bytes, reference, options: { ...options, rules: item.rules as Rule[] | undefined } });
      outcomes.push({ item, result, bytes, met: item.expect ? result.verdict === item.expect : result.verdict !== 'fail' });
    } catch (error) {
      if (error instanceof EngineError) throw new UsageError(`${item.file}: ${error.message}`);
      throw error;
    }
  }

  const results = outcomes.map(outcome => outcome.result);
  const outDir = flags.get('out');
  if (typeof outDir === 'string') {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ engine: ENGINE_VERSION, results: outcomes.map(o => ({ case: o.item.name, expect: o.item.expect ?? null, met: o.met, result: o.result })) }, null, 2));
    writeFileSync(path.join(outDir, 'report.md'), results.map(toMarkdown).join('\n---\n\n'));
    writeFileSync(path.join(outDir, 'report.junit.xml'), toJUnit(results));
    outcomes.forEach((outcome, index) => writeFileSync(path.join(outDir, `${String(index + 1).padStart(2, '0')}-${slug(outcome.item.name)}.html`), toHtml(outcome.result)));
  }
  if (process.env.GITHUB_STEP_SUMMARY) { try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, results.map(toMarkdown).join('\n---\n\n')); } catch { /* the summary is a convenience */ } }

  if (format === 'json') console.log(JSON.stringify(outcomes.length === 1 && !flags.has('config') ? results[0] : { engine: ENGINE_VERSION, results: outcomes.map(o => ({ case: o.item.name, expect: o.item.expect ?? null, met: o.met, result: o.result })) }, null, 2));
  else if (format === 'markdown') console.log(results.map(toMarkdown).join('\n---\n\n'));
  else if (format === 'junit') console.log(toJUnit(results));
  else if (format === 'html') console.log(toHtml(results[0]));
  else console.log(textReport(outcomes, !flags.has('no-color') && Boolean(process.stdout.isTTY) && !process.env.NO_COLOR));

  if (flags.has('upload')) {
    const url = (flags.get('url') as string | undefined) ?? process.env.OFFICEPROOF_URL ?? configUrl;
    const token = (flags.get('token') as string | undefined) ?? process.env.OFFICEPROOF_TOKEN;
    if (!url) throw new UsageError('--upload needs the dashboard address: --url, OFFICEPROOF_URL or "url" in the config');
    if (!token) throw new UsageError('--upload needs a project token in OFFICEPROOF_TOKEN');
    const links = await upload(outcomes, url, token, project);
    if (format === 'text') console.log(`\nSent ${outcomes.length} ${outcomes.length === 1 ? 'run' : 'runs'} to the dashboard.${links.length ? `\n${links.join('\n')}` : ''}`);
  }
  return outcomes.every(outcome => outcome.met) ? 0 : 1;
}

main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
  if (error instanceof UsageError) console.error(`officeproof: ${error.message}`);
  else console.error(`officeproof: ${error instanceof Error ? error.message : 'unexpected error'}`);
  process.exitCode = 2;
});
