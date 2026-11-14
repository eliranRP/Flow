# A refinance closing's rental costs are not the renovation's holding

**Date:** 2026-11-14
**Status:** Accepted (owner, 2026-11-14: "Follow the book", on a renovation whose holding counted the property taxes, insurance and escrow reserves its refinance closing paid for the rental year)
**Amends:** [0261](0261-roi-and-deal-metrics.md)

## Context

A renovation's net profit (0261) counts the holding costs paid before the first rent. A property kept as a rental is usually refinanced before or around its first rent (a BRRRR, *Real Estate by the Numbers* Ch 47). That closing pays the old loan off, and it also pays for the rental: the new loan's costs, the year's property taxes and insurance, and the new loan's escrow reserves. Paid before the first rent, all of it counted as the renovation's holding.

## Decision

- **A refinance transaction** holds a property's loan proceeds of 80% or more of a loan that starts more than 75 days after the purchase closing (so not the purchase loan, 0246). The proceeds are dated after that closing, from 120 days before the loan's start to 30 days after it (`private.refinance_transactions`).
- **In it, only interest and loan fees stay holding.** These are the old loan's payoff interest and exit fees. Every other holding line leaves `deal.holding_minor`, and leaves the `deal_holding` lines that add up to it: property taxes, insurance and escrow reserves. Following the book (Ch 45), these belong to the rental: its operating expenses, and escrow is a reserve rather than a cost.
- **The new loan's own costs** (points, underwriting, lender title, appraisal, prepaid interest) are filed by the owner in a financing category. They then reduce the refinance's net proceeds, as Ch 47 has it: loan proceeds = new loan − closing costs.
- **Costs paid between a refinance and the first rent** in their own transactions stay holding: utilities and interest while the property is vacant.
- **The money in is unchanged.** It counts every line.

## Consequences

- A rental's net profit no longer carries its first year's taxes, insurance and escrow.
- A refinance whose proceeds reach the bank netted below 80% of the loan is not detected. Its costs are then already inside the net proceeds.
- Property taxes paid at the refinance move whole, even when part of the period they cover was during the renovation.
