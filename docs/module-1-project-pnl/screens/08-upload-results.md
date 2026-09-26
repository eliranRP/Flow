# Upload results

**Status:** Approved. Wireframe [08-upload-results-v2](../wireframes/08-upload-results-v2.png). [08-upload-results](../wireframes/08-upload-results.png) is superseded.
**Decisions:** [0011](../../decisions/0011-auto-approve-high-confidence.md) auto-approves unique invoice matches and supplier rules. [0012](../../decisions/0012-bank-hapoalim-first.md) accepts Bank Hapoalim only. The approved wireframe uses `הפועלים_ספטמבר.xlsx` and has no secondary approve button.

This screen is also the short summary of what was auto-approved for a statement batch.

## Purpose

Show what a Hapoalim file became, and send the owner only to the rows that still need a decision.

## Entry points

| From | How |
| --- | --- |
| Add sheet | After `העלה דוח בנק/אשראי` and a file is chosen. |
| Local queue | When an offline file finishes parsing. |

Close (`✕`) returns to the tab the owner was on when they tapped `+`. It does not undo the import. Auto-approved rows already count.

## Where taps go

| Tap | Goes to |
| --- | --- |
| `לאשר {n} פריטים` | Review, filtered to this file's suggested rows. Hidden when `n` is 0. |
| `אושרו אוטומטית ({n})` | A plain list of those rows: date, counterparty, net, project, category. Tapping a row opens the change sheet (reopen). |
| Transfers row | A list of removed rows, read only, with the reason `העברה בין חשבונות`. |
| Unpaid note | List of invoice documents that still have a remaining net. Each row can `סמן כשולם במזומן`, which opens the manual form prefilled from the invoice and, on save, links it and marks it paid. |
| `הצג את כל {n} השורות` | Every row in the file, including skipped duplicates and removed transfers, with a status label. |
| Close | Previous tab. |

## Elements and fields

Title `דוח בנק הועלה`. File line: the real file name, then the min and max value dates in the file as `dd/mm–dd/mm/yyyy` when they share a year, otherwise full dates.

| Block | Hebrew | Meaning |
| --- | --- | --- |
| Total | `{n}` / `שורות נקלטו` | Data rows in the file, including ones skipped as duplicates or removed as transfers. |
| Matched | `{n} הותאמו לחשבוניות קיימות` | Unique invoice links. Auto-approved. Subtitle `ספק + סכום + תאריך תואמים` is replaced in the product by `הותאמו ואושרו`, because a date is not required for a unique amount match. |
| Rules | `{n} סווגו לפי כללים שלמדנו` | Auto-approved by rule. Subtitle `ספקים שאישרת בעבר`. |
| Transfers | `{n} העברות בין חשבונות שלך` | Removed. Subtitle `הוסרו – לא נספרות ברווח`. Dimmed. |
| Review | `{n} ממתינות לאישור` | Suggested. Emphasized. Subtitle `ה-AI הציע שיוך – צריך את האישור שלך`. |
| Already imported | `{n} כבר היו במערכת` | Overlap skips. Shown only when `n` > 0. |
| Unpaid | `{n} חשבוניות עדיין לא שולמו – לא נספרות ברווח` | Documents, not rows from this file. Company-wide unpaid count, not only this file. |
| Primary | `לאשר {n} פריטים` | |
| Summary link | `{n} אושרו אוטומטית` | The matched count plus the rules count. On the approved wireframe this is one collapsed row, `33 אושרו אוטומטית`, with `18 הותאמו לחשבוניות · 15 לפי כללים` underneath. |
| All rows | `הצג את כל {n} השורות` | |

Amounts inside the row lists use the detail display, net of VAT, signed, red minus for outflows. Dates are `dd/mm/yyyy`.

The stacked bar's segments, in order, are: matched, rules, transfers, review. On the approved wireframe the matched and rules segments are the auto-approved group (18 + 15 = 33), then transfers (2) and review (7). Skipped duplicates are not a bar segment; they are the extra line, shown only when the count is above zero. The example file has none.

## States

**Loading.** Title and the file name, with `קוראים את הקובץ…`. No partial counts that jump.

**Empty file.** `הקובץ ריק`. One action: `בחר קובץ אחר`, which returns to the file picker. Nothing is stored.

**Normal.** The blocks above. Primary button present only when the review count is above 0.

**Partial.** This screen is how the owner sees that some rows are final and some are not. Auto-approved rows are already in Home. The review count is the part that is not final.

**Error.**

| Case | Hebrew | What was stored |
| --- | --- | --- |
| Not Hapoalim, or unreadable workbook | `אפשר לייבא כרגע רק קובץ של בנק הפועלים` | Nothing. |
| Identical file already imported | `הקובץ הזה כבר נטען` | Nothing new. |
| Parser crash | `לא הצלחנו לקרוא את הקובץ` | Nothing. |

One action on each error: `בחר קובץ אחר`.

**Offline.** Parsing runs on the device. Results appear without a network. Rows that need an AI guess are stored as suggested with no chips until the device is online; they still count in `ממתינות לאישור`. Invoice matching and rules run offline against documents and rules already on the phone.

## Edge cases

- **Duplicate invoice already stored.** The bank row can still match it and auto-approve. The invoice is not duplicated.
- **Same file twice.** Error state. Profit unchanged.
- **Overlapping dates.** New rows import. The `כבר היו במערכת` line shows the skip count. Profit moves only for new approved rows.
- **One row, two invoices.** Counted in `ממתינות לאישור`, with both candidates on the review card. Not in the auto-approved total.
- **Partial payment.** Review, not auto-approved. After the owner confirms, the cash counts and the remainder stays on the unpaid note.
- **One payment covering every open invoice for that supplier.** Auto-approved, linked to all of them, in the matched count.
- **Refund.** An inflow. If a supplier rule exists, it auto-approves onto that expense category and lowers expenses. Otherwise it waits in review.
- **Split.** Not done on this screen. The owner reopens a row and splits on the change sheet. The file's row count does not change.
- **Move after approval.** Reopen from the auto-approved list. Home updates. This screen's counts do not rewrite history; they describe the import.
- **Finish or delete a project.** A rule that points at a deleted project cannot fire; that row waits in review. A rule that points at a finished project still auto-approves onto it (a late bill).
- **Category merge.** Rules already point at the surviving category before this import runs.
- **Overhead.** A rule can auto-approve onto overhead. The row is in the auto-approved list, labeled `הוצאות כלליות`.
- **VAT-exempt.** VAT column on the row list is `₪0`. Net still counts.
- **Client deposit, no project.** Review count. Not auto-approved.
- **Non-Hapoalim.** Error state. Including credit-card company files.
- **Long Hebrew memos.** One line, ellipsis, in the all-rows list. The review card wraps to three lines.
- **0 projects.** Import still completes. Nothing can auto-approve via a project rule unless the rule points at overhead. Other rows wait in review.
- **Transfers with no saved account.** Not auto-removed. They sit in review until the owner marks them, or until a Hapoalim account number exists on the company. See the [Settings draft](../settings.md).

## Acceptance criteria

- [ ] A recognized Hapoalim file produces the four outcomes: auto-approved by invoice, auto-approved by rule, removed transfer, or review.
- [ ] There is no button that asks the owner to approve the high-confidence set. Those rows already count.
- [ ] Each auto-approved row can be reopened into the change sheet.
- [ ] A second import of the same bytes imports nothing.
- [ ] An overlapping file does not double-count a row already stored.
- [ ] A non-Hapoalim file shows the Hapoalim-only error and stores no transactions.
- [ ] Unpaid invoices are listed and are absent from profit.
- [ ] Amounts are net of VAT. Dates are `dd/mm/yyyy`. Outflows are red with a minus.
- [ ] With zero rows to review, the primary button is hidden and the summary of auto-approved rows remains.
