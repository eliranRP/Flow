<a id="flow-164"></a>
# FLOW-164 · P&L statement test: a line with no category, and the shared fixture helpers
- **Type:** BACKLOG NIT · **Status:** ready · **Source:** reviewer of #853, round 1 (Backlog).

- [ ] `pnl_statement.test.sql` gets a posted expense line with no category: it comes out as a row with `id` and `name` null and counts in the cost, and the total still equals `get_breakdown`'s.
- [ ] The test's setup uses `tests.fixture_company`, `fixture_category` and `fixture_line` from `supabase/tests/helpers.sql` instead of inserting rows directly (PITFALLS 31).
