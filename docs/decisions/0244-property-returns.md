# A property's returns, by the book, with the lines behind every figure

**Date:** 2026-11-01
**Status:** Accepted (owner, 2026-11-01: concept A of three on the design board, then "approved, you can start implementing"; answers on cards the same day: appreciation from a value history, land value per property and a tax bracket per company, a units field, the page on every project)
**Builds on:** [0143](0143-project-investment.md) (purchase, ARV, value, rehab and equity)

## Context

The owner analyses rentals, BRRRR and Subject-To deals the way *Real Estate by the Numbers* (J Scott and D Meyer) does: a property statement (income, operating expenses, NOI, debt service, CapEx, cash flow), the four ways real estate returns money (cash flow, loan paydown, appreciation, tax benefits) on the money in the deal, and a few metrics (cash-on-cash, cap rate, DSCR). They asked to see every number broken into its parts and the transactions behind it, and to fix a miscategorised transaction from there.

## Decision

**One read, nothing guessed.** `get_property_returns(project, from, to)` (default the last 12 months) returns the statement, the four sources and their total, the three equity figures and the metrics. A figure whose input is missing is null and `missing` names the input; the screen shows "חסר · הוספה" for it, like a missing ARV. The total return adds the sources it has: a source whose input is missing (appreciation, tax savings) is left out of it, not counted as zero, and the screen shows that source as "חסר" (the owner, 2026-11-01: "the total return leaves it out").

**Which line a category feeds comes from what Flow stores**, so there is no new mapping to keep:
- income categories → income (kept-out income → not counted);
- the principal, interest and fees parts of a loan payment → debt service;
- a category switched into rehab (`categories.rehab = true`) → CapEx;
- a kept-out category → not counted (the purchase, transfers);
- the rest → operating expenses, a loan's escrow part (taxes and insurance) included, as the book has it.
CapEx is real spending: Flow keeps no reserve, so none is invented. A category on the default (rehab null) counts as an operating expense here, even though 0143's rehab total counts it; switch it into rehab to make it CapEx.

**The figures.**
- Cash flow = NOI + debt service + CapEx (the book puts CapEx below NOI).
- Money in the deal = purchase + rehab so far − the principal of the project's loans; a refinanced loan counts once, through the loan that replaced it.
- Appreciation = the value on or before the period's end − the value on or before its start, from a new value history (`project_values`), kept by a trigger: every value set is kept by its date, a value for an earlier date drops the later ones, and clearing the value drops its entry and the later ones, so an undo leaves no value behind. Until there is a value at the start, appreciation is missing.
- Tax savings = (purchase + rehab − land) ÷ 27.5 years × the owner's tax bracket, for the days of the period. Land is a new figure on the project (`land_minor`), the bracket a new one on the company (`tax_bracket_bp`). An estimate: depreciation is recaptured at a sale, and the accountant has the real figure.
- Cash flow per unit needs a new `units` figure on the project.
- Ratios are per year: cash-on-cash and the total on the money in the deal, cap rate on today's value; DSCR = NOI ÷ debt service.

**The lines behind a figure.** `get_property_return_lines(project, line, …)` pages the lines of one figure, optionally one category; `rehab` lists all time (the building cost). A line opens the existing transaction page, where its category or project changes with the existing pickers; nothing new is needed to fix a miscategorised line.

**MCP.** `get_property_returns`, `get_property_return_lines`, `set_tax_bracket` (undo kind `tax_bracket`), and `units` and `land_minor` on `set_project_investment` (undo kind `project_investment` puts them back too).

## Alternatives rejected

- **Appreciation averaged since purchase.** Needs a purchase date Flow does not have, and mixes forced and market gains.
- **A mapping table from category to statement line.** One more setting to keep; the rehab switch and the kept-out flag already say it.
- **A property switch on projects.** The owner chose to show the page on every project; a project without a purchase price reads "חסר" on the figures that need it.
- **Book benchmarks as defaults** (the 50% rule, a typical vacancy). The book itself calls them a sanity check, not an input.
