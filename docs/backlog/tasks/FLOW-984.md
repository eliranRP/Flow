<a id="flow-984"></a>
# FLOW-984 · Review loads its open items in pages, not all at once
- **Type:** PLAN FIRST · **Status:** ready (plan approved 2026-10-31) · **Source:** the owner on 2026-10-28, from the perf steward's daily report ([2026-10-28](../../qa/perf/2026-10-28.md)) under decision [0230](../../decisions/0230-screens-data-in-half-a-second.md): page the Review screen.
- **Files:** `public.list_review` (a new migration: a limit and a cursor, the total count), its pgTAP test, `app/src/use-books.ts` (the review read), the Review screen and its stories and tests, the MCP review tools if they read `list_review`, a decision record.

`list_review` returns every open item in one read: on the Flow QA sandbox about 1,280 items, 793 KB before compression, 0.7 to 1.0 s round trip and about 170 ms in the database. Review shows one card at a time and a list.

- [x] Plan approved by the owner (2026-10-31), below.
- [ ] `list_review` takes a project filter on the server, so Review filtered to one project loads that project's items in pages too.
- [ ] `list_review` takes a page size and a cursor (doc date and created-at, its current order) and returns the total open count; the default call stays compatible until the app moves.
- [ ] Review shows its first page within 0.5 s on the FLOW-804 phone and loads the next page before the user reaches it.
- **Plan (owner's answers, 2026-10-31):**
  - **First page:** 50 items, then 50 more at a time.
  - **Loading more:** automatic, ahead of the user, with no button. It starts when 15 cards remain in the card flow, or one screen before the end of the list. Skip cycles within the loaded cards and wraps to the first card only once everything is loaded. If a batch fails, a quiet "לא הצלחנו לטעון עוד פריטים · ניסיון חוזר" row takes the next card's place.
  - **Header count:** the true total from the server, sent with every page ("פריט 12 מתוך 1,287", "1,287 ממתינות"). Approving lowers it by one. The list subtitle and the minutes estimate use the total too.
  - **Project filter:** a server-side project argument now (`p_project`), not loading every page.
- **Design (from the read-only survey):**
  - **New read:** `public.list_review_page(p_limit, p_after_date, p_after_created, p_after_id, p_project)` returns `{items, total, next}`. Keyset on `(t.doc_date, q.created_at, q.id)`, adding `q.id` as the tie-break; fetches `limit + 1`; limit capped.
  - **Old read kept:** the zero-argument `list_review()` stays unchanged for the MCP tools, which filter and page in the edge function. The two reads share their row body through a private function, and a pgTAP test checks that `list_review()` is byte for byte the same.
  - **Choose the page first:** the page is picked before `line_pnl_states` and the forecast matches run, so the database time drops along with the size.
  - **App cache:** `["review", preview]` stays a flat `ReviewRow[]`. More pages are appended with `setQueryData`, so the six `Array.isArray(old)` optimistic updates and the undo keep working. After an invalidation, the app refetches up to the loaded count.
  - **Deep link:** `?item=` to a row not yet loaded reads that one row.
  - **Jev prefetch:** the Jev scope prefetch runs per page.
  - **Files:**
    - Database: a new migration, `supabase/tests/database/review_paging.test.sql`.
    - App: `app/src/read-schemas.ts`, `app/src/use-books.ts`, `app/src/screens/review-screen.tsx`, `review-queue.tsx`, `review-lists.tsx`, `review-shared.tsx`, `change-form.tsx`, and their stories and tests.
    - Docs: a decision record.
    - The MCP and Home are unchanged.
- **Acceptance:** pgTAP for the paging (order, cursor, count, another company), unit and e2e tests for the screen across a page boundary, the perf steward's measurement before and after.
