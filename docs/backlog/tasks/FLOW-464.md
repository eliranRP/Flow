<a id="flow-464"></a>
# FLOW-464 · A newly let rental's metrics: a year from the first rent
- **Type:** SQL + UI · **Status:** claimed (dev lane, 2026-11-03, claude/compassionate-curie-mfpavd) · **Depends on:** [FLOW-453](FLOW-453.md) · **Source:** the owner, 2026-11-03, on a rental first let three weeks before: a cap rate of 1.6% and a DSCR with "אין תשלומים". After a worked example and the case of a six-month search for a tenant: "yes build it and deploy".
- [ ] A first rent inside the period scales cash on cash, cap rate and cash flow per unit over the days since it (decision 0249); empty months after it still count; the total keeps the period.
- [ ] The card's hint says "מחושב לשנה"; the metric page names the first rent and the days, and its "=" row divides the figure for a year. DSCR with no payment since the first rent reads "אין תשלומים עדיין".
- **Acceptance:** pgTAP for the scaled metrics and for a first rent before the period; unit tests for the captions and the result row; a story; the real rentals checked after the deploy.
