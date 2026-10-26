<a id="flow-965"></a>
# FLOW-965 · Lines v2: the UX/UI rules review of a month's lines and the transaction page
- **Type:** UI (design approved) · **Status:** in-progress (#826) · **Depends on:** — · **Source:** a review of the month's lines (`/cash/:month/:side/:currency`) and the transaction page (`/transactions/:id`) against a UX/UI rule set. The owner approved the design on 2026-10-26. Design: [Design canvas](https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD), page "Ready for dev", the Lines row and the note "LINES v2" with its owner calls.
- **Files:** `app/src/screens/cash-lines-screen.tsx`, `app/src/screens/cash-lines-parts.tsx`, `app/src/screens/transaction-screen.tsx`, `app/src/screens/transaction-rule-offer.tsx`, `app/src/ui/band-states.tsx`, the lines and transaction CSS under `app/src/ui/css/`, `supabase/migrations/20261026170000_supplier_category_rule.sql`, flow-mcp `remember_supplier_category`, their stories and tests, decision 0216, a design log entry.

- [x] Contrast: the order chips' edges and the switch's off track meet 3:1, light and dark (app-wide).
- [x] The transaction page's category change offers to file the supplier's next lines ("כן, מעכשיו" / "רק השורה הזו"), with a 5s ביטול; earlier lines never change. A project change has no offer (decision 0216).
- [x] The order chips draw 44px.
- [x] The lines screen has failed, offline and empty states ("עוד לא נכנס כסף ב<month>" with one action).
- [x] Items waiting for approval show Home v2's filled "לאישור N פריטים" button.
- [x] The transaction page's toasts sit under its bar with a 5s ביטול (decision 0216, extending 0212).
- [x] The order chips are a radio group; the direction switch is a tab list.
- [ ] The transaction page's history chart: takeaway title, every month in its label, past bars at 3:1. In FLOW-963's files (#825); follows its merge.
- [ ] "לא קבוע" last in the frequency sheet: FLOW-963 (#825) moves it.
- Already so in the app, no change: the invoice card opens its document (a SUMIT page, not an image); the bank description is 13px and not monospace; the tab bar's pill (FLOW-958).
- **Acceptance:** stories of the lines (failed, offline, empty, waiting) and the transaction page (the rule offer); tests for the offer, its undo, the toasts' place, the states and the chips' roles; decision 0216; MCP tool with undo; design log entry.
