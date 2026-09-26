# Changelog

## 2026-09-26

Review and upload wireframes updated to match auto-approve and Bank Hapoalim.

- [03-review-v2.png](module-1-project-pnl/wireframes/03-review-v2.png) supersedes `03-review`. The card has no `אשר הכל` button. A strip at the top reads `12 אושרו אוטומטית`.
- [08-upload-results-v2.png](module-1-project-pnl/wireframes/08-upload-results-v2.png) supersedes `08-upload-results`. The sample file is `הפועלים_ספטמבר.xlsx`. The 33 invoice and rule matches are one collapsed `אושרו אוטומטית` group. The secondary approve button is gone.
- [overview-4.png](module-1-project-pnl/wireframes/overview-4.png) shows those two phones together.
- `wireframes/source/gen.py` is the generator for this set. `render.sh` also renders `03-review-v2`, `08-upload-results-v2`, and `overview-4`, and still writes PNGs into `wireframes/`.

## 2026-09-26

The product is named Flow. Detailed specs replace every `Detailed spec: TODO`.

- [README](../README.md) and [spec.md](module-1-project-pnl/spec.md) titles use Flow.
- [calculations.md](module-1-project-pnl/calculations.md) defines income, expenses, profit, margin, the three period filters, what counts (approved and paid, cash basis, net of VAT), overhead, and rounding in agorot.
- Per-screen specs for the eight product screens: [Home](module-1-project-pnl/screens/01-home.md), [Project](module-1-project-pnl/screens/02-project.md), [Review](module-1-project-pnl/screens/03-review.md), [Add](module-1-project-pnl/screens/04-add.md), [Projects](module-1-project-pnl/screens/05-projects.md), [Change sheet](module-1-project-pnl/screens/06-change-sheet.md), [Categories](module-1-project-pnl/screens/07-categories.md), [Upload results](module-1-project-pnl/screens/08-upload-results.md). Superseded wireframes and overview boards point at those specs and are not built.
- [settings.md](module-1-project-pnl/settings.md) is a Draft proposal (company, VAT, categories, rules, Excel export, Hapoalim account, auto-approve toggle). Settings contents stay open. The toggle is not approved, because [0011](decisions/0011-auto-approve-high-confidence.md) rejected opt-in auto-approve.
- New open items that the spec refused to guess: Hapoalim column map, confirming every invoice photo, export of a previous project after a move, and two phones offline.

## 2026-09-26

Owner answers, recorded as [0011](decisions/0011-auto-approve-high-confidence.md) through [0014](decisions/0014-optional-project-budget.md). All four are Accepted.

- **0011.** High-confidence rows (bank row matched to an existing invoice, or an existing supplier rule) auto-approve, skip the review queue, and show up in a short summary the owner can reopen.
- **0012.** Statement import in the proof of concept is Bank Hapoalim (`בנק הפועלים`) only. Other banks and credit-card companies come later.
- **0013.** Single user: the business owner. No roles or permissions. An office manager is a later option.
- **0014.** Project budget stays optional. Budget versus actual appears on the project screen only when a budget is set.
- [spec.md](module-1-project-pnl/spec.md) follows these four. The one-pager and the screen notes that still described the questions as open now point at the records. [0006](decisions/0006-confirm-not-type.md) and [0007](decisions/0007-bank-statement-is-primary-input.md) stay Accepted and cross-link 0011 and 0012.
- Removed the answered items from [open questions](open-questions.md). Still open: Settings screen contents, the per-screen detailed spec, pricing, and when credit-card statement support starts.

## 2026-09-26

Initial product documentation for Module 1, Project P&L.

- Product one-pager and documentation index in `README.md`.
- Module spec: cash-basis company and project P&L, intake, review and rules, categories, scale, data model, export, out of scope, and success metrics.
- Screen notes for every wireframe, each with a `Detailed spec: TODO` subsection. Approved set: `01-home-v2`, `02-project`, `03-review`, `04-add`, `05-projects`, `06-change-sheet-v2`, `07-categories`, `08-upload-results`, plus the three overview boards. `01-home` and `06-change-sheet` are kept and marked superseded.
- Wireframe PNGs and the HTML generator (`wireframes/source/gen.py`, `wireframes/source/render.sh`). `render.sh` writes PNGs into `wireframes/`. The uploaded script wrote them into `/workspace/wireframes-pnl`.
- Decision records [0001](decisions/0001-management-tool-alongside-accounting.md) through [0010](decisions/0010-docs-are-the-source-of-truth.md), all accepted on this date.
- Open questions and the documentation contributing guide.
