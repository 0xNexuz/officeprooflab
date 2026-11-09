'use client';

import { useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Icon, KindTile, Stamp } from '@/components/Bits';
import RulesEditor from '@/components/RulesEditor';
import RunRow from '@/components/RunRow';
import { PageState, useLoad, useShell } from '@/components/Shell';
import UploadButton from '@/components/UploadButton';
import { api, ago, errorText } from '@/lib/api';
import { checksFor } from '@/lib/engine/catalog';
import type { Rule } from '@/lib/engine/types';
import { KIND_LABEL, type CaseDetail } from '@/lib/types';

export default function TestCase() {
  const { project, case: caseId } = useParams<{ project: string; case: string }>();
  const router = useRouter();
  const { projects } = useShell();
  const path = `/api/p/${project}/cases/${caseId}`;
  const { data, error, reload } = useLoad<CaseDetail>(path);
  const [notice, setNotice] = useState('');
  const [phrases, setPhrases] = useState<string | null>(null);
  // A switch moves at once; the saved list catches up behind it.
  const [pendingOff, setPendingOff] = useState<string[] | null>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  if (!data) return <PageState error={error} />;

  const base = `/app/p/${project}`;
  const projectName = projects.find(item => item.id === project)?.name ?? 'Project';
  const update = async (patch: Record<string, unknown>) => { await api(path, { json: { action: 'update', ...patch } }); await reload(); };
  const guarded = async (work: () => Promise<void>) => { setNotice(''); try { await work(); } catch (e) { setNotice(errorText(e)); } };
  const latest = data.runs[0];
  const checks = checksFor(data.kind).filter(check => !check.needs || (check.needs === 'reference' ? data.reference : check.needs === 'rules' ? data.rules.length : true));
  const off = new Set(pendingOff ?? data.disable);
  const toggle = (id: string, on: boolean) => {
    const next = on ? [...off].filter(item => item !== id) : [...off, id];
    setPendingOff(next);
    void guarded(async () => { try { await update({ disable: next }); } finally { setPendingOff(null); } });
  };
  const phraseText = phrases ?? data.phrases.join(', ');

  return (
    <>
      <div className="topbar">
        <p className="crumbs"><a className="op-link" href={base}>{projectName}</a> <span aria-hidden="true">/</span> <span className="here">{data.name}</span></p>
        <UploadButton<{ runId: string }> action={`${path}/runs`} className="op-btn op-btn--sm" onDone={result => router.push(`${base}/runs/${result.runId}`)}><Icon.upload size={16} />Run a file</UploadButton>
      </div>
      <div className="content">
        <div className="page-head">
          <KindTile kind={data.kind} />
          <div className="page-title">
            <h1>{data.name}</h1>
            <p className="muted">{KIND_LABEL[data.kind]} test case with {data.rules.length} rule{data.rules.length === 1 ? '' : 's'}{data.reference ? ' and an approved reference' : ', no reference yet'}.</p>
          </div>
          {latest && <Stamp verdict={latest.verdict} animate />}
        </div>
        {notice && <p className="notice notice--error" role="alert">{notice}</p>}

        <div className="cols">
          <div className="col-main">
            <RulesEditor kind={data.kind} rules={data.rules} onSave={async (rules: Rule[]) => { await update({ rules }); }} />

            <section className="op-card panel" aria-labelledby="history-title">
              <div className="panel-head"><h2 id="history-title">Run history</h2></div>
              {data.runs.length === 0 && <div className="empty"><strong>Not run yet</strong><span>Choose “Run a file” to check a generated file against this test case.</span></div>}
              {data.runs.map(run => <RunRow key={run.id} run={run} href={`${base}/runs/${run.id}`} showDiff />)}
            </section>
          </div>

          <div className="col-side">
            <section className="op-card panel" aria-labelledby="reference-title">
              <div className="panel-head"><h2 id="reference-title">Reference file</h2></div>
              <div className="panel-body">
                {data.reference ? (
                  <div className="ref-file">
                    <KindTile kind={data.kind} small />
                    <div><strong>{data.reference.name}</strong><span className="tiny" style={{ fontSize: 12 }}>sha256 {data.reference.sha256.slice(0, 8)}, set {ago(data.reference.updatedAt)}</span></div>
                  </div>
                ) : <p className="muted" style={{ fontSize: 15 }}>No reference yet. Without one, the checks that compare with an approved file are skipped.</p>}
                <p className="muted" style={{ fontSize: 15 }}>{data.kind === 'xlsx' ? 'Each run compares sheets, column headers and formula cells with this file.' : data.kind === 'docx' ? 'Each run compares headings, tables, page setup, fonts and length with this file.' : 'Each run compares slide count, size, titles, fonts and layout with this file.'}</p>
                <span style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  <UploadButton<unknown> action={`${path}/reference`} className="op-ghost" busyText="Saving" onDone={() => void reload()}>{data.reference ? 'Replace reference' : 'Add a reference'}</UploadButton>
                  {data.reference && <button type="button" className="op-ghost op-ghost--danger" onClick={() => guarded(async () => { await api(path, { json: { action: 'clearReference' } }); await reload(); })}>Remove</button>}
                </span>
              </div>
            </section>

            <section className="op-card panel" aria-labelledby="checks-title">
              <div className="panel-head"><h2 id="checks-title">Checks</h2><span className="small muted">{checks.length - checks.filter(check => off.has(check.id)).length} of {checks.length} on</span></div>
              <div className="check-list">
                {checks.map(check => (
                  <label key={check.id} className="check-item" title={check.about}>
                    <span>{check.title}{check.label !== 'confirmed' && <span className="op-chip op-chip--visual">Visual</span>}</span>
                    <input className="op-switch" type="checkbox" checked={!off.has(check.id)} onChange={event => toggle(check.id, event.target.checked)} />
                  </label>
                ))}
              </div>
              <p className="panel-foot">A check that is turned off shows as skipped in the report, never as passed.</p>
            </section>

            {data.kind !== 'xlsx' && (
              <section className="op-card panel" aria-labelledby="phrases-title">
                <div className="panel-head"><h2 id="phrases-title">Your own leftover phrases</h2></div>
                <form className="panel-body" onSubmit={event => { event.preventDefault(); void guarded(async () => { await update({ phrases: phraseText.split(',').map(item => item.trim()).filter(Boolean) }); setPhrases(null); }); }}>
                  <label className="field">Phrases, separated by commas
                    <input className="op-input" value={phraseText} onChange={event => setPhrases(event.target.value)} placeholder="CLIENT_NAME, <<address>>" />
                    <span className="hint">Template markers, TODO notes and filler text are always caught. Add tags only your templates use.</span>
                  </label>
                  <button type="submit" className="op-ghost" style={{ alignSelf: 'flex-start' }} disabled={phrases === null}>Save phrases</button>
                </form>
              </section>
            )}

            <button type="button" className="op-ghost op-ghost--danger" style={{ alignSelf: 'flex-start' }} onClick={() => deleteDialog.current?.showModal()}><Icon.trash size={16} />Delete this test case</button>
          </div>
        </div>
      </div>

      <dialog ref={deleteDialog} className="sheet" aria-labelledby="delete-title">
        <div className="sheet-body">
          <h2 id="delete-title">Delete “{data.name}”?</h2>
          <p className="muted">Its rules, reference file and {data.runs.length} run{data.runs.length === 1 ? '' : 's'} are deleted with it. This cannot be undone.</p>
          <div className="sheet-actions">
            <button type="button" className="op-ghost" onClick={() => deleteDialog.current?.close()}>Keep it</button>
            <button type="button" className="op-btn op-btn--sm" onClick={() => guarded(async () => { await api(path, { json: { action: 'delete' } }); router.push(base); })}>Delete test case</button>
          </div>
        </div>
      </dialog>
    </>
  );
}
