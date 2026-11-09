# Integration guide

How to run OfficeProof Lab's checks where your files are generated: on a developer's machine, in a pipeline, and with results sent to the dashboard.

The same engine runs in all three places. A file, its reference and its rules always give the same confirmed findings.

## 1. The command-line tool

`dist/officeproof.cjs` is one file with no install step. It needs Node 20 or later.

```bash
# one file
node dist/officeproof.cjs check out/revenue-summary.xlsx

# with an approved reference and rules
node dist/officeproof.cjs check out/revenue-summary.xlsx \
  --reference refs/revenue-summary.reference.xlsx --rules rules.json

# every test case in a config, with reports written to a folder
node dist/officeproof.cjs check --config officeproof.json --out officeproof-reports

# list every check
node dist/officeproof.cjs checks        # or: checks xlsx | docx | pptx
```

Try it on the sample files in this repository: `npm run check:samples`.

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | No confirmed failure, and every `expect` in the config was met |
| 1 | A confirmed failure. Visual and AI-assisted findings never change the exit code |
| 2 | The command, the config or a file could not be read |

### Output

`--format text` (default), `json`, `markdown`, `junit` or `html` prints one format. `--out <folder>` also writes all four:

| File | Use |
| --- | --- |
| `report.json` | Every result, for your own tooling |
| `report.md` | A readable report |
| `report.junit.xml` | For test reporters. One test per check; skipped checks are marked skipped |
| `01-<test case>.html` | A self-contained report per file |

In GitHub Actions the Markdown report is also added to the job summary, with or without `--out`.

## 2. The config file

```json
{
  "project": "Month-end pack",
  "url": "https://your-dashboard.example",
  "cases": [
    {
      "name": "Revenue summary workbook",
      "file": "out/revenue-summary.xlsx",
      "reference": "refs/revenue-summary.reference.xlsx",
      "rules": [
        { "cell": "Summary!E14", "sumOf": "E4:E13" },
        { "cell": "Summary!B14", "equals": 1359 }
      ],
      "disable": ["XL-HARD-TOTAL"],
      "placeholders": ["ACME-DRAFT"],
      "expect": "pass"
    }
  ]
}
```

Paths are relative to the config file.

| Field | Meaning |
| --- | --- |
| `name` | The test case. Runs with the same name are compared with each other on the dashboard |
| `file` | The generated `.xlsx`, `.docx` or `.pptx`. The type is read from the file's content, not its name |
| `reference` | Optional. An approved example of the same type |
| `rules` | Optional. Expectations for this file (see below) |
| `disable` | Optional. Check ids to turn off for this test case. They are reported as skipped, never as passed |
| `placeholders` | Optional. Extra phrases to treat as leftover placeholders. Plain text, matched without regard to case |
| `expect` | Optional. `pass`, `warn` or `fail`. Without it, the case is met when there is no confirmed failure. `"expect": "fail"` is for files that must be caught, such as the seeded samples here |

## 3. Rules

Rules are confirmed checks: a rule that is not met is a confirmed failure. A rule that does not fit the file type is refused with a reason before anything runs.

Spreadsheets:

| Rule | Meaning |
| --- | --- |
| `{ "cell": "Summary!E14", "equals": 1359 }` | The cell's recalculated value equals this. Add `"tolerance": 0.01` for numbers |
| `{ "cell": "Summary!E14", "sumOf": "E4:E13" }` | The cell equals the sum of the range |
| `{ "cell": "Summary!G5", "between": [0, 1] }` | The cell is a number in this range |
| `{ "cell": "Summary!E14", "isFormula": true }` | The cell is a formula (or, with `false`, a typed value) |
| `{ "range": "Summary!A4:A13", "noBlanks": true }` | No empty cells |
| `{ "range": "Summary!B4:F13", "allNumbers": true }` | Every filled cell is a number |
| `{ "range": "Summary!A4:A13", "unique": true }` | No repeated values |
| `{ "headers": "Summary!A3:G3", "equal": ["Month", "Orders"] }` | The header cells read this, in order. Case is ignored |
| `{ "sheet": "Forecast" }` | A sheet with this name exists |

Documents and slides:

| Rule | Meaning |
| --- | --- |
| `{ "heading": "Summary" }` | A heading with this text exists (documents) |
| `{ "contains": "Payment is due within 30 days" }` | The text appears |
| `{ "notContains": "DRAFT" }` | The text does not appear |
| `{ "words": { "min": 150, "max": 600 } }` | Word count (documents) |
| `{ "tables": 1 }` or `{ "tables": { "min": 1 } }` | Number of tables (documents) |
| `{ "slides": 6 }` or `{ "slides": { "max": 12 } }` | Number of slides |
| `{ "slide": 1, "title": "Board update" }` | The title of a slide (slides are counted from 1) |

## 4. GitHub Actions

Add a step after the one that generates your files. A complete workflow is in [`docs/examples/officeproof.yml`](examples/officeproof.yml).

```yaml
- uses: 0xNexuz/officeprooflab@main
  with:
    config: officeproof.json
    url: ${{ vars.OFFICEPROOF_URL }}            # optional
    token: ${{ secrets.OFFICEPROOF_TOKEN }}     # optional
```

| Input | Default | Meaning |
| --- | --- | --- |
| `config` | `officeproof.json` | The list of test cases |
| `out` | `officeproof-reports` | Where the four report formats are written |
| `url` | none | Dashboard address |
| `token` | none | A project token, from a repository secret |

The step fails the job on a confirmed failure. With `url` and `token` both set, each run is also sent to the dashboard; without them the results stay in the job summary and the report files.

### Any other pipeline

Copy `dist/officeproof.cjs` into the pipeline (or check this repository out) and run it with Node 20 or later:

```bash
OFFICEPROOF_TOKEN=... node officeproof.cjs check --config officeproof.json \
  --out officeproof-reports --upload --url https://your-dashboard.example
```

Pass the token through the `OFFICEPROOF_TOKEN` environment variable, from your pipeline's secret store.

## 5. Sending runs to the dashboard

1. In the app, open **CI and tokens** and create a project token. It is shown once; only its hash is stored. Revoke it there at any time.
2. Save it as a secret named `OFFICEPROOF_TOKEN`.
3. Run with `--upload` (the Action does this when `url` and `token` are set).

What is sent, per test case: the report, the name of the test case, and the commit, branch and run link when the pipeline provides them. The file itself is sent when it is 3.5 MB or smaller, so it can be opened in Univer on the run's page.

What the dashboard does with it: a report from outside is treated as data. Every field is checked and trimmed, each finding takes its label and title from the dashboard's own catalog, and the verdict and counts are worked out again from the findings. A file is kept only if its SHA-256 matches the one in the report. A test case with that name is created the first time a run arrives.

The endpoint, if you want to call it yourself:

```
POST /api/ci/runs
Authorization: Bearer opl_…
Content-Type: multipart/form-data

meta   JSON: { "case": "Test case name", "result": <one result from report.json>, "ci": { "provider", "commit", "branch", "runUrl" } }
file   optional, the checked file
```

It answers `{ "runId", "seq", "url" }`. `401` means the token is missing, wrong or revoked; `429` means slow down (the command-line tool waits and tries again).

## 6. The three labels

| Label | What it is | Effect |
| --- | --- | --- |
| Confirmed | Deterministic test results: formulas recalculated with Univer, totals, placeholders, structure, rules, reference comparison | Decides the verdict and the exit code |
| Visual | Layout compared with the reference by where boxes sit, and an estimate of whether text fits its box. Not a rendering | Reported; never fails a run |
| AI-assisted | Optional notes from Ling 3.2 Flash on the file's text, each tied to a quote found in the file. Dashboard only | Reported; never fails a run |

Run `node dist/officeproof.cjs checks` for the full list with ids, labels and severities. A check that could not run is reported as skipped with its reason, and a formula Univer could not calculate is reported as not verified. Neither is counted as a pass.

## 7. Limits

| Limit | Value |
| --- | --- |
| File size | 4 MB |
| XML inside the file, once unpacked | 48 MB |
| Cells read per workbook | 400,000. A larger workbook is checked in part and reported as a warning (`XL-PARTIAL`), never as a pass |
| Recalculation time | 20 seconds on the command line, 15 on the dashboard. Formulas not finished in time are reported as not verified |
| Formats | `.xlsx`, `.docx`, `.pptx`. Not `.xls`, `.doc` or `.ppt`. Macros are never run and external links are never followed |
| Files kept per test case on the dashboard | The 10 newest. Older runs keep their report |

## 8. The engine as a library

`lib/engine` has no dependency on the app. It takes bytes and returns a result:

```ts
import { runChecks } from './lib/engine/index.ts';

const { result } = await runChecks({
  name: 'revenue-summary.xlsx',
  bytes,                                   // Uint8Array
  reference: { name: 'reference.xlsx', bytes: referenceBytes },
  options: { rules: [{ cell: 'Summary!E14', sumOf: 'E4:E13' }] },
});
result.verdict;    // 'pass' | 'warn' | 'fail'
result.findings;   // each with an id, a label and where it is
```

It is not yet published as a package.
