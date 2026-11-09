'use client';

import { useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Icon, KindTile, RunChips, Stamp } from '@/components/Bits';
import DropZone from '@/components/DropZone';
import RunRow, { sourceText } from '@/components/RunRow';
import { PageState, useLoad, useShell } from '@/components/Shell';
import { ago, api, errorText } from '@/lib/api';
import type { Overview } from '@/lib/types';

export default function ProjectOverview() {
  const { project } = useParams<{ project: string }>();
  const router = useRouter();
  const { reloadProjects } = useShell();
  const { data, error, reload } = useLoad<Overview>(`/api/p/${project}`);
  const caseDialog = useRef<HTMLDialogElement>(null);
  const renameDialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState('xlsx');
  const [projectName, setProjectName] = useState('');
  const [formError, setFormError] = useState('');
  if (!data) return <PageState error={error} />;

  const base = `/app/p/${project}`;
  const ran = data.cases.filter(item => item.lastRun);
  const count = (verdict: string) => ran.filter(item => item.lastRun!.verdict === verdict).length;
  const latest = data.recent[0];
  const createCase = async (event: React.FormEvent) => {
    event.preventDefault(); setFormError('');
    try { const { caseId } = await api<{ caseId: string }>(`/api/p/${project}/cases`, { json: { name, kind } }); router.push(`${base}/cases/${caseId}`); }
    catch (e) { setFormError(errorText(e)); }
  };
  const rename = async (event: React.FormEvent) => {
    event.preventDefault(); setFormError('');
    try { await api('/api/projects', { json: { action: 'rename', projectId: project, name: projectName } }); renameDialog.current?.close(); await Promise.all([reload(), reloadProjects()]); }
    catch (e) { setFormError(errorText(e)); }
  };

  return (
    <>
      <div className="topbar">
        <p className="crumbs">{data.project.name} <span aria-hidden="true">/</span> <span className="here">Overview</span></p>
        <button type="button" className="op-btn op-btn--sm op-btn--ink" onClick={() => { setFormError(''); caseDialog.current?.showModal(); }}><Icon.plus size={16} />New test case</button>
      </div>
      <div className="content">
        <div className="page-head">
          <div className="page-title">
            <h1>{data.project.name}</h1>
            <p className="muted">
              {data.cases.length === 0 ? 'No test cases yet.' : `${data.cases.length} test case${data.cases.length === 1 ? '' : 's'}.`}
              {latest ? ` The last run was ${ago(latest.createdAt)}, ${sourceText(latest)}.` : ''}{' '}
              <button type="button" className="op-link" style={{ border: 0, cursor: 'pointer', font: 'inherit', fontWeight: 600, padding: '0 0 3px', color: '#0c0c0c' }} onClick={() => { setProjectName(data.project.name); setFormError(''); renameDialog.current?.showModal(); }}>Rename</button>
            </p>
          </div>
          {ran.length > 0 && (
            <div className="tally">
              {count('fail') > 0 && <span><Stamp verdict="fail" small animate />{count('fail')} failing</span>}
              {count('warn') > 0 && <span><Stamp verdict="warn" small />{count('warn')} with warnings</span>}
              {count('pass') > 0 && <span><Stamp verdict="pass" small />{count('pass')} passing</span>}
            </div>
          )}
        </div>

        <div className="cols">
          <section className="op-card panel col-main" aria-labelledby="cases-title" style={{ gap: 0 }}>
            <div className="panel-head"><h2 id="cases-title">Test cases</h2></div>
            {data.cases.length === 0 && (
              <div className="empty">
                <strong>Nothing to test yet</strong>
                <span>Drop a generated .xlsx, .docx or .pptx file on the right. A test case named after the file is made for it, and you can add rules and a reference afterwards.</span>
              </div>
            )}
            {data.cases.map(item => (
              <a key={item.id} className="op-row" href={`${base}/cases/${item.id}`} style={{ flexWrap: 'wrap' }}>
                {item.lastRun ? <Stamp verdict={item.lastRun.verdict} small /> : <span className="op-chip op-chip--skip">No runs</span>}
                <KindTile kind={item.kind} small />
                <span className="row-main">
                  <span className="row-title">{item.name}</span>
                  <span className="tiny">{item.lastRun ? item.lastRun.fileName : `${item.ruleCount} rule${item.ruleCount === 1 ? '' : 's'}${item.hasReference ? ', reference set' : ''}`}</span>
                </span>
                <span className="row-chips">{item.lastRun && <RunChips run={item.lastRun} />}</span>
                <span className="row-when">{item.lastRun ? <>{ago(item.lastRun.createdAt)}<br />{item.lastRun.source === 'ci' ? 'from CI' : 'uploaded'}</> : 'Not run yet'}</span>
              </a>
            ))}
          </section>

          <div className="col-side">
            <DropZone action={`/api/p/${project}/runs`} title="Run a file" hint="Drop a .xlsx, .docx or .pptx here, or choose one. Files can be up to 4 MB."
              cases={data.cases.map(item => ({ id: item.id, name: item.name }))} onDone={result => router.push(`${base}/runs/${result.runId}`)} />
            <section className="op-card panel" aria-labelledby="recent-title">
              <div className="panel-head"><h2 id="recent-title">Recent runs</h2>{data.recent.length > 0 && <a className="op-link small" href={`${base}/runs`} style={{ fontWeight: 600 }}>All runs</a>}</div>
              {data.recent.length === 0 && <div className="empty"><span>Runs appear here as files are checked.</span></div>}
              {data.recent.slice(0, 5).map(run => <RunRow key={run.id} run={run} href={`${base}/runs/${run.id}`} showCase />)}
            </section>
          </div>
        </div>
      </div>

      <dialog ref={caseDialog} className="sheet" aria-labelledby="new-case-title">
        <form className="sheet-body" onSubmit={createCase}>
          <h2 id="new-case-title">New test case</h2>
          <label className="field">Name<input className="op-input" value={name} onChange={event => setName(event.target.value)} required maxLength={120} placeholder="Revenue summary workbook" /></label>
          <label className="field">Kind of file
            <select className="op-input" value={kind} onChange={event => setKind(event.target.value)}>
              <option value="xlsx">Spreadsheet (.xlsx)</option><option value="docx">Document (.docx)</option><option value="pptx">Slides (.pptx)</option>
            </select>
          </label>
          {formError && <p className="notice notice--error" role="alert">{formError}</p>}
          <div className="sheet-actions">
            <button type="button" className="op-ghost" onClick={() => caseDialog.current?.close()}>Cancel</button>
            <button type="submit" className="op-btn op-btn--sm op-btn--ink">Create test case</button>
          </div>
        </form>
      </dialog>
      <dialog ref={renameDialog} className="sheet" aria-labelledby="rename-title">
        <form className="sheet-body" onSubmit={rename}>
          <h2 id="rename-title">Rename project</h2>
          <label className="field">Name<input className="op-input" value={projectName} onChange={event => setProjectName(event.target.value)} required maxLength={80} /></label>
          {formError && <p className="notice notice--error" role="alert">{formError}</p>}
          <div className="sheet-actions">
            <button type="button" className="op-ghost" onClick={() => renameDialog.current?.close()}>Cancel</button>
            <button type="submit" className="op-btn op-btn--sm op-btn--ink">Save name</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
