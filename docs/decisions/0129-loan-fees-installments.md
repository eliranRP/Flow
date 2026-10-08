# A loan payment can carry fees, cover several installments, or take exact parts

**Date:** 2026-10-08
**Status:** Accepted (owner approved the FLOW-106 plan, 2026-10-08)

## Context

[0088](0088-loans.md) splits a loan payment into interest, escrow and principal from the schedule row for the line's date, and [0128](0128-loan-part-categories.md) lets a loan name a category for each part. Real payments do not always fit one schedule row. A servicer charges fees in the same debit, a late borrower pays two or three months at once, and the owner sometimes already knows the exact split from the lender's statement. For example, a catch-up payment of $4,000.00 might be principal 1,300.00, escrow 1,200.00 and fees 1,500.00, with no interest. This is FLOW-106 part 3.

## Decision

- `loan_split_part` gets a fourth value, `fees`. A split is interest, escrow and principal once each, plus at most one fees part, which must be above zero (`loan_split_incomplete` otherwise, from the app and MCP alike). The balance still counts principal only.
- `loans.fees_category_id` is optional, built like the other three (same company, cleared when the category is deleted). Null files fees under the category the payment's interest goes to: the loan's own interest category, else the keyed interest default. There is no keyed fees category.
- A fees category is an expense category counted in the P&L whose `loan_part` is null or `interest` (`private.loan_part_category_ok`). The loans trigger, the check on a split, and the P&L-flip check on categories (`loan category is fixed`) hold it, with the same `for share` locks as 0128.
- `private.pnl_lines` counts a 4-part split by its parts like a 3-part one, so fees count in the P&L under their category, like interest. `get_loan_split` lists the parts as interest, escrow, principal, then fees.
- MCP `attach_loan_payment` takes three optional inputs:
  - `installments` (1 to 12): the payment covers that many schedule rows from the first one not yet paid, the first row whose scheduled principal through it is more than the principal already paid (the loan's principal less its balance). The scheduled figures are the sums of those rows; the split works as before (principal takes what is left over, a shortfall comes out of principal, then escrow, then interest). Rows past the schedule are `refused` / `not enough schedule rows`. Without it, the row for the line's date is used, as today.
  - `fees` (an amount above zero): taken off the line first; the rest splits as usual. A line smaller than the fees is `refused` / `fees exceed the line`.
  - `parts` (`interest`, `escrow`, `principal`, optional `fees`): used exactly as given. They must add up to the line, or it is `refused` / `parts don't add up`. They cannot be combined with `installments` or `fees` (`validation`). The scheduled figures still come from the row for the date, for comparison; scheduled fees equal the fees.
  - The response lists every part, fees too.
- MCP `update_loan` takes `fees_category_id` (a category id, or null for the default), with the refusals of 0128; undo restores it. `list_loans` returns `fees_category_id` and `fees_category_name`.
- Undo of `loan_split` removes all the parts of a payment, four as well as three.

## Alternatives rejected

- A keyed fees category seeded for every company: most loans have no fees, and filing them with the interest keeps the P&L the same as before by default.
- Fees counted outside the P&L: a servicer's fee is a cost; a fee that belongs elsewhere (closing costs) is mapped to that category.
- Several lines for a multi-installment payment: the bank sends one debit.
- Rounding or spreading a mismatch in exact parts: the owner gives exact parts because they are known; a mismatch is a typo to fix.

## Consequences

The bookkeeping agent can record the lender's own split, fees included, and catch up on missed months in one attach. The app's own match still writes the three schedule parts; it shows a fees part (עמלות, "fees") when the MCP wrote one, and its one-tap correction keeps the fees amount. Setting `fees_category_id` from the loan sheet goes to the Mercury UI thread.
