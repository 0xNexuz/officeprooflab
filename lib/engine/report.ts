// Turns a RunResult into the formats people and pipelines read: Markdown, HTML and JUnit XML. JSON is the result itself.
import { whereText } from './collect.ts';
import type { Finding, Label, RunResult } from './types.ts';

export const LABEL_NAME: Record<Label, string> = { confirmed: 'Confirmed', visual: 'Visual', ai: 'AI-assisted' };
export const LABEL_NOTE: Record<Label, string> = {
  confirmed: 'Deterministic test results. These decide the verdict.',
  visual: 'Layout comparison and estimates. Reported, never fail a build.',
  ai: 'Observations from Ling 3.2 Flash, each tied to a quote found in the file. Never part of the verdict.',
};
const SEVERITY_NAME = { fail: 'Fail', warn: 'Warning', info: 'Note' } as const;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

export function summaryLine(result: RunResult): string {
  const s = result.summary;
  const parts = [plural(s.fail, 'confirmed failure'), plural(s.warn, 'warning')];
  if (s.info) parts.push(plural(s.info, 'note'));
  if (s.visual) parts.push(`${s.visual} visual`);
  if (s.ai) parts.push(`${s.ai} AI-assisted`);
  return `${result.verdict.toUpperCase()}: ${parts.join(', ')}. ${s.checksRun} checks run, ${s.checksPassed} passed, ${s.checksSkipped} skipped.`;
}

const groups = (findings: Finding[]) => (['confirmed', 'visual', 'ai'] as Label[]).map(label => ({ label, items: findings.filter(finding => finding.label === label) })).filter(group => group.items.length);

export function toMarkdown(result: RunResult): string {
  const md = (text: string) => text.replace(/([\\`*_{}\[\]<>|#])/g, '\\$1');
  const lines = [`# OfficeProof report: ${md(result.file.name)}`, '', `**${summaryLine(result)}**`, '',
    `- File: \`${result.file.name}\` (${result.file.kind}, ${result.file.size.toLocaleString('en-US')} bytes, sha256 \`${result.file.sha256.slice(0, 16)}\`)`,
    `- Reference: ${result.reference ? `\`${result.reference.name}\` (sha256 \`${result.reference.sha256.slice(0, 16)}\`)` : 'none'}`,
    `- Engine: OfficeProof Lab ${result.engine}, formulas recalculated with Univer`, ''];
  for (const group of groups(result.findings)) {
    lines.push(`## ${LABEL_NAME[group.label]} findings`, '', `_${LABEL_NOTE[group.label]}_`, '');
    group.items.forEach((finding, index) => {
      lines.push(`${index + 1}. **${SEVERITY_NAME[finding.severity]}** \`${finding.check}\` ${md(whereText(finding.where))}: ${md(finding.title)}`);
      lines.push(`   ${md(finding.detail)}`);
      const compare = [finding.expected !== undefined ? `Expected: ${md(finding.expected)}.` : '', finding.actual !== undefined ? `In the file: ${md(finding.actual)}.` : ''].filter(Boolean).join(' ');
      if (compare) lines.push(`   ${compare}`);
    });
    lines.push('');
  }
  if (!result.findings.length) lines.push('No findings.', '');
  lines.push('## Checks', '', '| Check | Label | Result | Findings |', '| --- | --- | --- | --- |');
  for (const check of result.checks) {
    const status = check.status === 'skipped' ? `Skipped${check.note ? ` (${check.note})` : ''}` : check.status === 'pass' ? 'Passed' : check.status === 'fail' ? 'Failed' : check.status === 'warn' ? 'Warning' : 'Note';
    lines.push(`| ${md(check.title)} \`${check.id}\` | ${LABEL_NAME[check.label]} | ${md(status)} | ${check.findings} |`);
  }
  lines.push('', 'A skipped or unverified check is not a pass.', '');
  return lines.join('\n');
}

const xml = (text: string) => text.replace(/[<>&"']/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[ch]!).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ');

/** One test suite per file and one test case per check. Only a confirmed failure is a JUnit failure. */
export function toJUnit(results: RunResult[]): string {
  const failed = (result: RunResult) => result.checks.filter(check => check.label === 'confirmed' && check.status === 'fail').length;
  const skipped = (result: RunResult) => result.checks.filter(check => check.status === 'skipped').length;
  const out = ['<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="OfficeProof Lab" tests="${results.reduce((sum, result) => sum + result.checks.length, 0)}" failures="${results.reduce((sum, result) => sum + failed(result), 0)}" skipped="${results.reduce((sum, result) => sum + skipped(result), 0)}">`];
  for (const result of results) {
    out.push(`  <testsuite name="${xml(result.file.name)}" tests="${result.checks.length}" failures="${failed(result)}" skipped="${skipped(result)}" time="${(result.durationMs / 1000).toFixed(3)}">`);
    for (const check of result.checks) {
      const findings = result.findings.filter(finding => finding.check === check.id);
      const body = findings.map(finding => `${whereText(finding.where)}: ${finding.title}. ${finding.detail}`).join('\n');
      out.push(`    <testcase classname="officeproof.${result.file.kind}.${check.label}" name="${xml(`${check.id} ${check.title}`)}">`);
      if (check.status === 'skipped') out.push(`      <skipped message="${xml(check.note ?? 'Skipped')}"/>`);
      else if (check.label === 'confirmed' && check.status === 'fail') out.push(`      <failure message="${xml(findings[0]?.title ?? check.title)}" type="${check.id}">${xml(body)}</failure>`);
      else if (findings.length) out.push(`      <system-out>${xml(`${LABEL_NAME[check.label]} ${check.status}: ${body}`)}</system-out>`);
      out.push('    </testcase>');
    }
    out.push('  </testsuite>');
  }
  out.push('</testsuites>', '');
  return out.join('\n');
}

const html = (text: string) => text.replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[ch]!);

/** A self-contained page: no scripts, no outside requests. */
export function toHtml(result: RunResult): string {
  const chip = (label: Label) => `<span class="chip ${label}">${LABEL_NAME[label]}</span>`;
  const sections = groups(result.findings).map(group => `
    <section><h2>${chip(group.label)} <small>${html(LABEL_NOTE[group.label])}</small></h2>
    ${group.items.map(finding => `<article class="${finding.severity}"><p class="meta"><b>${SEVERITY_NAME[finding.severity]}</b> <code>${html(finding.check)}</code> <code>${html(whereText(finding.where))}</code></p>
      <h3>${html(finding.title)}</h3><p>${html(finding.detail)}</p>
      ${finding.expected !== undefined || finding.actual !== undefined ? `<dl>${finding.expected !== undefined ? `<div><dt>Expected</dt><dd>${html(finding.expected)}</dd></div>` : ''}${finding.actual !== undefined ? `<div><dt>In the file</dt><dd>${html(finding.actual)}</dd></div>` : ''}</dl>` : ''}</article>`).join('')}
    </section>`).join('');
  const rows = result.checks.map(check => `<tr><td>${html(check.title)} <code>${check.id}</code></td><td>${LABEL_NAME[check.label]}</td><td class="s-${check.status}">${check.status === 'skipped' ? `Skipped${check.note ? `: ${html(check.note)}` : ''}` : check.status === 'pass' ? 'Passed' : check.status === 'fail' ? 'Failed' : check.status === 'warn' ? 'Warning' : 'Note'}</td><td>${check.findings}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>OfficeProof report: ${html(result.file.name)}</title>
<style>body{margin:0;background:#e3e1dc;color:#0c0c0c;font:16px/1.5 system-ui,sans-serif}main{max-width:920px;margin:0 auto;padding:40px 24px 64px}h1{font-size:34px;line-height:1.1;margin:0 0 8px;overflow-wrap:anywhere}h2{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin:40px 0 14px;font-size:16px}h2 small{font-weight:400;color:#3d3d40}h3{margin:6px 0;font-size:18px}
code{font:13px ui-monospace,Menlo,monospace;background:#d9d6cf;padding:2px 6px;border-radius:4px}.stamp{display:inline-block;padding:6px 14px;border:3px solid;border-radius:8px;font:700 22px ui-monospace,monospace;letter-spacing:.08em;transform:rotate(-3deg);margin-right:14px}.stamp.fail{color:#b0141a;background:#fbe3e1}.stamp.pass{background:#a6ff6e}.stamp.warn{background:#ff8a3d}
.chip{display:inline-block;padding:4px 10px;border:1.5px solid #0c0c0c;border-radius:6px;font:500 12px ui-monospace,monospace}.chip.confirmed{background:#0c0c0c;color:#fff}.chip.visual{background:linear-gradient(135deg,#a6ff6e,#f5e663 30%,#ff9a3d 55%,#e9408f 80%)}.chip.ai{border-style:dashed;border-color:#5b3fd6;color:#3f2aa8}
article{background:#f7f6f2;border:1.5px solid #0c0c0c;border-radius:10px;padding:16px 18px;margin:0 0 12px}article.fail{box-shadow:inset 6px 0 0 #d21f26}article.warn{box-shadow:inset 6px 0 0 #ff8a3d}.meta{margin:0;font-size:14px}article p{margin:4px 0}dl{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0 0}dl div{border:1.5px solid #0c0c0c;border-radius:8px;padding:8px 12px;background:#fff}dt{font-size:12px;font-weight:700}dd{margin:2px 0 0;font:14px ui-monospace,monospace;overflow-wrap:anywhere}
table{width:100%;border-collapse:collapse;background:#f7f6f2;border:1.5px solid #0c0c0c;font-size:14px}td,th{text-align:left;padding:8px 12px;border-bottom:1px solid #c9c6bf;vertical-align:top}.s-fail{color:#b0141a;font-weight:700}.s-skipped{color:#3d3d40;font-style:italic}.facts{color:#3d3d40;font-size:14px}</style></head>
<body><main><h1><span class="stamp ${result.verdict}">${result.verdict.toUpperCase()}</span>${html(result.file.name)}</h1>
<p>${html(summaryLine(result))}</p>
<p class="facts">sha256 <code>${result.file.sha256.slice(0, 16)}</code> ${result.reference ? `Compared with <code>${html(result.reference.name)}</code>.` : 'No reference file.'} OfficeProof Lab ${html(result.engine)}; formulas recalculated with Univer.</p>
${sections || '<p>No findings.</p>'}
<h2>Checks</h2><table><thead><tr><th>Check</th><th>Label</th><th>Result</th><th>Findings</th></tr></thead><tbody>${rows}</tbody></table>
<p class="facts">A skipped or unverified check is not a pass.</p></main></body></html>
`;
}
