'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { Icon } from '@/components/Bits';
import RunRow from '@/components/RunRow';
import { PageState, useLoad, useShell } from '@/components/Shell';
import { ago, api, errorText } from '@/lib/api';
import type { RunSummary, TokenInfo } from '@/lib/types';

const REPO = 'https://github.com/0xNexuz/officeprooflab';

export default function CiAndTokens() {
  const { project } = useParams<{ project: string }>();
  const { projects } = useShell();
  const tokens = useLoad<{ tokens: TokenInfo[] }>(`/api/p/${project}/tokens`);
  const runs = useLoad<{ runs: RunSummary[] }>(`/api/p/${project}/runs`);
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [created, setCreated] = useState('');
  const [copied, setCopied] = useState(false);
  const [formError, setFormError] = useState('');
  const [origin, setOrigin] = useState('https://your-dashboard.example');
  useEffect(() => { setOrigin(window.location.origin); }, []);
  if (!tokens.data || !runs.data) return <PageState error={tokens.error || runs.error} />;

  const projectName = projects.find(item => item.id === project)?.name ?? 'Project';
  const ciRuns = runs.data.runs.filter(run => run.source === 'ci').slice(0, 6);
  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setFormError('');
    try { const result = await api<{ token: string }>(`/api/p/${project}/tokens`, { json: { action: 'create', name } }); setCreated(result.token); setCopied(false); setName(''); await tokens.reload(); }
    catch (e) { setFormError(errorText(e)); }
  };
  const revoke = async (id: string) => { try { await api(`/api/p/${project}/tokens`, { json: { action: 'revoke', tokenId: id } }); await tokens.reload(); } catch (e) { setFormError(errorText(e)); } };
  const close = () => { dialog.current?.close(); setCreated(''); setFormError(''); };

  return (
    <>
      <div className="topbar"><p className="crumbs"><a className="op-link" href={`/app/p/${project}`}>{projectName}</a> <span aria-hidden="true">/</span> <span className="here">CI and tokens</span></p></div>
      <div className="content">
        <div className="page-head"><div className="page-title" style={{ maxWidth: 720 }}>
          <h1>CI and tokens</h1>
          <p className="muted">Run the same checks on every pull request. The build fails only on a confirmed failure, and each run is sent here.</p>
        </div></div>

        <div className="cols">
          <section className="op-card panel col-main" aria-labelledby="setup-title" style={{ gap: 0 }}>
            <div className="panel-head"><h2 id="setup-title">Set it up</h2><a className="op-link small" href={`${REPO}/blob/main/docs/INTEGRATION.md`} style={{ fontWeight: 600 }}>Full guide</a></div>
            <ol className="setup">
              <li><span className="pixel-num">1</span><div>
                <h3>List your test cases in officeproof.json</h3>
                <pre className="op-code">{'{\n  '}<span className="k">&quot;cases&quot;</span>{': [\n    { '}<span className="k">&quot;name&quot;</span>: <span className="s">&quot;Revenue summary workbook&quot;</span>{',\n      '}<span className="k">&quot;file&quot;</span>: <span className="s">&quot;out/revenue-summary.xlsx&quot;</span>{',\n      '}<span className="k">&quot;reference&quot;</span>: <span className="s">&quot;refs/revenue-summary.reference.xlsx&quot;</span>{',\n      '}<span className="k">&quot;rules&quot;</span>{': [{ '}<span className="k">&quot;cell&quot;</span>: <span className="s">&quot;Summary!E14&quot;</span>, <span className="k">&quot;sumOf&quot;</span>: <span className="s">&quot;E4:E13&quot;</span>{' }] }\n  ]\n}'}</pre>
                <p className="small muted">A test case with the same name is created here the first time a run arrives.</p>
              </div></li>
              <li><span className="pixel-num">2</span><div>
                <h3>Save a project token as a repository secret</h3>
                <p className="muted" style={{ fontSize: 15 }}>Create a token on the right and store it as <code className="code-pill">OFFICEPROOF_TOKEN</code>. Without a token the checks still run, and the results stay in the build log.</p>
              </div></li>
              <li><span className="pixel-num">3</span><div>
                <h3>Add the step to your workflow</h3>
                <pre className="op-code"><span className="c"># after the step that generates your files</span>{'\n'}- <span className="k">uses</span>: 0xNexuz/officeprooflab@main{'\n'}  <span className="k">with</span>:{'\n'}    <span className="k">config</span>: officeproof.json{'\n'}    <span className="k">url</span>: {origin}{'\n'}    <span className="k">token</span>: <span className="s">{'${{ secrets.OFFICEPROOF_TOKEN }}'}</span></pre>
                <p className="small muted">Or run the command-line tool anywhere Node 20 or later is installed: <code className="code-pill">node dist/officeproof.cjs check --config officeproof.json --upload</code></p>
              </div></li>
            </ol>
          </section>

          <div className="col-side">
            <section className="op-card panel" aria-labelledby="tokens-title">
              <div className="panel-head"><h2 id="tokens-title">Project tokens</h2><button type="button" className="op-btn op-btn--sm op-btn--ink" onClick={() => dialog.current?.showModal()}><Icon.plus size={16} />New token</button></div>
              {tokens.data.tokens.length === 0 && <div className="empty"><span>No tokens yet. A token lets a pipeline send runs to this project, and nothing else.</span></div>}
              {tokens.data.tokens.map(token => (
                <div key={token.id} className={`token-row${token.revokedAt ? ' is-revoked' : ''}`}>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                    <span className="mono" style={{ fontSize: 14, fontWeight: 700, overflowWrap: 'anywhere' }}>{token.name} <span className="tiny" style={{ fontWeight: 400 }}>ends {token.hint}</span></span>
                    <span className="small muted">{token.revokedAt ? `Revoked ${ago(token.revokedAt)}.` : `Created ${ago(token.createdAt)}. ${token.lastUsedAt ? `Last used ${ago(token.lastUsedAt)}.` : 'Never used.'}`}</span>
                  </span>
                  {!token.revokedAt && <button type="button" className="op-ghost op-ghost--danger" onClick={() => void revoke(token.id)}>Revoke</button>}
                </div>
              ))}
              <p className="panel-foot">A token is shown once, when you create it. Only its hash is stored.</p>
            </section>

            <section className="op-card panel" aria-labelledby="ciruns-title">
              <div className="panel-head"><h2 id="ciruns-title">Recent CI runs</h2></div>
              {ciRuns.length === 0 && <div className="empty"><span>Runs sent by a pipeline appear here.</span></div>}
              {ciRuns.map(run => <RunRow key={run.id} run={run} href={`/app/p/${project}/runs/${run.id}`} showCase />)}
            </section>

            <section className="op-card panel" aria-labelledby="formats-title">
              <div className="panel-body">
                <h2 id="formats-title" style={{ fontSize: 18, fontWeight: 800 }}>Report formats</h2>
                <span className="chips"><span className="op-chip">JSON</span><span className="op-chip">Markdown</span><span className="op-chip">JUnit</span><span className="op-chip">HTML</span></span>
                <span className="small muted">Add <code className="code-pill">--out reports</code> to write all four from the command line.</span>
              </div>
            </section>
          </div>
        </div>
      </div>

      <dialog ref={dialog} className="sheet" aria-labelledby="token-title" onClose={() => { setCreated(''); setFormError(''); }}>
        {created ? (
          <div className="sheet-body">
            <h2 id="token-title">Copy your token now</h2>
            <p className="muted">It will not be shown again. Store it as the secret <code className="code-pill">OFFICEPROOF_TOKEN</code>.</p>
            <div className="token-once" data-token>{created}</div>
            <div className="sheet-actions">
              <button type="button" className="op-ghost" onClick={() => { void navigator.clipboard?.writeText(created).then(() => setCopied(true)).catch(() => {}); }}>{copied ? 'Copied' : 'Copy token'}</button>
              <button type="button" className="op-btn op-btn--sm op-btn--ink" onClick={close}>Done</button>
            </div>
          </div>
        ) : (
          <form className="sheet-body" onSubmit={create}>
            <h2 id="token-title">New project token</h2>
            <label className="field">Name<input className="op-input" value={name} onChange={event => setName(event.target.value)} required maxLength={60} placeholder="github-actions" /><span className="hint">Name it after where it will be used, so you know which one to revoke.</span></label>
            {formError && <p className="notice notice--error" role="alert">{formError}</p>}
            <div className="sheet-actions">
              <button type="button" className="op-ghost" onClick={close}>Cancel</button>
              <button type="submit" className="op-btn op-btn--sm op-btn--ink">Create token</button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
