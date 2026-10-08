# A loan payment can carry fees, cover several installments, or take exact parts

**Date:** 2026-10-08
**Status:** Accepted (owner approved the FLOW-106 plan, 2026-10-08)

## Context

[0088](0088-loans.md) splits a loan payment into interest, escrow and principal from the schedule row for the line's date, and [0128](0128-loan-part-categories.md) lets a loan name a category for each part. Real payments do not always fit one schedule row. A servicer charges fees in the same debit, a late borrower pays two or three months at once, and the owner sometimes already knows the exact split from the lender's statement. For example, a catch-up payment of $4,000.00 might be principal 1,300.00, escrow 1,200.00 and fees 1,500.00, with no interest. This is FLOW-106 part 3.

## Decision

- `loan_split_part` gets a fourth value, `fees`. A split is interest, escrow and principal once each, plus at most one fees part, which must be above zero (`loan_split_incomplete` otherwise, from the app and MCP alike). The balance still counts principal only.
- **Fees have no default category (the owner's decision, 2026-10-08).** The user says where fees go each time: the attach call's `fees_category_id` first, then the loan's `loans.fees_category_id`. With neither, the attach is `refused` / `fees category required`, from the database and pre-checked by the MCP tool. The plan's "company's loan-costs category" default does not exist: no such category is seeded, and there is no keyed fees category. An earlier draft of this record filed fees under the loan's interest category by default; that fallback is gone. Interest, escrow and principal keep their categories as in 0128: the loan's own, else the keyed defaults.
- `loans.fees_category_id` is optional, built like the other three (same company, cleared when the category is deleted). Setting it, for example to a closing-costs category, files the fees of later payments there unless the call names another.
- A fees category is any expense category, counted in the P&L or kept out, whose `loan_part` is null or `interest` (`private.loan_part_category_ok`), so the keyed interest category also takes fees. The loans trigger and the check on a split hold this rule. Fees are exempt from the P&L-flip check (`loan category is fixed`): a category holding fees, or that a loan names for fees, may flip sides freely, and each fees part follows its category's flag. This amends the rule of [0128](0128-loan-part-categories.md) for the new part.
- `private.pnl_lines` counts a 4-part split by its parts like a 3-part one, so each fees part counts or stays out by its own category, like the other parts. `get_loan_split` lists the parts as interest, escrow, principal, then fees.
- MCP `attach_loan_payment` takes three optional inputs:
  - `installments` (1 to 12): the payment covers that many schedule rows from the first one not yet paid, the first row whose scheduled principal through it is more than the principal already paid (the loan's principal less its balance). The scheduled figures are the sums of those rows; the split works as before (principal takes what is left over, a shortfall comes out of principal, then escrow, then interest). Rows past the schedule are `refused` / `not enough schedule rows`. Without it, the row for the line's date is used, as today.
  - `fees` (an amount above zero, at most two decimals): taken off the line first; the rest splits as usual. A line smaller than the fees is `refused` / `fees exceed the line`.
  - `fees_category_id` (a category id): this payment's fees category, allowed only when the payment has fees (`fees` or `parts.fees`), else `validation`. One that does not fit is `refused` / `category does not fit the loan part`; another company's or an unknown one is `refused` / `category not found`. It reaches the database as `category_id` on the fees part, so it is part of the idempotency hash.
  - `parts` (`interest`, `escrow`, `principal`, optional `fees`, each with at most two decimals, else `validation`): used exactly as given. They must add up to the line, or it is `refused` / `parts don't add up`. They cannot be combined with `installments` or `fees` (`validation`). The scheduled figures still come from the row for the date, for comparison; scheduled fees equal the fees.
  - The response lists every part, fees too.
  - A replay with the same idempotency key rebuilds the same parts: when the line is already split on this loan, its principal is added back to the balance before the first unpaid row is found.
- MCP `update_loan` takes `fees_category_id` (a category id, or null to clear it), with the refusals of 0128; undo restores it. `list_loans` returns `fees_category_id` and `fees_category_name`.
- Undo of `loan_split` removes all the parts of a payment, four as well as three.

## Alternatives rejected

- A default for fees (the loan's interest category, or a seeded loan-costs category): the owner wants every payment's fees placed on purpose, because they belong in different places (a servicer's fee, closing costs).
- Fees only in the P&L: closing costs and similar fees are kept out by default, and the owner maps fees there.
- Several lines for a multi-installment payment: the bank sends one debit.
- Rounding or spreading a mismatch in exact parts: the owner gives exact parts because they are known; a mismatch is a typo to fix.

## Consequences

The bookkeeping agent can record the lender's own split, fees included, and catch up on missed months in one attach, naming the fees category on the call or once on the loan. The app's own match still writes the three schedule parts; it shows a fees part (עמלות, "fees") when the MCP wrote one, and its one-tap correction keeps the fees amount. Setting `fees_category_id` from the loan sheet goes to the Mercury UI thread.
