'use client';

import { useParams } from 'next/navigation';
import RunRow from '@/components/RunRow';
import { PageState, useLoad, useShell } from '@/components/Shell';
import type { RunSummary } from '@/lib/types';

export default function Runs() {
  const { project } = useParams<{ project: string }>();
  const { projects } = useShell();
  const { data, error } = useLoad<{ runs: RunSummary[] }>(`/api/p/${project}/runs`);
  if (!data) return <PageState error={error} />;
  const name = projects.find(item => item.id === project)?.name ?? 'Project';
  return (
    <>
      <div className="topbar"><p className="crumbs"><a className="op-link" href={`/app/p/${project}`}>{name}</a> <span aria-hidden="true">/</span> <span className="here">Runs</span></p></div>
      <div className="content">
        <div className="page-head"><div className="page-title"><h1>Runs</h1><p className="muted">Every file checked in this project, newest first.</p></div></div>
        <section className="op-card panel" aria-label="Runs">
          {data.runs.length === 0 && <div className="empty"><strong>No runs yet</strong><span>Drop a file on the overview, or send one from your pipeline.</span><a className="op-ghost" href={`/app/p/${project}`}>Go to the overview</a></div>}
          {data.runs.map(run => <RunRow key={run.id} run={run} href={`/app/p/${project}/runs/${run.id}`} showCase />)}
        </section>
      </div>
    </>
  );
}
