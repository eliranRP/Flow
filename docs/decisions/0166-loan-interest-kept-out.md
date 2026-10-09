# A loan's interest and escrow may stay out of the P&L

**Date:** 2026-10-09
**Status:** Accepted (bookkeeping agent's request, relayed by the lane manager, FLOW-414)
**Amends:** [0128](0128-loan-part-categories.md) (the part rule and the P&L-flip check)

## Context

[0128](0128-loan-part-categories.md) let a loan name its own category per part, but interest and escrow had to sit in a category counted in the P&L. A hard-money loan that funds a rehab or a flip carries interest the owner treats as part of the project's cost, not as an expense of the period. The bookkeeping agent could not file that interest: `update_loan` refused a kept-out category (`category does not fit the loan part`), and so did the attach and the app's split. Fees already work this way ([0130](0130-loan-fees-installments.md)).

## Decision

- `private.loan_part_category_ok`: interest, escrow and fees take any expense category, counted in the P&L or kept out. Principal still needs a kept-out one. A keyed loan category still takes only its own part (fees also the keyed interest one).
- `private.categories_loan_pnl_check`: a category holding principal, or named by a loan for principal, still cannot be counted in the P&L. A built-in (keyed) loan category in use keeps its side. Any other category holding interest or escrow may flip sides, and its parts follow it, as fees do.
- The P&L needs nothing new: each part already counts by its own category's flag ([0100](0100-loan-split-pnl.md)), so interest in a kept-out category drops out of profit.
- The app's part-category picker offers the same categories.

## Alternatives rejected

- A per-loan flag "interest kept out of profit": a second switch that says the same thing as the category's own flag, and two places to disagree. The category already carries the P&L side for every other line.
- Leaving interest counted and moving it out later with a journal entry: Flow has no journal, and the agent would have to correct every payment by hand.

## Consequences

A loan's interest can now leave the P&L without any per-loan setting: the owner (or the agent) points the loan's interest at a kept-out category such as a carrying-cost category, and later payments follow. Payments already attached keep their categories. Undo of a category mapping is refused only when the restored principal category is now counted in the P&L.
