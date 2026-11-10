'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { DiffChips, FindingChip, Icon, Stamp } from '@/components/Bits';
import { DocInspector, SheetInspector, SlideInspector, type Imported } from '@/components/Inspectors';
import { sourceText } from '@/components/RunRow';
import { PageState, useLoad, useShell } from '@/components/Shell';
import UploadButton from '@/components/UploadButton';
import { ago, api, errorText } from '@/lib/api';
import { whereText } from '@/lib/engine/collect';
import { LABEL_NAME } from '@/lib/engine/report';
import type { Finding, Label, Model } from '@/lib/engine/types';
import { runNumber, type AiResult, type RunDetail } from '@/lib/types';

const VIEWER = { xlsx: 'Univer Sheets', docx: 'Univer Docs', pptx: 'Univer Slides' } as const;
const GROUP_NOTE: Record<Label, string> = { confirmed: 'Decides the verdict', visual: 'Reported, never fails a build', ai: 'Does not affect the verdict' };

export default function RunReport() {
  const { project, run } = useParams<{ project: string; run: string }>();
  const router = useRouter();
  const { projects } = useShell();
  const path = `/api/p/${project}/runs/${run}`;
  const { data, error } = useLoad<RunDetail>(path);
  const [models, setModels] = useState<{ model: Model; reference: Model | null; univer?: Imported } | null>(null);
  const [modelNote, setModelNote] = useState('');
  const [aiStatus, setAiStatus] = useState<{ configured: boolean } | null>(null);
  const [ai, setAi] = useState<AiResult | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showReference, setShowReference] = useState(true);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    if (!data) return;
    setAi(data.ai);
    setModels(null); setModelNote('');
    if (!data.run.hasFile) { setModelNote(data.run.source === 'ci' ? 'The pipeline sent this report without the file, so there is nothing to open here.' : 'The file for this run is no longer stored. Its report is still complete.'); return; }
    let alive = true;
    api<{ model: Model; reference: Model | null; univer?: Imported }>(`${path}/model`).then(result => { if (alive) setModels(result); }).catch(e => { if (alive) setModelNote(errorText(e)); });
    api<{ configured: boolean }>('/api/ai/status').then(result => { if (alive) setAiStatus(result); }).catch(() => {});
    return () => { alive = false; };
  }, [data, path]);

  const findings = useMemo(() => data ? [...data.result.findings, ...(ai?.findings ?? [])] : [], [data, ai]);
  const options = useMemo(() => data ? { rules: data.testCase.rules, disable: data.testCase.disable, placeholders: data.testCase.phrases } : {}, [data]);
  if (!data) return <PageState error={error} />;

  const base = `/app/p/${project}`;
  const { result, testCase } = data;
  const projectName = projects.find(item => item.id === project)?.name ?? 'Project';
  const selected = findings.find(finding => finding.id === selectedId) ?? findings[0] ?? null;
  const added = new Set(data.diff?.added ?? []);
  const groups = (['confirmed', 'visual', 'ai'] as Label[]).map(label => ({ label, items: findings.filter(finding => finding.label === label) }));
  const s = result.summary;
  const referenceDeck = models?.reference?.kind === 'pptx' ? models.reference : null;

  const askLing = async () => {
    setAiBusy(true); setAiError('');
    try { setAi((await api<{ ai: AiResult }>(`${path}/observe`, { json: {} })).ai); } catch (e) { setAiError(errorText(e)); }
    setAiBusy(false);
  };

  const renderGroup = (group: { label: Label; items: Finding[] }) => (group.items.length > 0 || group.label === 'ai') && (
              <div key={group.label}>
                <div className="band-head">
                  <span className={`op-chip op-chip--${group.label}`}>{LABEL_NAME[group.label]}</span><span>{GROUP_NOTE[group.label]}</span>
                </div>
                {group.items.map(finding => (
                  <button key={finding.id} type="button" className={`op-row finding${selected?.id === finding.id ? ' is-selected' : ''}`} aria-pressed={selected?.id === finding.id} onClick={() => setSelectedId(finding.id)}>
                    <FindingChip finding={finding} />
                    <span className="row-main">
                      <span className="finding-title">{finding.title}</span>
                      <span className="tiny" style={{ fontSize: 12 }}>{whereText(finding.where)}, {finding.label === 'ai' ? 'Ling 3.2 Flash' : finding.check}{added.has(finding.id) ? ', new in this run' : ''}</span>
                    </span>
                  </button>
                ))}
                {group.label === 'ai' && (
                  <div className="panel-body" style={{ gap: 10 }}>
                    {ai && <span className="small muted">{ai.findings.length === 0 ? 'Ling 3.2 Flash had nothing to point out.' : `${ai.findings.length} observation${ai.findings.length === 1 ? '' : 's'}.`} Asked by {ai.ranBy}, {ago(ai.ranAt)}.{ai.dropped ? ` ${ai.dropped} dropped because the quoted text is not in the file.` : ''}</span>}
                    {!data.run.hasFile ? <span className="small muted">The file is not stored, so it cannot be read again.</span>
                      : aiStatus && !aiStatus.configured ? <span className="small muted">AI-assisted observations are not set up on this deployment.</span>
                      : <button type="button" className="op-ghost" style={{ alignSelf: 'flex-start' }} disabled={aiBusy || !aiStatus} onClick={askLing}><Icon.spark size={16} />{aiBusy ? <>Asking Ling 3.2 Flash<span className="busy-dots" /></> : ai ? 'Ask again' : 'Ask Ling 3.2 Flash'}</button>}
                    {!ai && data.run.hasFile && aiStatus?.configured && <span className="small muted">It reads the file&apos;s text and may point at wording that looks wrong. Each note must quote text found in the file.</span>}
                    {aiError && <p className="notice notice--error" role="alert" style={{ fontSize: 14 }}>{aiError}</p>}
                  </div>
                )}
              </div>
              );

  return (
    <>
      <div className="topbar">
        <p className="crumbs"><a className="op-link" href={base}>{projectName}</a> <span aria-hidden="true">/</span> <a className="op-link" href={`${base}/cases/${testCase.id}`}>{testCase.name}</a> <span aria-hidden="true">/</span> <span className="here mono">{runNumber(data.run.seq)}</span></p>
        <div className="topbar-actions">
          <div className="menu" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setMenu(false); }}>
            <button type="button" className="op-ghost" aria-expanded={menu} aria-haspopup="true" onClick={() => setMenu(!menu)}><Icon.download size={16} />Export report<Icon.chevron size={14} /></button>
            {menu && (
              <div className="menu-list">
                <a href={`${path}/export?format=html`} download>HTML page</a>
                <a href={`${path}/export?format=md`} download>Markdown</a>
                <a href={`${path}/export?format=json`} download>JSON</a>
                <a href={`${path}/export?format=junit`} download>JUnit XML</a>
              </div>
            )}
          </div>
          <UploadButton<{ runId: string }> action={`/api/p/${project}/cases/${testCase.id}/runs`} className="op-btn op-btn--sm" onDone={next => router.push(`${base}/runs/${next.runId}`)}><Icon.rerun size={16} />Rerun with a new file</UploadButton>
        </div>
      </div>

      <div className="content">
        <div className="run-head">
          <Stamp verdict={result.verdict} animate />
          <div className="page-title">
            <h1>{data.run.fileName}</h1>
            <p className="muted" style={{ fontSize: 15 }}>
              {ago(data.run.createdAt)}, {sourceText(data.run)}. {s.checksRun} checks run: {s.checksPassed} passed, {s.checksRun - s.checksPassed} with findings{s.checksSkipped ? `, ${s.checksSkipped} skipped` : ''}.
              {result.reference ? ` Compared with ${result.reference.name}.` : ''}{data.run.source === 'ci' ? ' Reported by the pipeline.' : ''}
              {data.run.ci?.runUrl && <> <a className="op-link" href={data.run.ci.runUrl} rel="noreferrer" style={{ fontWeight: 600, color: '#0c0c0c' }}>Open the CI run</a></>}
            </p>
          </div>
          <div className="run-diff">
            {data.run.previousSeq !== null ? <span>Since {runNumber(data.run.previousSeq)}</span> : null}
            <DiffChips diff={data.run.diff} />
          </div>
        </div>

        <div className="cols">
          <section className="op-card panel findings" aria-label="Findings">
            {groups.filter(group => group.label !== 'ai').map(renderGroup)}
            {result.findings.length === 0 && (
              <div className="empty">
                <strong>No findings</strong>
                <span>{s.checksPassed} checks passed{s.checksSkipped ? ` and ${s.checksSkipped} ${s.checksSkipped === 1 ? 'was' : 'were'} skipped. Skipped checks are listed under “All checks”; they are not passes` : ''}.</span>
              </div>
            )}
            {groups.filter(group => group.label === 'ai').map(renderGroup)}
            {data.diff && data.diff.fixed.length > 0 && (
              <div>
                <div className="band-head"><span className="op-chip op-chip--pass">Fixed</span><span>Since {runNumber(data.run.previousSeq ?? 0)}</span></div>
                <ul className="rule-list">{data.diff.fixed.map(finding => <li key={finding.id} style={{ fontSize: 14, color: '#3d3d40' }}><span style={{ textDecoration: 'line-through', overflowWrap: 'anywhere' }}>{finding.title}</span></li>)}</ul>
              </div>
            )}
          </section>

          <div className="inspect">
            {selected && (
              <section className="op-card detail" aria-live="polite" aria-label="Selected finding">
                <div className="detail-text">
                  <h2>{selected.title}</h2>
                  <p>{selected.detail}</p>
                  <span className="tiny">{whereText(selected.where)}, {selected.label === 'ai' ? 'AI-assisted observation' : selected.check}</span>
                </div>
                {selected.label === 'ai' ? <blockquote className="quote">Quote found in the file: “{selected.actual}”</blockquote>
                  : (selected.expected !== undefined || selected.actual !== undefined) && (
                    <dl className="compare">
                      {selected.expected !== undefined && <div className="want"><dt>Expected</dt><dd>{selected.expected}</dd></div>}
                      {selected.actual !== undefined && <div className="got"><dt>In the file</dt><dd>{selected.actual}</dd></div>}
                    </dl>
                  )}
              </section>
            )}

            <section className="op-card panel" aria-label={`The file, opened in ${VIEWER[result.file.kind]}`}>
              <div className="viewer-head">
                <span>Opened in {VIEWER[result.file.kind]}</span>
                {referenceDeck && <label>Show the reference boxes<input className="op-switch" type="checkbox" checked={showReference} onChange={event => setShowReference(event.target.checked)} /></label>}
              </div>
              {!models && <p className="viewer-note">{modelNote || <>Opening the file<span className="busy-dots" /></>}</p>}
              {models?.model.kind === 'xlsx' && <SheetInspector workbook={models.model} reference={models.reference} findings={findings} selected={selected} options={options} imported={models.univer ?? null} />}
              {models?.model.kind === 'docx' && <DocInspector doc={models.model} findings={findings} selected={selected} imported={models.univer ?? null} />}
              {models?.model.kind === 'pptx' && <SlideInspector deck={models.model} reference={referenceDeck} findings={findings} selected={selected} showReference={showReference} imported={models.univer ?? null} />}
            </section>

            <details className="op-card panel">
              <summary>All {result.checks.length} checks<Icon.chevron /></summary>
              <div className="op-scroll">
                <table className="checks-table">
                  <thead><tr><th>Check</th><th>Label</th><th>Result</th><th>Findings</th></tr></thead>
                  <tbody>
                    {result.checks.map(check => (
                      <tr key={check.id}>
                        <td>{check.title}<br /><span className="tiny" style={{ fontSize: 11.5 }}>{check.id}</span></td>
                        <td>{LABEL_NAME[check.label]}</td>
                        <td>{check.status === 'skipped' ? <span className="op-chip op-chip--skip">Skipped</span> : check.status === 'pass' ? <span className="op-chip op-chip--pass">Passed</span>
                          : <span className={`op-chip op-chip--${check.label === 'visual' ? 'visual' : check.status}`}>{check.status === 'fail' ? 'Failed' : check.status === 'warn' ? 'Warning' : 'Note'}</span>}
                          {check.note && <><br /><span className="small muted">{check.note}</span></>}</td>
                        <td>{check.findings}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="panel-foot">A skipped or unverified check is not a pass. sha256 {result.file.sha256.slice(0, 16)}, engine {result.engine}.</p>
            </details>
          </div>
        </div>
      </div>
    </>
  );
}
