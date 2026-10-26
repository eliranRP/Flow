<a id="flow-962"></a>
# FLOW-962 · Loans v2: the UX/UI rules review of הלוואות
- **Type:** UI (design approved) · **Status:** claimed (UI lane 2, 2026-10-26, claude/flow-962-loans-v2) · **Depends on:** — · **Source:** a review of the loans list and the loan page against a UX/UI rule set. The owner approved the design on 2026-10-26. Owner calls on cards the same day: deleting a loan asks first and then gives a 5s undo; a loan can be closed by hand before its end (paid off in full, or a refinance with an optional link to the new loan), with a 5s undo and a way back to active, and it still closes by itself at $0; a change of terms asks from when it applies (today or a date, a past date allowed). Design: [Design canvas](https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD), page "In design · for approval", boards Loans v2.
- **Files:** the loan screens under `app/src/screens/` (`loans-*`, `loan-*`), the loan CSS under `app/src/ui/css/` (`26-loan-row.css`, `29-loan-detail.css`, `46-loans.css`), their stories and tests, `docs/qa/CONTROLS.md` (loan rows), a design log entry.

- [ ] The bars read: principal, interest and escrow segments and the debt track pass 3:1 (the empty track is an outline), and each bar has a label for screen readers.
- [ ] Save is never a dead button: an error under the field that is missing, and the button names what it saves (שמירת ההלוואה, שמירת התנאים).
- [ ] No dead rows: ריבית ותנאים opens the terms sheet, פרויקט opens the picker, the status row only reads, and "שינוי" is gone.
- [ ] Failed and offline states on the loans list and the loan page, as on Home v2.
- [ ] Delete asks first and names what is lost, then a 5s ביטול.
- [ ] A change of kind, terms or project gives a 5s ביטול under the header.
- [ ] A closed loan reads at full contrast with a "נסגרה" tag and opens its page.
- [ ] The next payment is its own row.
- [ ] One accent per card: the summary link is ink with a chevron.
- [ ] The bars carry a takeaway line.
- [ ] Type scale 13/15/17/20/32, weights on the existing tokens, tabular figures.
- [ ] Segmented controls and currency buttons are 44px.
- [ ] A new loan with no payments shows an empty line with the way to connect the bank; the paid card waits for the first payment.
- [ ] The נסגרו toggle has aria-expanded and a chevron.
- [ ] The active tab has the Home v2 pill (already in the app since FLOW-958).
- [ ] The payments page tag is a plain label.
- [ ] סגירת ההלוואה: why (נפרעה במלואה / מימון מחדש), the date, for a refinance an optional link to the new loan; then a 5s ביטול; a closed loan offers החזרה לפעילות.
- [ ] "מתי השינוי חל?" on a change of rate: today or a date (a past date allowed); the line under it says how many payments since then are worked out again.
- **Acceptance:** stories of the loan page (close sheet, closed early, edit from a past date, failed, offline) at 320 and 393; tests for each new path; CONTROLS.md rows; design log entry.
