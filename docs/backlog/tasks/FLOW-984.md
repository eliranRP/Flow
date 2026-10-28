<a id="flow-984"></a>
# FLOW-984 · Review loads its open items in pages, not all at once
- **Type:** PLAN FIRST · **Status:** plan-first · **Source:** the owner on 2026-10-28, from the perf steward's daily report ([2026-10-28](../../qa/perf/2026-10-28.md)) under decision [0230](../../decisions/0230-screens-data-in-half-a-second.md): page the Review screen.
- **Files:** `public.list_review` (a new migration: a limit and a cursor, the total count), its pgTAP test, `app/src/use-books.ts` (the review read), the Review screen and its stories and tests, the MCP review tools if they read `list_review`, a decision record.

`list_review` returns every open item in one read: on the Flow QA sandbox about 1,280 items, 793 KB before compression, 0.7 to 1.0 s round trip and about 170 ms in the database. Review shows one card at a time and a list.

- [ ] Plan and mockup approved by the owner: how many items load first (about 50), how more load (on scroll, or on reaching the end of the cards), what the count in the header says while not everything is loaded, and how approve/skip and filters behave across pages.
- [ ] `list_review` takes a page size and a cursor (doc date and created-at, its current order) and returns the total open count; the default call stays compatible until the app moves.
- [ ] Review shows its first page within 0.5 s on the FLOW-804 phone and loads the next page before the user reaches it.
- **Acceptance:** pgTAP for the paging (order, cursor, count, another company), unit and e2e tests for the screen across a page boundary, the perf steward's measurement before and after.
