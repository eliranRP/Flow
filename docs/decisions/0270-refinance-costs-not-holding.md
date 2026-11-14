# A refinance closing's rental costs are not the renovation's holding

**Date:** 2026-11-14
**Status:** Accepted (owner, 2026-11-14: "Follow the book", on a renovation whose holding counted the property taxes, insurance and escrow reserves its refinance closing paid for the rental year)
**Amends:** [0261](0261-roi-and-deal-metrics.md)

## Context

A renovation's net profit (0261) counts the holding costs paid before the first rent. A property kept as a rental is usually refinanced before or around its first rent (a BRRRR, *Real Estate by the Numbers* Ch 47). That closing pays the old loan off, and it also pays for the rental: the new loan's costs, the year's property taxes and insurance, and the new loan's escrow reserves. Paid before the first rent, all of it counted as the renovation's holding.

## Decision

- **A refinance transaction** holds a property's loan proceeds of 80% or more of a loan that starts more than 75 days after the purchase closing (so not the purchase loan, 0246). The proceeds are dated after that closing, from 120 days before the loan's start to 30 days after it (`private.refinance_transactions`).
- **In it, only interest stays holding.** The old loan's payoff interest and finance charges (exit fee, payoff fees) are filed as interest. Every other holding line leaves `deal.holding_minor`, and leaves the `deal_holding` lines that add up to it:
  - The new loan's closing costs: points, underwriting, lender title, and its prepaid interest, filed as loan fees. Ch 47: loan proceeds = new loan − closing costs.
  - Property taxes and insurance for the rental year, which are the rental's operating expenses (Ch 45).
  - The new loan's escrow reserves, a reserve rather than a cost.
- **Costs paid between a refinance and the first rent** in their own transactions stay holding: utilities and interest while the property is vacant.
- **The money in is unchanged.** It counts every line.

## Consequences

- A rental's net profit no longer carries its first year's taxes, insurance and escrow.
- A refinance whose proceeds reach the bank netted below 80% of the loan is not detected. Its costs are then already inside the net proceeds.
- Property taxes paid at the refinance move whole, even when part of the period they cover was during the renovation.
- A new-loan cost paid before the closing in its own transaction (an appraisal) stays holding.
