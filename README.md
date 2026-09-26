# Project P&L

A mobile-first way for Israeli project-based businesses to see project profit and loss: income, expenses, and the bottom line. The proof of concept is for owners of small and mid-size construction contractors. The same model is meant to fit any project-based business after that.

This repository is the product home. It holds documentation and design artifacts only. There is no application code yet.

Amounts are in shekels (₪), shown net of VAT, with VAT tracked beside them. The interface is Hebrew, right to left. The owner confirms what the product suggests instead of typing a classification for every shekel.

## What the owner gets

Two levels, and they always add up:

- **Company.** Every project, plus company overhead (`הוצאות כלליות`).
- **Project.** One job (one segment of the business), with its own income, expenses, and profit.

Every shekel sits on exactly one project, or on overhead. Projects plus overhead equal the company total.

Money is counted on a cash basis. A bank row, or a cash or cheque payment the owner records, is what enters the P&L. An invoice is the supporting document. An invoice with no matching payment stays unpaid and out of the P&L until a statement row matches it, or the owner marks it paid.

The owner is on site most of the day, so the product is a phone UI: bottom navigation in the thumb zone, large tap targets, and a review queue that can be cleared in a few taps.

## How data gets in

1. A photo or PDF of an expense invoice. The product reads supplier, amount, VAT, date, and invoice number, and checks for a duplicate.
2. A bank or credit-card statement (Excel or CSV). Each row becomes a transaction. Transfers between the company's own accounts are removed.
3. Manual entry, for cash and cheques.

Suggestions follow a fixed order: link a bank row to an existing invoice (amount, date, supplier), then apply a learned supplier rule, then an AI guess. A deposit from a client is suggested onto that client's project. A high-confidence match (an invoice or a learned rule) is pre-approved and can be cleared with "Approve all". Everything else waits in the review queue. Only approved transactions appear in reports. A pending-count banner stays visible while the numbers can still move.

Correcting a suggestion can become a rule ("remember for this supplier" is on by default): supplier X goes to project Y and category materials, and the next invoice from that supplier is classified the same way.

## Proof of concept

In scope: company and project P&L, the three intake paths, review and rules, a flat category list, project and category pickers that still work with many jobs, and an Excel export for the accountant.

Out of scope: replacing the accountant's books, VAT filing, payroll, invoicing, Morning or iCount, open banking, multi-currency, progress billing and retention, and category sub-groups. A Hashavshevet-compatible export can follow the Excel export. Official double-entry books and the balance sheet stay with the accountant.

Default expense categories, preloaded: `חומרים` (materials), `קבלני משנה` (subcontractors), `עבודה` (labor), `ציוד והשכרה` (equipment and rental), `הובלה` (transport), `ביטוח` (insurance), `אחר` (other). Income categories: `תקבול מלקוח` (payment from a client), `הכנסה אחרת` (other income).

Success, for the proof of concept: a first project P&L within 15 minutes of signup; at least 80% of AI suggestions accepted unchanged after the first month; a daily review under 5 minutes; no transaction left untagged.

## Documentation

| Document | What it is |
| --- | --- |
| [Module 1 spec](docs/module-1-project-pnl/spec.md) | Product behavior, data model, scope, success metrics |
| [Screens](docs/module-1-project-pnl/screens.md) | One section per wireframe: purpose, elements, interactions |
| [Wireframes](docs/module-1-project-pnl/wireframes/README.md) | PNG files, version, and approved / superseded status |
| [Decisions](docs/decisions/README.md) | Decision records 0001–0010 and the record format |
| [Open questions](docs/open-questions.md) | What is not decided yet |
| [Changelog](docs/changelog.md) | Dated log of documentation changes |
| [Contributing](CONTRIBUTING.md) | How to change docs, decisions, and wireframes |

The current screen set is the v2 Home and the v2 change sheet, plus project, review, add, projects list, categories, and upload results. The earlier Home and change sheet are kept and marked superseded.
