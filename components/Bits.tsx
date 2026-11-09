// Small shared pieces: icons, the brand, verdict stamps, file-kind tiles and the chips that summarise a run.
import type { FileKind, Finding, Verdict } from '@/lib/engine/types';
import type { DiffCounts, RunSummary } from '@/lib/types';

type IconProps = { size?: number };
const svg = (path: React.ReactNode, linejoin = true) => function Icon({ size = 18 }: IconProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin={linejoin ? 'round' : undefined} aria-hidden="true">{path}</svg>;
};
export const Icon = {
  arrow: svg(<><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></>),
  plus: svg(<path d="M12 5v14M5 12h14" />),
  upload: svg(<path d="M12 16V5M7 9.5l5-5 5 5M5 19.5h14" />),
  download: svg(<path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14" />),
  rerun: svg(<path d="M20 12a8 8 0 1 1-2.6-5.9M20 4.5v4h-4" />),
  grid: svg(<><rect x="3.5" y="3.5" width="7" height="7" /><rect x="13.5" y="3.5" width="7" height="7" /><rect x="3.5" y="13.5" width="7" height="7" /><rect x="13.5" y="13.5" width="7" height="7" /></>),
  play: svg(<path d="M7 4.5l12 7.5-12 7.5z" />),
  branch: svg(<><circle cx="6.5" cy="6" r="2.5" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="8" r="2.5" /><path d="M6.5 8.5v7M17.5 10.5c0 4-5 3-9.5 5" /></>),
  check: svg(<path d="M4 12.5l5 5L20 6.5" />),
  chevron: svg(<path d="M7 10l5 5 5-5" />),
  trash: svg(<path d="M5 7h14M10 7V4.5h4V7M7 7l1 12.5h8L17 7M10 11v5M14 11v5" />),
  spark: svg(<path d="M12 3.5l1.9 5.6 5.6 1.9-5.6 1.9L12 18.5l-1.9-5.6L4.5 11l5.6-1.9z" />),
};

export function Brand({ href = '/' }: { href?: string }) {
  return (
    <a className="brand" href={href}>
      <img className="op-sniff" src="/art/mark.png" alt="" width={58} height={50} />
      <span className="brand-name">OfficeProof</span>
      <span className="brand-lab">LAB</span>
    </a>
  );
}

export function Stamp({ verdict, small = false, animate = false }: { verdict: Verdict; small?: boolean; animate?: boolean }) {
  return <span className={`op-stamp op-stamp--${verdict}${small ? ' op-stamp--sm' : ''}${animate ? ' op-stamp--in' : ''}`}>{verdict.toUpperCase()}</span>;
}

const GLYPH: Record<FileKind, React.ReactNode> = {
  xlsx: <><rect x="3.5" y="3.5" width="17" height="17" /><path d="M3.5 9.5h17M3.5 14.5h17M9.5 3.5v17" /></>,
  docx: <path d="M5 6h14M5 10.5h14M5 15h14M5 19.5h8" strokeLinecap="round" />,
  pptx: <><rect x="2.5" y="5" width="19" height="14" /><path d="M7.5 15.5v-3M12 15.5v-6M16.5 15.5v-4.5" strokeLinecap="round" /></>,
};
const TILE: Record<FileKind, string> = { xlsx: 'sheet', docx: 'doc', pptx: 'slide' };
export function KindTile({ kind, small = false }: { kind: FileKind; small?: boolean }) {
  return (
    <span className={`op-tile op-tile--${TILE[kind]}${small ? ' op-tile--sm' : ''}`}>
      <svg width={small ? 18 : 24} height={small ? 18 : 24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" aria-hidden="true">{GLYPH[kind]}</svg>
    </span>
  );
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** What a run found, in chips. "No findings" is only said when nothing at all was reported. */
export function RunChips({ run }: { run: Pick<RunSummary, 'summary' | 'aiCount'> }) {
  const s = run.summary;
  const nothing = !s.fail && !s.warn && !s.info && !s.visual && !run.aiCount;
  return (
    <span className="chips">
      {s.fail > 0 && <span className="op-chip op-chip--fail">{plural(s.fail, 'failure')}</span>}
      {s.warn > 0 && <span className="op-chip op-chip--warn">{plural(s.warn, 'warning')}</span>}
      {s.info > 0 && <span className="op-chip op-chip--info">{plural(s.info, 'note')}</span>}
      {s.visual > 0 && <span className="op-chip op-chip--visual">{s.visual} visual</span>}
      {run.aiCount > 0 && <span className="op-chip op-chip--ai">{run.aiCount} AI-assisted</span>}
      {nothing && <span className="op-chip op-chip--pass">No findings</span>}
      {s.checksSkipped > 0 && <span className="op-chip op-chip--skip">{s.checksSkipped} skipped</span>}
    </span>
  );
}

export function DiffChips({ diff }: { diff: DiffCounts | null }) {
  if (!diff) return <span className="chips"><span className="op-chip op-chip--info">First run</span></span>;
  return (
    <span className="chips">
      <span className={`op-chip ${diff.fixed ? 'op-chip--pass' : 'op-chip--info'}`}>{diff.fixed} fixed</span>
      <span className={`op-chip ${diff.stillFailing ? 'op-chip--fail' : 'op-chip--info'}`}>{diff.still} still there</span>
      <span className={`op-chip ${diff.newFailures ? 'op-chip--fail' : diff.added ? 'op-chip--warn' : 'op-chip--info'}`}>{diff.added} new</span>
    </span>
  );
}

/** The chip in front of one finding: its severity for confirmed findings, its label otherwise. */
export function FindingChip({ finding }: { finding: Finding }) {
  if (finding.label === 'ai') return <span className="op-chip op-chip--ai">Note</span>;
  if (finding.label === 'visual') return <span className="op-chip op-chip--visual">{finding.check === 'PPT-VIS-LAYOUT' ? finding.actual ?? 'Layout' : 'Fit'}</span>;
  if (finding.check.endsWith('NOT-VERIFIED')) return <span className="op-chip op-chip--skip">Unchecked</span>;
  return <span className={`op-chip op-chip--${finding.severity}`}>{finding.severity === 'fail' ? 'Fail' : finding.severity === 'warn' ? 'Warn' : 'Note'}</span>;
}
