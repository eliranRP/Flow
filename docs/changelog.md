# Changelog

## 2026-09-26

Decision [0021](decisions/0021-shared-costs-and-overhead.md), Accepted. Shared project costs are split. True overhead stays overhead.

- The split sheet can target every active project: equal, by that period's income share, or manual percent or shekels. The owner can save "split like this every month". The next payment from that payee arrives already split. Income-share rules recalculate each month. Equal uses whoever is active when the payment arrives.
- Office rent, the accountant, insurance, and the rest are not split into transactions. Home and the project screen get a view-only toggle, profit after overhead share, by each project's income share in the selected period. Stored lines and company totals stay as they are.
- Shares use largest remainder so they sum exactly. A project with no income gets none. If every project has no income, the allocation is unavailable and the after-overhead view is not shown.
- The Rule entity now includes a split rule, one per payee, replacing a one-project rule and replaced by one.
- Wireframes `11-split-v2`, `01-home-v4`, and `02-project-v2` are marked coming. They have no image.
- Open: should the after-overhead toggle be on by default?

## 2026-09-26

Wireframes for onboarding, transaction detail, split, unpaid invoices, notifications, and Home v3. All of these are **pending owner approval**.

- [01-home-v3.png](module-1-project-pnl/wireframes/01-home-v3.png) supersedes `01-home-v2`. Three periods (`החודש`, `חודש קודם`, `מתחילת השנה`). Comparison arrows where color means good or bad, not the arrow direction. A quiet unpaid line under the review banner (`3 חשבוניות לא שולמו · ₪23,400`).
- [09-onboarding.png](module-1-project-pnl/wireframes/09-onboarding.png): SMS sign-in, then company details (1/4), Hapoalim export and upload (2/4), proposed projects (3/4), install and the two notifications (4/4).
- [10-transaction-detail.png](module-1-project-pnl/wireframes/10-transaction-detail.png), [11-split.png](module-1-project-pnl/wireframes/11-split.png), [12-unpaid.png](module-1-project-pnl/wireframes/12-unpaid.png), [13-notifications.png](module-1-project-pnl/wireframes/13-notifications.png).
- [overview-5.png](module-1-project-pnl/wireframes/overview-5.png) shows detail, split, unpaid, and Home v3.
- `wireframes/source/gen.py` is the generator for this set. `render.sh` also renders the new names, and still writes PNGs into `wireframes/`.
- [screens.md](module-1-project-pnl/screens.md) replaces the placeholders with purpose, elements, interactions, states, edge cases, and acceptance criteria taken from these images. Differences that are not yet decisions: a category on each split line, what `מחק` removes, what Home's `☰` opens, and the business-type list on onboarding (two options on the image, three in the Settings draft).

## 2026-09-26

Decisions [0015](decisions/0015-installable-mobile-web-app.md) through [0020](decisions/0020-capture-from-the-phone.md), all Accepted.

- **0015.** This phase is an installable mobile web app. No desktop version, and no native iOS or Android app. Onboarding explains the Hapoalim export onto the phone and includes an install step, which is what makes iPhone notifications possible.
- **0016.** Hebrew only. No second language at launch.
- **0017.** Sign-in is a mobile number plus an SMS code. Email and password are rejected.
- **0018.** Two notifications: Sunday 08:00 Israel time (last week's profit and one project alert, opens Home) and 18:00 only when review is waiting (count and estimated minutes, opens Review). No per-transaction notification.
- **0019.** Home periods are this month, last month, and year to date. This month and last month show an up or down percent versus the previous month. The project screen stays project to date. No custom range. The year-to-date arrow is not shown until its baseline is decided. [01-home-v2](module-1-project-pnl/wireframes/01-home-v2.png) still draws two segments and is not superseded.
- **0020.** Capture is several photos in a row, or a PDF or image from files on the phone. Android share-to-app works. iPhone share-to-app does not. A WhatsApp or email forwarding address is after the proof of concept.
- [spec.md](module-1-project-pnl/spec.md), [calculations.md](module-1-project-pnl/calculations.md), [Home](module-1-project-pnl/screens/01-home.md), and [Add](module-1-project-pnl/screens/04-add.md) follow these. [screens.md](module-1-project-pnl/screens.md) has placeholder sections for onboarding, transaction detail, the split sheet, unpaid invoices, and notifications. Those five have no image and no field spec.
- Still open, including the leftovers from these six records: Settings contents, pricing, credit-card timing, the Hapoalim column map, confirming every invoice photo, export of a previous project, two phones offline, changing the phone number, which weekly alert wins, the minute estimate, the year-to-date baseline, the forwarding address, and how onboarding proposes projects.

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
