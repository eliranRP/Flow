# Flow — Module 1, Project P&L

Proof-of-concept specification for Flow. Screen fields, states, and edge cases are in the files linked from [screens.md](screens.md). Exact totals are in [calculations.md](calculations.md). Settings is a [draft](settings.md) and is not approved. Open items are listed in [open questions](../open-questions.md).

Decisions that this spec follows: [0001](../decisions/0001-management-tool-alongside-accounting.md) through [0009](../decisions/0009-scalable-pickers.md), and [0011](../decisions/0011-auto-approve-high-confidence.md) through [0014](../decisions/0014-optional-project-budget.md).

## Goal

Help an Israeli project-based business see profit and loss without opening the accountant's software.

Two levels:

- **Company.** All projects, plus company overhead (`הוצאות כלליות`).
- **Project.** One job. In the proof of concept a project is a construction job. The same object is a segment of the business for the next vertical.

The owner should be able to answer "am I making money?" for the company in a few seconds, and "is this job making money?" on the next screen.

## Who it is for

Owners of small and mid-size Israeli contractor businesses. They are on site most of the day, so the product is mobile first: Hebrew, right to left, ₪, bottom navigation in the thumb zone, large tap targets. [0002](../decisions/0002-poc-targets-construction-contractors.md), [0005](../decisions/0005-mobile-first.md).

The proof of concept is single-user. That user is the business owner. There are no roles and no permissions. An office-manager role can come later. [0013](../decisions/0013-single-user-owner.md).

## UX principle

Minimal operations. The product suggests a project and a category. The owner confirms. Typing is the fallback (a brand-new project name, a cash amount, a search when the suggestion is wrong), not the daily path. [0006](../decisions/0006-confirm-not-type.md).

## How the numbers add up

Every shekel belongs to exactly one project, or to overhead. A split transaction is several lines; each line belongs to one project or to overhead, and the lines sum to the transaction.

For a reporting period, using approved cash amounts, as defined in [calculations.md](calculations.md):

- Company income = income on every project + income on overhead.
- Company expenses = expenses on every project + expenses on overhead.
- Company profit = company income − company expenses.

Home always shows those company totals, including projects that are collapsed off the list and including overhead. Overhead is a built-in bucket, not a project the owner creates, and not a footnote under the projects. Hiding a row never removes it from the total.

Amounts on screen are **net of VAT**. VAT is stored and shown separately. The owner reads profit without VAT mixed into the job.

## Cash basis

Version 1 is cash basis. [0004](../decisions/0004-cash-basis-for-v1.md), [0007](../decisions/0007-bank-statement-is-primary-input.md).

A Bank Hapoalim (`בנק הפועלים`) statement row is what makes money count in the proof of concept. An invoice is a supporting document linked to that row. Cash and cheques count when the owner records them and marks them paid. [0012](../decisions/0012-bank-hapoalim-first.md).

An invoice with no matching payment is **unpaid**. It stays out of P&L until a later statement row matches it, or the owner marks it paid. Unpaid invoices remain visible so the owner can see what is still open.

Only **approved** transactions enter reports. Suggested rows wait. Home shows a pending-count banner so a glance at profit is not mistaken for a final number.

Own-account transfers (moving money between the company's bank and card accounts) are removed on import. They are not income and not expense.

## Getting data in

Three paths, all opened from the center **+** button (`הוספה`).

| Path | Label | What happens |
| --- | --- | --- |
| Invoice photo or PDF | `צלם חשבונית` | The product reads supplier, amount, VAT, date, and invoice number, and checks for a duplicate. It keeps the Israel invoice allocation number (`חשבונית ישראל`) when the document has one. The document waits to be linked to a payment. |
| Bank statement | `העלה דוח בנק/אשראי` | Excel or CSV from Bank Hapoalim (`בנק הפועלים`). Each row becomes a transaction. Own-account transfers are removed. Rows are matched and classified as below. |
| Manual entry | `הזנה ידנית` | Fallback for cash and cheques: amount, project, and category. This is the path that marks money as paid when there will never be a statement row. |

The proof of concept parses Hapoalim files only. Other banks, and credit-card company files, come after the proof of concept. [0012](../decisions/0012-bank-hapoalim-first.md). When credit-card statement support starts is an [open question](../open-questions.md). The add-sheet label still says bank and credit (`בנק/אשראי`), and the upload wireframe uses a Leumi file name; both are earlier example art, not the bank to build.

## Matching, confidence, and review

For each statement row, in order:

1. Link it to an existing invoice on amount, date, and supplier.
2. Apply a learned rule for that supplier or counterparty.
3. Ask the model to guess a project and a category.

A deposit from a client is suggested onto that client's project.

**High confidence** means step 1 or step 2 matched. Those rows are auto-approved. They skip the review queue and count in reports immediately. The owner gets a short summary of what was auto-approved and can reopen any item and change it. [0011](../decisions/0011-auto-approve-high-confidence.md).

Anything else goes to the review queue (`לאישור`), one card at a time.

| Action | Label | Effect |
| --- | --- | --- |
| Approve | `אישור` | The suggestion stands. The transaction becomes approved and counts in reports. |
| Change | `שינוי` | A bottom sheet. Project and category, two taps, then save and approve (`שמור ואשר`). |
| Remember | `לזכור לספק הזה` | On by default when changing. Writes a rule: this supplier maps to the chosen project and category. Later rows from that supplier take step 2 and skip the queue. |
| Split | `פצל בין פרויקטים` | One transaction across projects, by amount or by percent. |
| Skip | `דלג` | Leave the card for later. It stays unapproved and out of the reports. |
| Reopen | — | From the auto-approve summary. Opens an already approved item in the change sheet. |

The change sheet shows the rule it will write (supplier → project · category) while the toggle is on, so a wrong memory is visible before save.

Corrections are how the product learns. Example: invoices from supplier "השרון" are corrected once to project "בניין מגורים חולון" and category `חומרים`. The next row from that supplier is classified the same way.

## Categories

Flat list. No sub-groups in the proof of concept. [0008](../decisions/0008-flat-categories-hide-or-merge.md).

Preloaded expenses: `חומרים`, `קבלני משנה`, `עבודה`, `ציוד והשכרה`, `הובלה`, `ביטוח`, `אחר`.

Preloaded income: `תקבול מלקוח`, `הכנסה אחרת`.

Managed in Settings → Categories, and created inline from the change sheet. The owner can rename, add, drag to reorder, hide, and merge into another category. Delete is offered only when the category has no transactions; otherwise the row explains that delete is unavailable. Hidden categories sit in a collapsed group and can be restored. Merging moves existing transactions onto the category that remains.

Past about 15 categories, the product hints that it is time to merge.

Order matters: the top of the list is what the picker prefers when it needs a short set of chips.

## Many projects and categories

[0009](../decisions/0009-scalable-pickers.md).

**Home** shows company totals for everything, then the top 5 projects by activity this month, then one collapsed row for the rest (count and combined profit), then overhead. Sort on the top 5 is "by activity" (`לפי פעילות`) or "losses first" (`הפסד קודם`). Overhead stays its own row in either sort. The collapsed row opens the projects list.

**Picker** shows three chips (AI pick, last used for this supplier, one more), then search by name or project code, then the full list sorted by recent activity. Finished projects are omitted from that list and from the chips. Search still finds a finished project, so a late bill on a closed job can be filed. Finished projects remain in reports.

The projects list shows active jobs and tucks finished ones under `הסתיימו`.

## Data model

Enough structure for the proof of concept. This is not a chart of accounts.

**Company.** VAT id, VAT status (whether the business is registered for VAT, so net-vs-gross display and the VAT column stay meaningful).

**Project.** Name, code, status (`active` or `finished`), optional client, optional budget. One built-in Overhead record represents `הוצאות כלליות`. The owner does not delete it. Budget is optional. Budget versus actual appears on the project screen only when a budget is set; with no budget, that card is omitted. [0014](../decisions/0014-optional-project-budget.md).

**Category.** Type (`income` or `expense`), name, order, hidden flag.

**Transaction.** Date, amount net, VAT, direction (in or out), counterparty, project (or overhead), category, source (`invoice`, `bank`, or `manual`), status (`suggested` or `approved`), paid state, linked document, and split lines when the amount is shared across projects. A suggested transaction is excluded from reports. An unpaid invoice document with no transaction yet is excluded as well.

**Rule.** Supplier or other counterparty → project + category. Created from the remember toggle. Applied on the next matching row before the AI guess.

**Document.** Image or PDF, plus extracted fields: supplier, amount, VAT, date, invoice number, allocation number when present, and a duplicate flag.

Project codes are assigned on create so search has a stable handle (`P-01`, `P-02`, …). The owner does not type the code. The create sheet asks for a name, and optionally a client and a budget. See [Projects](screens/05-projects.md).

## Reports and export

Reports use approved, paid, cash amounts, net of VAT, with VAT available beside them.

The owner can export to Excel for the accountant. The file covers approved transactions and keeps the identifiers needed to reconcile, including invoice number and the `חשבונית ישראל` allocation number when the linked document has one. Proposed columns are in the [Settings draft](settings.md). They are not approved.

A Hashavshevet-compatible format is a later export, not the proof of concept. [0001](../decisions/0001-management-tool-alongside-accounting.md).

## Out of scope for the proof of concept

- Official double-entry books and a balance sheet (the accountant keeps them).
- VAT filing.
- Payroll.
- Invoicing, and Morning or iCount integration. [0003](../decisions/0003-no-invoicing-in-the-poc.md).
- Open banking. Statements arrive as files the owner uploads.
- Multi-currency. Amounts are ₪.
- Progress billing and retention.
- Category sub-groups.
- Accrual basis.
- Statement files from banks other than Bank Hapoalim (`בנק הפועלים`), and credit-card company statement files. [0012](../decisions/0012-bank-hapoalim-first.md).
- Roles and permissions. The proof of concept is the owner alone. [0013](../decisions/0013-single-user-owner.md).

## Success metrics

- First project P&L within 15 minutes of signup.
- At least 80% of AI suggestions accepted unchanged after the first month.
- Daily review under 5 minutes.
- Zero untagged transactions. Every shekel that counts has a project or overhead, and a category.

## Related

- [Screens and wireframe notes](screens.md)
- [Calculations](calculations.md)
- [Settings draft](settings.md)
- [Wireframe files](wireframes/README.md)
- [Open questions](../open-questions.md)
