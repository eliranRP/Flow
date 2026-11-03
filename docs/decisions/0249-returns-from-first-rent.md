# The per-year metrics of a property rented for less than the period

**Date:** 2026-11-03
**Status:** Accepted (owner, 2026-11-03: "yes build it and deploy", after a worked example and the case of a property that took six months to find its first tenant)
**Amends:** [0245](0245-returns-from-the-lines.md)

## Context

The statement starts at the first rent (0245): what came before it is money in the deal. The per-year metrics still scaled over the whole period, the last 12 months by default. A rental first let three weeks before the end of the period showed a cap rate of 1.6%: three weeks of profit over a year's value.

## Decision

- When the first rent falls inside the period, cash on cash, cap rate and the cash flow per unit scale to a year over the days from the first rent to the end of the period (`earning_days`), not the whole period. `annualized_from` names the first rent then, and is null when the metrics cover the whole period.
- Months empty after the first rent still count: the scaling averages over every day since it, not just the months with rent. A tenant who leaves and a house empty for months lower the figures, as they should.
- DSCR is a ratio and is not scaled. With no loan payment since the first rent, it reads "אין תשלומים עדיין".
- The total return keeps the whole period, because the principal, appreciation and tax savings run over all of it.
- The app says so: a scaled metric's hint ends "מחושב לשנה". Its page names the first rent and the days ("מהשכר הראשון ב־… · N ימים, מחושב לשנה"), and its "=" row divides the figure for a year.

## Consequences

- A newly let rental reads what it earns once let, not a fraction of it. A figure from a few weeks is an estimate, and its page says how many days it rests on.
- Once the first rent is a full period back, nothing changes.
