<a id="flow-154"></a>
# FLOW-154 · Book and merge lock accounts in one order
- **Type:** BACKLOG NIT · **Status:** in-progress (#851) · **Source:** reviewer of #850, round 2.
- **Files:** `supabase/migrations/20261028094057_account_lock_order.sql` (new), `supabase/migrations.lock`, `supabase/tests/database/chart_of_accounts.test.sql`.

`book_line` and `create_journal_entry` take each leg's account `for share` in leg order; `merge_account` locks its two accounts in id order. A booking and a merge on the same two accounts at the same time can deadlock. Postgres breaks it and the booking answers `unavailable` ("retry"), so nothing is written wrong, but one call fails.

- [x] `book_line` and `create_journal_entry` lock every account their legs name in id order, before they read any.
- [x] A test pins the order (the lock is taken on all leg accounts before the per-leg reads).

**Acceptance:** pgTAP; the chart of accounts and journal entry tests still pass.
