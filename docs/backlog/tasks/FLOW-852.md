<a id="flow-852"></a>
# FLOW-852 · Jev never files a line in a closed month
- **Type:** SMALL CYCLE (infra) · **Status:** in-progress · **Source:** the weekly security scan, 2026-11-14; the owner's decision the same day.
- **Files:** a new migration (jev_prefill, jev_prefill_loan), `supabase/migrations.lock`, `supabase/tests/database/closed_line_holds.test.sql`, a changelog fragment.

- [x] `jev_prefill` and `jev_prefill_loan` skip a line in a closed period (posted, not removed, dated on or before the books-closed date) with `closed_month`. A pending line is still filled.

**Acceptance:** with the books closed, Jev leaves a closed month's line as it was, even when the line has an open review row.
