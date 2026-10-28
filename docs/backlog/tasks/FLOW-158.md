<a id="flow-158"></a>
# FLOW-158 · The part writers hold their accounts in id order too
- **Type:** BACKLOG NIT · **Status:** ready · **Source:** reviewer of #851, round 1 (S3).
- **Files:** a new migration patching `private.set_line_parts` and `private.set_loan_parts`; `supabase/tests/database/chart_of_accounts.test.sql`.

FLOW-154 made `book_line` and `create_journal_entry` hold their accounts (and each kept-out category's target) in id order before they write, as `merge_account` does. `private.set_line_parts` and `private.set_loan_parts` also insert legs that name accounts (a part's category account, and through posting its kept-out target), with no such pre-lock, so a split saved at the same moment as a merge on the same accounts can still deadlock; Postgres breaks it and the write answers "retry", nothing is written wrong.

- [ ] Both writers hold the accounts their parts name, and those categories' kept-out targets, `for share` in id order before they delete or insert legs.
- [ ] pgTAP pins it, as FLOW-154's assertions do.

**Acceptance:** pgTAP; the split and loan suites still pass.
