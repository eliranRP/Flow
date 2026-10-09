# 2026-10-09 · FLOW-356: the breakdown's waiting row looks like a review row

- PR: #PRNUM (UI lane 2)
- What: on the income and expenses breakdown, "N ממתינים לאישור" drew a grey check with a muted title, so it read like one more category. It now uses the inbox icon and the `.ui-row-pending` tint, the same as Home's review row and the project page's waiting row. The hint "כבר כלולים בסכום" stays.
- Rule: every row that opens the review queue carries the inbox icon and the tint, wherever it sits.
- Shots: mockups/flow-356-breakdown-waiting/ in the project files (320, 390 and 375x667, light and dark).
