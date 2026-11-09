// Compares two runs of the same test case by finding id: what was fixed, what is still there and what is new.
import type { Finding } from './types.ts';

export type RunDiff = { fixed: Finding[]; still: Finding[]; added: Finding[] };

/** AI-assisted observations are left out: they are not deterministic, so "fixed" would mean nothing. */
export function compareRuns(previous: Finding[], next: Finding[]): RunDiff {
  const stable = (list: Finding[]) => list.filter(finding => finding.label !== 'ai');
  const before = new Map(stable(previous).map(finding => [finding.id, finding]));
  const after = new Map(stable(next).map(finding => [finding.id, finding]));
  return {
    fixed: [...before.values()].filter(finding => !after.has(finding.id)),
    still: [...after.values()].filter(finding => before.has(finding.id)),
    added: [...after.values()].filter(finding => !before.has(finding.id)),
  };
}

export function diffCounts(diff: RunDiff) {
  const failing = (list: Finding[]) => list.filter(finding => finding.label === 'confirmed' && finding.severity === 'fail').length;
  return { fixed: diff.fixed.length, still: diff.still.length, added: diff.added.length, fixedFailures: failing(diff.fixed), stillFailing: failing(diff.still), newFailures: failing(diff.added) };
}
