# Flow

Flow is a mobile-first way for Israeli project-based businesses to see project profit and loss: income, expenses, and the bottom line. The proof of concept is for owners of small and mid-size construction contractors. The same model is meant to fit any project-based business after that.

This repository is the product home. It holds documentation and design artifacts only. There is no application code yet.

Amounts are in shekels (₪), shown net of VAT, with VAT tracked beside them. This phase is Hebrew only, right to left. The owner signs in with a mobile number and an SMS code, on an installable phone web app. There is no desktop version in this phase. The owner confirms what the product suggests instead of typing a classification for every shekel.

## What the owner gets

Two levels, and they always add up:

- **Company.** Every project, plus company overhead (`הוצאות כלליות`).
- **Project.** One job (one segment of the business), with its own income, expenses, and profit.

Every shekel sits on exactly one project, or on overhead. Projects plus overhead equal the company total.

Money is counted on a cash basis. A bank row, or a cash or cheque payment the owner records, is what enters the P&L. An invoice is the supporting document. An invoice with no matching payment stays unpaid and out of the P&L until a statement row matches it, or the owner marks it paid.

The owner is on site most of the day, so the product is a phone UI: bottom navigation in the thumb zone, large tap targets, and a review queue that can be cleared in a few taps.

## How data gets in

1. Photos or a PDF of an expense invoice, taken in a row or picked from files on the phone. Android can also share an image or PDF into the installed app. iPhone cannot. The product reads supplier, amount, VAT, date, and invoice number, and checks for a duplicate.
2. A Bank Hapoalim (`בנק הפועלים`) statement (Excel or CSV). Each row becomes a transaction. Transfers between the company's own accounts are removed. Other banks, and credit-card company files, come after the proof of concept.
3. Manual entry, for cash and cheques.

Suggestions follow a fixed order: link a bank row to an existing invoice (amount, date, supplier), then apply a learned supplier rule, then an AI guess. A deposit from a client is suggested onto that client's project. A high-confidence match (an invoice or a learned rule) is auto-approved, skips the review queue, and appears in a short summary the owner can reopen and change. Everything else waits in the review queue. Only approved transactions appear in reports. A pending-count banner stays visible while the numbers can still move.

Correcting a suggestion can become a rule ("remember for this supplier" is on by default): supplier X goes to project Y and category materials, and the next invoice from that supplier is classified the same way.

## Proof of concept

In scope: company and project P&L for a single user (the owner) on an installable mobile web app, Hebrew only, sign-in by SMS code, the three intake paths with Bank Hapoalim as the statement format, review and rules, auto-approve for high-confidence rows, two notifications (a Sunday summary and an end-of-day review nudge), Home periods of this month, last month, and year to date, a flat category list, optional project budgets, project and category pickers that still work with many jobs, and an Excel export for the accountant.

Out of scope: a desktop site, native iOS or Android apps, another language at launch, email and password, custom date ranges, a notification per transaction, a WhatsApp or email forwarding address, replacing the accountant's books, VAT filing, payroll, invoicing, Morning or iCount, open banking, other banks' statement files, credit-card company files, roles and permissions, multi-currency, progress billing and retention, and category sub-groups. A Hashavshevet-compatible export can follow the Excel export. Official double-entry books and the balance sheet stay with the accountant.

Default expense categories, preloaded: `חומרים` (materials), `קבלני משנה` (subcontractors), `עבודה` (labor), `ציוד והשכרה` (equipment and rental), `הובלה` (transport), `ביטוח` (insurance), `אחר` (other). Income categories: `תקבול מלקוח` (payment from a client), `הכנסה אחרת` (other income).

Success, for the proof of concept: a first project P&L within 15 minutes of signup; at least 80% of AI suggestions accepted unchanged after the first month; a daily review under 5 minutes; no transaction left untagged.

## Documentation

| Document | What it is |
| --- | --- |
| [Module 1 spec](docs/module-1-project-pnl/spec.md) | Product behavior, data model, scope, success metrics |
| [Calculations](docs/module-1-project-pnl/calculations.md) | Income, expenses, profit, margin, periods, rounding |
| [Screens](docs/module-1-project-pnl/screens.md) | One section per wireframe, with links to the detailed specs |
| [Settings (Draft)](docs/module-1-project-pnl/settings.md) | Proposed Settings screen, not approved |
| [Wireframes](docs/module-1-project-pnl/wireframes/README.md) | PNG files, version, and approved / superseded status |
| [Decisions](docs/decisions/README.md) | Decision records 0001–0020 and the record format |
| [Open questions](docs/open-questions.md) | What is not decided yet |
| [Changelog](docs/changelog.md) | Dated log of documentation changes |
| [Contributing](CONTRIBUTING.md) | How to change docs, decisions, and wireframes |

The approved screen set is project, review, add, the projects list, the v2 change sheet, categories, and upload results. Home v3 (three periods and comparison arrows) and the onboarding, transaction detail, split, unpaid, and notification wireframes are in the repo and pending owner approval. Earlier Home and change-sheet images are kept and marked superseded.
