<a id="flow-856"></a>
# FLOW-856 · The closed-date reads hold the company row until the write commits
- **Type:** SMALL CYCLE (infra) · **Status:** in-progress · **Source:** the security scan, 2026-11-21; the owner's decision the same day.
- **Files:** a new migration (books_closed_guard, books_closed_check, books_closed_setting_guard, jev_prefill, jev_prefill_loan), `supabase/migrations.lock`, `supabase/tests/database/books_closed_share_lock.test.sql`, `docs/tech/state-machines.md`, a changelog fragment.

- [x] `private.books_closed_guard`, `private.books_closed_check` and `private.books_closed_setting_guard` read `companies.books_closed_through` `FOR SHARE`, after the early return when no person writes. `books_closed_check` becomes volatile, so its locking read is allowed.
- [x] `jev_prefill` and `jev_prefill_loan` read the date `FOR SHARE` too.
- [x] A close (`mcp_set_books_closed_through`, and the undo of a move back) waits for a write in flight, and a write waits for a close in flight and then reads the new date. The lock order is in the migration's header.

**Acceptance:** each closed-date read on a write path takes the company row `FOR SHARE`: the line, line-parts and category-setting guards, Jev's two prefill functions, `follow_invoice`, `fill_suggested_category` and `review_held_change_guard`; a person's write to an open line still goes through, one to a closed line is still refused with `the books are closed through YYYY-MM-DD`, and the category setting guard still refuses a closed change.
