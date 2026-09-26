# Flow — Settings (Draft)

**Status: Draft.** This screen is not approved and not wireframed. It does not override decisions 0001–0022. [Settings contents](../open-questions.md) stay open until this draft is accepted or replaced. The display option below is decided.

## Entry

Bottom navigation `הגדרות` (Settings) opens this screen. The Home `☰` button opens it too. Both are part of this draft; the wireframes do not draw the screen.

The proof of concept has one user, the owner ([0013](../decisions/0013-single-user-owner.md)). There is no role-based version of Settings.

## Proposed contents

### Company details

| Field | Hebrew label | Notes |
| --- | --- | --- |
| Business name | `שם העסק` | Shown nowhere else in the proof of concept except export. |
| VAT id | `מספר עוסק / ח.פ` | Stored on the company. Included in the Excel export header. |
| VAT status | `סטטוס מע״מ` | Draft enum: `עוסק מורשה` (charges VAT), `עוסק פטור` (exempt), `חברה` (company, charges VAT). This enum is not decided. |

### VAT rate

Shown when the status charges VAT. One number, basis points, draft default 18% (`1800`). Used only when Flow computes VAT on manual entry. VAT read off an invoice is never overwritten. See [calculations](calculations.md).

### Categories

A row `קטגוריות` opens the approved Categories screen. Behavior is [0008](../decisions/0008-flat-categories-hide-or-merge.md), not this draft.

### Rules

A list of learned rules. A one-project rule shows supplier or counterparty, project, and category. A split rule ([0021](../decisions/0021-shared-costs-and-overhead.md)) shows the payee and the method (equal, income share, or manual proportions). The owner can edit or delete either. This screen is still a draft.

Delete asks for confirmation (`למחוק את הכלל?`). Deleting a rule does not rewrite transactions already approved. The next row from that supplier will not auto-approve on the deleted rule; it goes to review unless an invoice link matches.

Edit uses the same project and category pickers as the change sheet.

### Accountant Excel export

A button `ייצוא לאקסל` downloads approved, paid lines (the counting set in [calculations](calculations.md), all dates, all projects and overhead). Draft columns, in this order:

1. Date (`dd/mm/yyyy`)
2. Direction (`הכנסה` / `הוצאה`)
3. Counterparty
4. Net shekels (two decimals, signed)
5. VAT shekels (two decimals, ≥ 0)
6. Project code (blank for overhead)
7. Project name or `הוצאות כלליות`
8. Category
9. Source (`בנק` / `ידני` / `חשבונית`)
10. Invoice number
11. `חשבונית ישראל` allocation number, when the linked document has one
12. Statement value date, when the source is the bank

Hashavshevet format is out of scope ([0001](../decisions/0001-management-tool-alongside-accounting.md)). Whether a later move of a transaction must also export the previous project is an [open question](../open-questions.md). The draft export shows the current assignment only.

### Bank account

One or more Bank Hapoalim account numbers (`חשבון הפועלים`). Flow uses them to drop own-account transfers: a row whose counterparty account equals another saved account on this company is removed and does not enter P&L. Other banks are not accepted ([0012](../decisions/0012-bank-hapoalim-first.md)).

If no account is saved yet, Flow does not auto-remove transfers. A row that merely looks like a transfer is suggested, and the owner can mark it `העברה בין חשבונות` on the review card, which excludes it.

### Display

`רווח אחרי חלק מהתקורה` (profit after overhead share). Off by default ([0022](../decisions/0022-after-overhead-starts-off.md)). One preference with the switch on Home and the project screen. Off, those screens show stored project profit, which is what matches the bank and the accountant. On, they show profit after the overhead share. The option does not change stored lines or company totals. [0021](../decisions/0021-shared-costs-and-overhead.md).

### Auto-approve

[0011](../decisions/0011-auto-approve-high-confidence.md) auto-approves a unique invoice match and an existing supplier rule. It rejected an opt-in switch and a manual "Approve all" as the way those rows get into the books.

This draft still shows a toggle, `אישור אוטומטי`, default on, because the owner asked to see it in the Settings proposal. **The toggle is not part of the approved product.** Shipping a way to turn auto-approve off needs a new decision that supersedes 0011. Until that decision exists, Flow always auto-approves high-confidence rows, and this control is not built.

## What this draft does not include

Pricing, a second user, credit-card importers, open banking, and VAT filing.
