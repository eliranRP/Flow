# A loan closes by why and when; its page's toasts hang under the top bar for 5s

**Date:** 2026-10-26
**Status:** Accepted (owner, 2026-10-26, FLOW-962. Extends [0212](0212-review-toast-under-header.md) to the loan pages; refines [0122](0122-loan-status.md) for the app's words)

## Context

FLOW-962 reviewed the loans list and the loan page against a UX/UI rule set. The status row opened a sheet of three states (פעילה, נפרעה, נסגרה) and then a date sheet, and a paid-off loan reopened from a "שינוי" link beside its pill. The owner approved the Loans v2 board and, on choice cards on 2026-10-26, chose: delete asks first and then gives a 5s undo; a loan can be closed by hand before its end, as paid off in full or as a refinance, with a 5s undo and a way back to active; a change of terms asks from when it applies.

## Decision

1. **Closing.** The status row only reads. An open loan has one outline action, סגירת ההלוואה, which opens one sheet: why (נפרעה במלואה is `paid_off`, מימון מחדש is `closed`), the day (today, or the last attached payment when that is later; never before it and never after today), and one line on what follows. A closed loan leads its page with "נסגרה · <why> · DD/MM/YYYY", and has החזרה לפעילות in place of the close action. The writes are 0122's (`status`, `closed_on`), so MCP `update_loan` already does the same.
2. **From when.** The rate sheet asks "מתי השינוי חל?": מהיום, the default, or מתאריך… (a day from the loan's start, past or future). The line under it names the next payment, or for a past day how many payments were attached since then. Those keep their parts, as [0132](0132-loan-kinds-rates.md) says; the schedule from the next payment on uses the new rate.
3. **Toasts.** On the loan page and its payments page every toast takes `place: "top"` and hangs under the page's top bar, and a confirmation with ביטול stays 5s: a close, a reopen, a kind, rate, project or part change, and a delete (shown on the list it returns to). Errors keep their usual time.

## Alternatives rejected

- Keeping the three-state sheet: a status picker reads like a setting, while the owner closes a loan for one of two reasons; פעילה needed its own row of the same sheet.
- Re-splitting the payments attached since a past rate day: it changes the P&L of months already read, and 0132 keeps their parts. It is left to the owner as its own decision.
