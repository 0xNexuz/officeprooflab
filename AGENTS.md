# OFFICEPROOF LAB: project instructions for coding agents

OfficeProof Lab tests AI-generated Office files (spreadsheets, documents, slides) before they reach customers, built on the Univer SDK.
Read `docs/PROPOSAL.md`, `docs/CLIENT_SCOPE.md` and `docs/BUILD_LEDGER.md` before any change.

## Non-negotiable rules
1. This is a Univer partnership project. Use the **real Univer SDK**: its formula engine for recalculation (headless in Node and in CI), and Univer Sheets, Docs and Slides for inspection. Verify behaviour against the exact installed version (1.3.1).
2. **Confirmed findings are deterministic.** The same file, reference and rules must always give the same confirmed findings. A check that guesses is not a confirmed check.
3. **Three labels, never mixed.** `confirmed` (deterministic test results), `visual` (layout comparison and estimates) and `ai` (Ling 3.2 Flash observations). Only confirmed failures change a run's verdict or the CI exit code. The UI, reports and API always show which label a finding has.
4. **Never report what was not checked as passed.** If the engine cannot verify something (an unsupported function, a recalculation that timed out), say so as "not verified".
5. Treat uploaded files as untrusted and private: check type by content, cap sizes (compressed and uncompressed), never execute macros or follow external links, never log file contents, and keep every query scoped to the caller's project.
6. Keep all `@univerjs/*` packages on exactly the same release (1.3.1). Only open-source Univer packages are used; check Pro rights before adding licensed features.
7. Never put Ant Ling API keys, CI tokens, database URLs or other secrets in the browser, Git, screenshots or replies. CI tokens are stored hashed.
8. **Ant Ling runs server-side for one job only:** optional quality observations on a file's text, each tied to a quote that must be found in the file. It never decides a verdict.
9. Do not claim features, integrations or deployments that have not been reproduced. Sample files are synthetic.
10. Submit PRs for review; do not merge or deploy without the owner's go-ahead. Commits are authored by the owner (0xNexuz); add no AI co-author lines.

## Journal
- Before coding, add the next `M-###` (milestone), `I-###` (issue) or `Q-###` (question) entry to `docs/BUILD_LEDGER.md` with date, request and expected outcome.
- After coding, record what changed, the commands run and their results, evidence paths and anything unresolved. Append; never rewrite history.

## Required checks
`npm test` → `npm run typecheck` → `npm run build` → `npm run build:cli && npm run check:samples` → a real browser run of the changed flow.
