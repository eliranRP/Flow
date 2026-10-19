<a id="flow-929"></a>
# FLOW-929 · Cross-company sweep: every client function, called as another company
- **Type:** SMALL CYCLE · **Status:** in-progress · **Depends on:** #735 (decision 0193), #732 (mcp_undo company fix) · **Source:** Owner request 2026-10-19: one broad test that, on every PR, calls every client-executable function as another company's user and proves nothing leaks or changes across companies.
- **Files:** `supabase/tests/database/cross_company_sweep.test.sql`, `CONTRIBUTING.md`.
- [x] pgTAP: seed company A (projects, categories, lines, splits, allocations, loans, recurring, forecast edits, invites, members, connector rows, Jev rows, a flow-mcp token and writes, and writes B left in A from an old seat) and company B.
- [x] Sweep every function in `public` that `authenticated` can execute, read from the catalog, as B's owner (B active, then A's id as the company header) and as A's viewer, with arguments filled by type and name from A's ids. Each call rolls back; A's rows are fingerprinted before the rollback.
- [x] Assert: no call changes any of A's tables (one assertion per table), B gets back none of A's ids, text or figures and finds none copied into its own rows, every function is called, and every allowlist entry exists and is still needed. Positive controls prove both detectors fire.
- [x] CONTRIBUTING, Database privileges: what the sweep checks and how its allowlists work.
