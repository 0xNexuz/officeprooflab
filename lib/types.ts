// Shapes shared by the server and the browser.
import type { FileKind, Finding, Label, Rule, RunResult, Verdict } from './engine/types.ts';

export type CiInfo = { provider: string; commit: string; branch: string; runUrl: string };
export type DiffCounts = { fixed: number; still: number; added: number; fixedFailures: number; stillFailing: number; newFailures: number };

export type RunSummary = {
  id: string; seq: number; caseId: string; caseName: string; kind: FileKind; fileName: string;
  verdict: Verdict; summary: RunResult['summary'];
  source: 'upload' | 'ci'; ci: CiInfo | null; createdAt: string;
  /** Compared with the run before it on the same test case; null for a first run. */
  diff: DiffCounts | null; previousSeq: number | null;
  aiCount: number;
};
export type CaseSummary = { id: string; name: string; kind: FileKind; hasReference: boolean; ruleCount: number; lastRun: RunSummary | null };
export type ProjectSummary = { id: string; name: string; caseCount: number; createdAt: string };
export type Overview = { project: ProjectSummary; cases: CaseSummary[]; recent: RunSummary[] };
export type ReferenceInfo = { name: string; sha256: string; size: number; updatedAt: string };
export type CaseDetail = { id: string; name: string; kind: FileKind; rules: Rule[]; disable: string[]; phrases: string[];
  reference: ReferenceInfo | null; runs: RunSummary[]; createdAt: string };

export type AiResult = { model: string; ranAt: string; ranBy: string; findings: Finding[]; dropped: number; tokens: number | null };
export type RunDetail = {
  run: RunSummary & { fileSha256: string; fileSize: number; hasFile: boolean };
  result: RunResult;
  diff: { fixed: Finding[]; still: string[]; added: string[] } | null;
  ai: AiResult | null;
  testCase: { id: string; name: string; kind: FileKind; hasReference: boolean; rules: Rule[]; disable: string[]; phrases: string[] };
};
export type TokenInfo = { id: string; name: string; hint: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null };

export const KIND_LABEL: Record<FileKind, string> = { xlsx: 'Spreadsheet', docx: 'Document', pptx: 'Slides' };
export const LABELS: Label[] = ['confirmed', 'visual', 'ai'];
export const runNumber = (seq: number) => `R-${String(seq).padStart(4, '0')}`;
