<a id="flow-312"></a>
# FLOW-312 · Split-by-category follow-ups (FLOW-311)
- **Type:** BACKLOG NIT · **Status:** done (items 1 and 6 in #133, item 2 in #136, item 5 in #145; items 3 and 4 moved to FLOW-325) · **Depends on:** FLOW-311
- [x] `get_project.transactions` lists only lines filed to or shared with the project, not lines that reach it through a part. (#133)
- [x] A bank re-sync that changes a split line's amount makes it count whole silently; open a review item (like the loan split `needs_review` flag) instead. (#136: an open `split_mismatch` review, decision [0125](../../decisions/0125-split-line-resync-review.md). The review card says "הפיצול לא תואם את סכום השורה בבנק." with "עדכון הפיצול", which opens the parts editor (FLOW-325 app PR).)
- [x] After FLOW-104: let a part take the other kind as a reversal, like a whole line. Moved to [FLOW-325](FLOW-325.md).
- [x] App screen to view and edit the parts (SMALL UI, plan with a mockup first). Moved to [FLOW-325](FLOW-325.md).
- [x] `split_line` inside the `assign_expenses` batch, with `undo_batch`. (#145: an `assign_expenses` row with `parts[]`)
- [x] `get_home.other_currencies[].count` (`count(*)`) and `get_project.other_currencies[].count` (one per row) count each part of a split line, and each loan split part, as a line. Count `distinct transaction_id`, as `company_pnl` does. (#133)
