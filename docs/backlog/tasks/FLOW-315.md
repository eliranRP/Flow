<a id="flow-315"></a>
# FLOW-315 · Bank details follow-ups (#107 review)
- **Type:** BACKLOG NIT · **Status:** done (#283), except the account label's last 4, which waits on the owner · **Depends on:** FLOW-304 (#107)
- [x] The first review card grows 19 to 38px when its bank details arrive, so אישור moves. Read the whole queue's details in one `get_line_meta` call with the list. (#283: one read for the next 50 cards, in chunks of 200 ids, the server cap; the card does not wait for it, since the details are supplementary. אישור itself no longer moves: the bar is pinned since FLOW-327.)
- [x] The detail memo row that clamps past 4 lines has no visible expand cue (the card memo has ▾). (#283)
- [x] `private.mask_long_digits` misses digit runs split by spaces or dashes; only matters if a writer other than Mercury's redactor stores a memo.
- [x] `get_line_meta` uses `current_company_id`, so demo viewers get an empty list (same as `get_transaction`); re-check `card_last4` as 4 digits on read. (`20261010100000_viewer_reads.sql` also moves list_review, list_skipped_review, list_categories, list_project_category, project_waiting and search_transactions back to the readable company; a pgTAP guard fails when a later redefinition drops it. `get_project` still filtered on `owner_id`, so a viewer's project page was empty: fixed in `20261010190000_viewer_project_page.sql` with the drill-down, category totals and filed-today helpers.)
- [ ] Stored Mercury account labels lose their digits at import, so the account row never shows a last 4. Keep the label's last 4 at import if the owner wants it.
- [x] The review queue warms the first other row's details, not the next card's. (#283: the one read covers every card in the queue.)
