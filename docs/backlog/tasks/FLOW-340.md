<a id="flow-340"></a>
# FLOW-340 · A lighter השקעה card on the project page
- **Type:** PLAN FIRST · **Status:** done (option C, #338) · **Depends on:** FLOW-404 (#223) · **Source:** mobile UI/UX review cycle 6 (2026-10-09, deploy 3f718f2), shots in the project's reviews/ui-ux-cycle-6/
- **What:** The project page now holds 7 figures; the השקעה card adds two "X = Y" captions under the equities (one wraps to two lines), a bordered card with an inner hairline grid, and the page runs 1.8 screens at 393. That goes against the light-screens rule (§2.1, §5). Options: (A) drop the captions and inner hairlines and keep the card; (B) a one-row "השקעה · הון נוכחי ₪850,000 ›" that opens the full card in a sheet.
- **Acceptance:** owner's choice on a card with 390px PNGs of each option; a design log entry.
- **Plan (option C, the owner's pick 2026-10-09: a short project page; UI lane 1):**
  - The band keeps the name, the period bar and the profit figure only; the income and expense figures move to rows.
  - Below the band, one list of one-line rows, each with its figure and a chevron: הכנסות (opens Search for the project's income in the period), הוצאות (`/projects/:id/expenses`: the budget bar, the categories and the expected months), השקעה (`/projects/:id/investment`: the full card; the row shows "הון נוכחי ₪X" and is left out for the overhead project or with no figures), הלוואות (open loans only; one loan opens its page, several open `/projects/:id/loans`), תנועות (`/projects/:id/transactions`: the project's lines, a split line showing the project's part), לפי חודש (`/projects/:id/months`).
  - The overhead switch moves into the ⋯ menu, with "נתוני השקעה" there when the השקעה row is hidden.
  - Each section is its own screen with Back to the project; the period travels in the URL. `_redirects` gets the four routes.
  - The page fits one screen at 390x844 with two loans and investment data.
  - Merges only after the owner sees real-app shots at 390 and 320 (light and one dark).
