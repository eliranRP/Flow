# Flow QA data

[`seed-flow-qa.sql`](seed-flow-qa.sql) keeps the Flow QA sandbox company ([QA user](../../docs/runbooks/qa-user.md)) at least twice as large as the largest real company, so the daily load timings measure a full payload (FLOW-977).

- **What it does.** For each company-scoped table a screen reads, it counts the rows of every other real company (`count(*)` only; of other companies it reads just the name, owner and demo flag on `companies`), takes the largest, and adds synthetic rows to Flow QA until Flow QA has twice that. Lines, allocations, overhead, loans with monthly payments split into interest, escrow and principal, line splits, review rows, notes, files, forecast edits and recurring settings are all built. Legs come from the ledger triggers.
- **How to run it.** Through the owner's Supabase connector (`execute_sql` with the whole file). It is not a migration and never runs on deploy or in CI. It returns one row per table: the reference count, the target, the count before and after, and `ok`.
- **Safe to run again.** It adds only the shortfall, so a run with unchanged counts adds nothing. A seeded row that was deleted is built again with the same id. The perf steward runs it before each daily measurement.
- **Guards.** The runbook's seed rules: it stops unless exactly one company is named `Flow QA`, is not a demo and is owned by the QA login, and every insert names that company. Loan and line splits go through `save_loan_split` and `save_line_split` as the QA login; every other insert passes the tables' checks and triggers.
- **What marks a synthetic row.** Lines: `source` manual, an idempotency key starting `qa-seed:`, `provider_meta.qa_seed`. Other rows: an id of `md5(company:table:n)` (see `pg_temp.qa_id`) and names starting `QA `. mercury-sync and sumit-sync read and write only their own source's lines, by external id, so they never touch these.
- **Files.** Seeded `transaction_files` rows are metadata only: no object is stored at their path, so opening one fails to download.
- **Jev.** Open synthetic review rows get a suggestion from Flow QA's newest Jev model, so Jev does not spend calls on them.
- **Settings.** `set qa_seed.factor = 3;` changes the multiple; `set qa_seed.floors = '{"transactions": 5000}';` sets a minimum per table.

Check after a run, as the QA login: every project row of `get_dashboard()` has `profit_minor = income_minor - direct_minor - shared_minor`, and the totals have `net_profit_minor = income_minor - expense_minor`.
