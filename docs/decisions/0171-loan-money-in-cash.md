# Loan money counts in cash by default

**Date:** 2026-10-10
**Status:** Accepted (owner's card, 2026-10-10 08:45Z, relayed by the lane manager; FLOW-416)

## Context

[0168](0168-cash-flow-view.md) left money received from a loan out of the cash view (תזרים) by default. Every company got an income category, כסף שהתקבל מהלוואות, out of the P&L and out of cash, and `private.non_cash_category` started any new category named "loan proceeds" or כסף שהתקבל מהלוואות out of cash. The owner decided that a new company should count that money in cash, since it is money that came into the bank.

## Decision

1. **New companies.** The new-company seed (`private.seed_loan_money_category`) inserts כסף שהתקבל מהלוואות in cash. It stays out of the P&L.
2. **New categories.** `private.non_cash_category` no longer lists the loan money names, so a category created later as "loan proceeds" or כסף שהתקבל מהלוואות also starts in cash. Both העברות categories, internal transfers in and out, and credit card bill payments still start out.
3. **Existing companies.** Nothing is backfilled. A company whose loan money category is out of cash keeps it out until the owner switches it (`set_category_cash`, or the category's switch in the app).

## Alternatives rejected

- **Flip every company.** The owner asked for the new default only. Existing companies keep the setting they have, so their cash figures don't change under them.

## Consequences

- A new company's נכנס includes loan money, and its left-out figures no longer list it.
- Two companies can treat the same money differently until the owner of the older one switches it.
- `private.dedupe_loan_money_categories` (migration `20261013210638`) is unchanged. It only ran once, for existing companies.
