# Search: every month head shows its net

- PR: FLOW-908 (Search month totals).
- Kind: behavior
- Changed: the search list loads 50 lines a page, and a month showed its "נטו" only once all its lines had loaded, so the month cut off by the page (and every month after it, as you paged) showed no figure. The server now sends each month's whole net with the first page, so every month head shows its net at once, the last loaded month too. The figure and its look are unchanged.
- Rule: a month head's total is the whole month's, never a partial sum of the rows loaded so far; when the whole figure isn't known, the head shows none.
- Source: the owner's report from search, September with a net and August without.
