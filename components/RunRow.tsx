import { ago } from '@/lib/api';
import { runNumber, type RunSummary } from '@/lib/types';
import { DiffChips, RunChips, Stamp } from './Bits';

export const sourceText = (run: RunSummary) => run.source === 'ci' ? `from CI${run.ci?.branch ? ` on ${run.ci.branch}` : ''}${run.ci?.commit ? ` at ${run.ci.commit.slice(0, 7)}` : ''}` : 'uploaded';

/** One run in a list. `showCase` adds the test case's name; `showDiff` shows what changed since the run before. */
export default function RunRow({ run, href, showCase = false, showDiff = false }: { run: RunSummary; href: string; showCase?: boolean; showDiff?: boolean }) {
  return (
    <a className="op-row" href={href} style={{ flexWrap: 'wrap' }}>
      <Stamp verdict={run.verdict} small />
      <span className="row-main" style={{ flexBasis: showCase ? 210 : 150, flexGrow: showCase ? 1 : 0 }}>
        {showCase && <span className="row-title" style={{ fontSize: 15 }}>{run.caseName}</span>}
        <span className="mono" style={{ fontSize: 14, fontWeight: 700 }}>{runNumber(run.seq)}</span>
        <span className="tiny" style={{ fontSize: 12 }}>{ago(run.createdAt)}, {sourceText(run)}</span>
      </span>
      <span className="row-chips">{showDiff ? <DiffChips diff={run.diff} /> : <RunChips run={run} />}</span>
    </a>
  );
}
