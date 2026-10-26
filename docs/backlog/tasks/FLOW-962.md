<a id="flow-962"></a>
# FLOW-962 · Loans v2: the UX/UI rules review of הלוואות
- **Type:** UI (design approved) · **Status:** in-progress (#824) · **Depends on:** — · **Source:** a review of the loans list and the loan page against a UX/UI rule set. The owner approved the design on 2026-10-26. Owner calls on cards the same day: deleting a loan asks first and then gives a 5s undo; a loan can be closed by hand before its end (paid off in full, or a refinance with an optional link to the new loan), with a 5s undo and a way back to active, and it still closes by itself at $0; a change of terms asks from when it applies (today or a date, a past date allowed). Design: [Design canvas](https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD), page "In design · for approval", boards Loans v2.
- **Files:** the loan screens under `app/src/screens/` (`loans-*`, `loan-*`), the loan CSS under `app/src/ui/css/` (`26-loan-row.css`, `29-loan-detail.css`, `46-loans.css`), their stories and tests, `docs/qa/CONTROLS.md` (loan rows), a design log entry.

- [x] The bars read: principal, interest and escrow segments and the debt track pass 3:1 (the empty track is an outline), and each bar has a label for screen readers.
- [x] Save is never a dead button: an error under the field that is missing, and the button names what it saves (שמירת ההלוואה, שמירת התנאים).
- [x] No dead rows: ריבית ותנאים opens the terms sheet, פרויקט opens the picker, the status row only reads, and "שינוי" is gone.
- [x] Failed and offline states on the loans list and the loan page, as on Home v2.
- [x] Delete asks first and names what is lost, then a 5s ביטול.
- [x] A change of kind, terms or project gives a 5s ביטול under the header.
- [x] A closed loan reads at full contrast with a "נסגרה" tag and opens its page.
- [x] The next payment is its own row.
- [x] One accent per card: the summary link is ink with a chevron.
- [x] The bars carry a takeaway line.
- [x] Type scale 13/15/17/20/32, weights on the existing tokens, tabular figures.
- [x] Segmented controls and currency buttons are 44px.
- [x] A new loan with no payments shows an empty line with the way to connect the bank; the paid card waits for the first payment.
- [x] The נסגרו toggle has aria-expanded and a chevron.
- [x] The active tab has the Home v2 pill (already in the app since FLOW-958).
- [x] The payments page tag is a plain label.
- [x] סגירת ההלוואה: why (נפרעה במלואה / מימון מחדש), the date; then a 5s ביטול; a closed loan offers החזרה לפעילות.
- [x] For a refinance, an optional link to the new loan (owner, 2026-10-26: build it): `loans.refinanced_into_id`, MCP `set_loan_refinance` with undo `loan_refinance`, `list_loans` returns it; the closed head names and opens it.
- [x] The loan closes by itself when its balance reaches 0: filed as FLOW-964 (owner, 2026-10-26: its own task).
- [x] "מתי השינוי חל?" on a change of rate: today or a date (a past date allowed); the day sets only from when the schedule and the forecast use the new rate, and the line says how many payments were attached since then, which keep their parts (owner, 2026-10-26: decision 0132 stands).
- **Acceptance:** stories of the loan page (close sheet, closed early, edit from a past date, failed, offline) at 320 and 393; tests for each new path; CONTROLS.md rows; design log entry.
