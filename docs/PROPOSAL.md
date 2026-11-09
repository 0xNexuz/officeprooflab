# OfficeProof Lab: the proposal

The text below is the proposal as submitted to Univer, unchanged. `docs/CLIENT_SCOPE.md` maps each line to the feature that meets it.

## OfficeProof Lab App Proposal  -  By 0xNexuz

Testing and verification tools for AI-generated Office files built with Univer

I propose building OfficeProof Lab, a developer-focused application that helps teams test AI-generated spreadsheets, documents and presentations before they reach customers.

### The problem

AI agents can produce Office files that look convincing but contain broken formulas, inconsistent totals, missing content or layout errors. Developers need a repeatable way to inspect these outputs rather than relying on manual spot checks.

### The product

Developers would upload generated Office files or connect a document-generation workflow. OfficeProof Lab would create a readable test report where users can:

- Check spreadsheet formulas, expected totals and missing or inconsistent data.
- Compare generated documents and slides against approved reference examples.
- Inspect flagged cells, pages or slides and rerun tests after a fix.
- Export a verification report and run core checks automatically in CI.

The initial release would concentrate on deterministic, reproducible checks. Visual comparison and AI-assisted quality findings would be labelled separately from confirmed test failures.

### Who would use it

The initial users would be AI-agent builders, SaaS teams, document-automation developers and QA engineers who generate Office files at scale.

### How Univer fits

Univer would provide the Office content engine: its Sheets APIs and formula capabilities for workbook inspection, and its document and slide rendering/editing components for review. Where licensed and supported, headless SDK operations could run tests without opening the full editor. OfficeProof Lab would add test cases, comparison rules, CI integrations and a developer-facing results dashboard, complementing rather than duplicating Univer’s existing verification features.

### Proposed collaboration

For a collaboration, I would deliver a working testing tool, a public GitHub repository, reproducible sample test cases, integration documentation, and updates on X. Part of the toolkit could be published as a reusable open-source Univer integration.
