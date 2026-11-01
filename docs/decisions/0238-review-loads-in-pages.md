# Review loads its open items in pages

**Date:** 2026-11-01
**Status:** Accepted (owner, 2026-10-31, FLOW-984: the plan approved as written)
**Builds on:** [0230](0230-screens-data-in-half-a-second.md) (every screen shows its data within 0.5 seconds)

## Context

`list_review` returned every open item in one read. On the Flow QA sandbox that is about 1,280 items: 793 KB before compression, 0.7 to 1.0 s round trip and about 170 ms in the database, for a screen that shows one card at a time and a list. It missed the half-second goal of 0230 on any phone, and it grows with the queue.

## Decision

1. **A new read, `list_review_page(p_limit, p_after_date, p_after_created, p_after_id, p_project, p_item)`.** It returns `{items, total, next}`: the next page of open items after a cursor, the count of all open items (of the project when `p_project` is given), and the cursor of the page after (null on the last page). Items are ordered by the line's date, the queue row's created-at, then its id; the id is the tie-break the old order lacked. The limit is 50 by default, at least 1 and at most 200. A cursor missing any of its three parts reads from the start. `p_item` reads one open item by its review id and nothing else, for a link to a card the pages have not reached.
2. **The page is chosen first.** The page is picked from the queue and its lines alone (one more row than asked, to know whether another page follows); the per-row parts (share count, receipts, kept-out state, the forecast match) run for those rows only. Database time and size both fall with the page, not with the queue.
3. **`list_review()` stays.** The MCP tools read it and filter and page in the edge function. It and the page read share one row body, `private.review_row_items(ids)`, so they cannot drift; its answer is the same rows. Rows that share a date and a created-at (a bulk import) had no set order and now follow by id.
4. **The app reads 50, then 50 more at a time, ahead of the user, with no button.** The next page starts when 15 cards remain in the card flow, or when the end of the full list is one screen away. A skipped card goes behind the cards still to read, and the queue wraps back to it only once the last page is loaded. A failed page leaves a quiet row, "לא הצלחנו לטעון עוד פריטים" with "ניסיון חוזר", in the next card's place (at the list's end in the list).
5. **Every count is the server's total.** The card counter ("פריט 12 מתוך 1,287", the viewer's "1,287 ממתינות"), the segments, the list's subtitle, the minutes estimate and the Jev bookings' queued count use the `total` that comes with each page. An approval lowers it at once. Numbers over a thousand carry a comma. The list's "בלי פרויקט" count reads only the loaded rows, so it is left out until the last page is in.
6. **The cache stays one flat list.** `["review", preview]` holds the pages loaded so far as a `ReviewRow[]`; the open count, the next cursor and the state of the load live beside it. Optimistic updates (approve, change, undo) filter and map that list as before. After an invalidation the app reads again up to the number of cards it held.
7. **A project filter reads through `p_project`.** The project's items load in pages under their own cache key, instead of every page of the whole queue.
8. **A link to an unloaded card reads that one row** (`p_item`), adds it to the list, and does not send the owner to the head of the queue while the read is out.
9. **Jev's scope prefetch runs for each page**, with that page's cards. The card's Jev and flag reads cover the first 50 cards ahead, not the whole list.

## Alternatives rejected

Loading every page in the background: the cost stays, only later. A "load more" button: the owner asked for no button. Paging by offset: the queue changes under the reader (every approval), so an offset skips or repeats cards; a keyset cursor does not. Counting the loaded rows: the header would say 50 when 1,287 wait.

## Consequences

Review's first read is a page, about 47 KB (6.9 KB compressed) and about 36 ms in the database on the largest local company, against 1.29 MB (165 KB compressed) and about 172 ms. The app calls `list_review_page`; `list_review()` is read by the MCP tools only. A new screen that lists the whole queue must page it the same way.
