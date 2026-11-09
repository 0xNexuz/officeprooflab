// The OfficeProof Lab check engine: a reusable Univer integration with no app, server or browser dependencies.
export * from './types.ts';
export { CATALOG, CHECKS, checksFor, type CheckInfo } from './catalog.ts';
export { runChecks, evaluate, readModel, sha256Hex, verdictOf, summarise, MAX_FILE_BYTES, KIND_NAME, type RunInput, type RunOutput } from './run.ts';
export { recalculate, toUniverData, type Recalculation } from './recalc.ts';
export { validateRules, describeRule } from './rules.ts';
export { compareRuns, diffCounts, type RunDiff } from './diff.ts';
export { toMarkdown, toHtml, toJUnit, summaryLine, LABEL_NAME, LABEL_NOTE } from './report.ts';
export { whereText, whereKey } from './collect.ts';
export { scanText } from './text.ts';
export { layoutScore } from './reference.ts';
export { fitEstimate } from './checks-pptx.ts';
