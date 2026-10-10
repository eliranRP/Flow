<a id="flow-908"></a>
# FLOW-908 · Search: every month head shows its net
- **Type:** Bug · **Status:** in progress (Search month totals thread) · **Depends on:** FLOW-339 (done)
- **What:** search loads 50 lines a page, and a month showed its נטו only once all its lines had loaded, so most month heads had none (owner report 2026-10-10). `search_transactions` now sends every matching line's totals per month and currency on its first page, and the search screen's month heads read them.
- **Acceptance:** every month head in search shows its net, the last loaded month too; the figure is the whole month's, matching the rows' rules (a kept-out line adds 0, an income credit counts as money out).
