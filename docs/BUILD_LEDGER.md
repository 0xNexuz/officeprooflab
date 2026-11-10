# OfficeProof Lab build ledger

Append-only record of milestones (M), issues (I) and questions (Q).

## M-001: Project start (9 November 2026)
- **Request (owner):** build OfficeProof Lab, the third Univer proposal, to match `docs/PROPOSAL.md`. Repository `0xNexuz/officeprooflab` created by the owner.
- **Expected outcome:** a working testing tool covering every proposal promise in `docs/CLIENT_SCOPE.md`, with reproducible sample test cases and integration documentation.
- **Verified before building (Univer 1.3.1, open-source packages only):**
  - The formula engine runs headless in Node (`@univerjs/core`, `engine-formula`, `sheets`, `sheets-formula`): a workbook with a stale stored total (99) recalculated to 30 in about 0.1 s; errors come back as `#DIV/0!` and `#N/A`.
  - Univer Slides (`@univerjs/slides`, `slides-ui`) renders a deck built from data, with thumbnails.
  - Univer has no open-source Office file import, so OfficeProof Lab reads `.xlsx`, `.docx` and `.pptx` itself.
- **Foundations reused from ClauseBridge (same owner):** account sessions, the SQLite/Postgres store adapter, the Ant Ling client, request limits.

## M-002: Check engine, samples and command-line tool (9 November 2026)
- **Built:** `lib/engine` (reads `.xlsx`, `.docx`, `.pptx` with fflate and fast-xml-parser; recalculates workbooks with Univer headless; 56 checks in `catalog.ts`; rules; reference comparison; visual-label layout score and fit estimate; Markdown, HTML, JUnit and JSON reports; run-to-run diff by stable finding ids). `samples/generate.mjs` writes three synthetic files with seeded defects, their fixed versions and their references. `cli/officeproof.ts` is bundled to `dist/officeproof.cjs`.
- **Verified:** `npm test` (40 tests pass). `npm run check:samples`: the three seeded files fail with the expected findings, the three fixed files pass with none, exit code 0 because every `expect` is met. The bundled tool also ran on Node 20.20.

## M-003: The app (9 November 2026)
- **Request (owner):** "finish building the main app, test if it works, audit fix and then push to github", in the design approved the same day.
- **Built:** accounts and sessions, projects, test cases (reference, rules, check switches, extra placeholder phrases), runs from the browser and from a pipeline, the run report with the three labels, inspection in Univer Sheets, Docs and Slides, "try a fix" in the sheet view, exports, project tokens, the CI page, the landing page. `action.yml`, a workflow for this repository and `docs/examples/officeproof.yml`. `docs/INTEGRATION.md` and the README.
- **Verified in a real browser (Playwright, production build, local SQLite):** sign-up and sign-in; project rename; new test case; reference upload; a rule added through the form; a rule of the wrong type refused with its reason; a run of the seeded workbook (FAIL, flagged cells shown in Univer Sheets, clicking a finding selects its cell); editing E14 in the sheet and rerunning ("2 fixed, 5 still there, 0 new"); rerun with the fixed file (PASS, "8 fixed"); all four exports; the document run in Univer Docs; the deck run in Univer Slides with the reference boxes; token creation; six runs sent by the command-line tool with a project token and shown on the overview and CI pages; phone-width layouts of the overview, run, runs and CI pages with no sideways scroll. No console, page or HTTP errors with the security headers on.
- **Verified against Postgres 16 (local):** `npm run test:postgres` (schema created once under concurrent start, isolation, file kept byte for byte, six simultaneous runs numbered 3 to 8, tokens). The built app pointed at Postgres: sign-up, a file upload and the overview all worked.
- **Not verified:** AI-assisted observations against the live Ling 3.2 Flash service. The request, the grounding of quotes and the failure states are tested with a stand-in server only. The GitHub Action has not yet run on GitHub. Nothing is deployed.

## I-001: Univer Slides 1.3.1 behaviour found while building the deck view
- Shapes are drawn only when `shapeType` is lowercase (`'rect'`).
- Text elements are drawn 50 pt in from the element's left and top and wrap 50 pt short of its right edge, whatever the document margins. The view compensates by placing each text element 50 pt up and left and making it 100 pt wider and taller (`TEXT_INSET` in `lib/univer-slides.ts`).
- The plain-text path shows one paragraph only; multi-line text needs a rich document with one paragraph per line.
- The slide is centred once, at first paint. After resizing, the view centres it again through the render manager.
- Univer's "Append Slide" control is hidden with CSS, since the deck is shown for inspection only.

## I-002: Univer Sheets 1.3.1 shows stored values for formula cells
- On load the sheet view keeps each formula's stored value and does not recalculate. That is what the inspection view needs (it shows what is in the file). "Run checks on my edits" forces a calculation and waits for it to end before reading the workbook back.

## I-003: Audit findings and fixes (9 November 2026)
- **Memory:** a 4 MB workbook that unpacks to 34 MB of sheet XML took about 1.7 GB to read. Worksheet rows and shared strings are now read one element at a time (`scan` in `zip.ts`); the same file now takes about 0.5 GB and 2 s. Unpacked XML is capped at 48 MB per file and any part read as a whole tree at 8 MB. A crafted archive whose header understates a part's size was tested: the part is cut at the stated size, so the cap holds.
- **Partly read workbooks:** more than 400,000 filled cells used to produce a note on a passing run. It is now a confirmed warning (`XL-PARTIAL`), so a partly checked workbook is never a pass.
- **Pipeline uploads refused:** the upload endpoint enforced a pause between requests, so the second of six sequential uploads got "Too many requests". The pause is removed (hourly caps stay) and the command-line tool retries on 429.
- **Same-origin check:** behind `next start -H 127.0.0.1` the request URL's origin is `localhost`, so every write was refused. The check now compares the Origin header's host with the Host header.
- **Large grids in the browser:** a workbook with more than 100,000 filled cells is not opened in the sheet view; the report is complete without it.
- **Headers:** Content-Security-Policy (same origin only), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, HSTS. Exported reports are served as attachments with a sandbox policy.
- **Already in place and tested:** file type by content, 4 MB upload cap, no DOCTYPE, plain-text placeholder phrases (no user-supplied patterns), tokens stored as SHA-256, every query scoped to the caller's project (tested with a second account), a pipeline report rebuilt server-side so it cannot claim a verdict its findings do not support, at most two files checked at once per server instance.

## Q-001: Licence
- The proposal promises a public repository and a possible open-source Univer integration. No licence file has been added; the choice is the owner's.

## M-004: First run on GitHub and the Vercel project (9 November 2026)
- **Pull request:** #1, `build/officeproof-v1` into `main`. Not merged.
- **GitHub Action verified on GitHub:** the CI workflow ran on the pull request and every step passed: `npm ci`, `npm test`, `npm run typecheck`, `npm run build`, `npm run build:cli`, then the Action itself (`uses: ./`) on `samples/officeproof.json`, and the report upload. This replaces the "has not yet run on GitHub" note in M-003.
- **Vercel (owner's request: "create the vercel"):** project `officeprooflab` created and linked to the repository. The first deployment was built from `build/officeproof-v1` (commit ce68df1); as the first deployment of a new project, Vercel made it the production deployment. The build passed. The landing page was fetched from `https://officeprooflab.vercel.app` and returned 200 with the security headers.
- **Not yet working when hosted:** accounts, uploads and saved runs, because no `DATABASE_URL` is set on the project. The owner adds it (and, optionally, `ANT_LING_API_KEY`); no secret was set by the build agent. Sign-up on the hosted app has therefore not been exercised.

## M-005: Merged, hosted and checked on the live site (10 November 2026)
- **Request (owner):** "check everything", after merging pull request #1 and adding a database and the Ling key on Vercel.
- **State found:** pull request #1 merged (f852a86); CI passed on `main`; the production deployment is built from `main`; `DATABASE_URL` (Neon Postgres) and `ANT_LING_API_KEY` are set on the Vercel project by the owner. The landing and sign-in pages return 200 with the security headers. No runtime errors are logged.
- **Live run, by the owner:** the build agent does not create accounts on a production site, so the owner created an account on `officeprooflab.vercel.app`, uploaded the three files in `samples/generated/` and exported each report as JSON. The exports match local runs: the file hashes are the samples', and the findings are the same (workbook: 4 failures, 2 warnings, 1 note, 27 formulas recalculated in 165 ms; letter: 5 failures, 1 warning; deck: 2 failures, 2 warnings, 1 visual). This closes "accounts and runs on the hosted deployment" from M-004.
- **Live Ling 3.2 Flash:** asked on the deck run, it returned 6 observations, each with a quote found on the slides. One repeats a confirmed finding (the `{{growth_rate}}` placeholder). One is a useful question (an October pack that says the margin widened in September). Four are judgement calls on wording, and one of those reasons wrongly (it says October cannot be the largest month in a ten-month total). This closes "AI-assisted observations against the live service" from M-003, for one file. Whether Ling was asked on the letter and the workbook is not recorded in the exports.
- **Still open:** the licence (Q-001).

## I-004: Rule wording
- A rule for exactly one table read "The document has exactly 1 tables". The noun now follows the last number named ("exactly 1 table", "at least 1 slide", "at most 3 tables"). `npm test` (41 pass), `npm run typecheck`, `npm run build`, `npm run build:cli && npm run check:samples`.
