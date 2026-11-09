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
