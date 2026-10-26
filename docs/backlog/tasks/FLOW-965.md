<a id="flow-965"></a>
# FLOW-965 · Lines v2: the UX/UI rules review of a month's lines and the transaction page
- **Type:** UI (design approved) · **Status:** in-progress · **Depends on:** — · **Source:** a review of the month's lines (`/cash/:month/:side/:currency`) and the transaction page (`/transactions/:id`) against a UX/UI rule set. The owner approved the design on 2026-10-26. Design: [Design canvas](https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD), page "Ready for dev", the Lines row and the note "LINES v2" with its owner calls.
- **Files:** `app/src/screens/cash-lines-screen.tsx`, `app/src/screens/cash-lines-parts.tsx`, `app/src/screens/transaction-screen.tsx` and its parts, the lines and transaction CSS under `app/src/ui/css/`, their stories and tests, a decision, a design log entry.

- [ ] Contrast: the order chips' edges, the history chart's past bars and the switch's off track meet 3:1, light and dark.
- [ ] The transaction page's project and category rows open a picker for this line only, with a 5s ביטול toast under the header. After a change, a card offers to file the payee's next lines the same way ("כן, מעכשיו" / "רק השורה הזו"); accepting toasts with ביטול.
- [ ] The invoice card opens a full-screen viewer.
- [ ] Touch targets on both screens are 44px (compact toggle, chips, segmented control).
- [ ] The lines screen has failed, offline and empty states ("עוד לא נכנס כסף ב<month>" with one action).
- [ ] Items waiting for approval show Home v2's filled "לאישור N פריטים" button.
- [ ] The counts-in-profit toggles toast under the header with a 5s ביטול (a decision extends 0212).
- [ ] The order chips are a radio group; the direction switch is a tab list.
- [ ] The history chart's title states the takeaway, and its screen-reader label reads every month.
- [ ] Type follows the scale with tabular figures; the bank description is 13px; "לא קבוע" is last in the frequency sheet.
- **Acceptance:** stories of the lines (failed, offline, empty, waiting) and the transaction page (pickers, rule offer, invoice viewer) at 320 and 393, light and dark; tests for the pickers, undo, the rule offer, the states and the chart label; design log entry.
