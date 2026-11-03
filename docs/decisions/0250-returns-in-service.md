# A newly let rental's total return, tax savings and appreciation; what a loan paid at closing

**Date:** 2026-11-03
**Status:** Accepted (owner, 2026-11-03: "Fix all three" and "Add a field per loan", after the Wickliff purchase price read $300,375 against a typed $251,000)
**Amends:** [0246](0246-sub2-price-and-one-unit.md), [0249](0249-returns-from-first-rent.md)

## Context

0249 scaled cash on cash, cap rate and cash flow per unit from a first rent inside the period. Three figures still ran over the whole period, and one rule over-counted the price:

- The total return divided weeks of cash flow and principal as a year.
- Tax savings counted depreciation for days before the property was bought.
- Appreciation needed a value on or before the period's start. A property bought this year has none, and every property had one value, so appreciation was missing everywhere.
- A loan paid out at closing without passing through the bank counted its whole principal into the price (0246). A hard-money loan that holds part back for renovation draws over-counted the price, and that renovation may be counted again as rehab.

## Decision

- **The total return** (`total_bp`) scales over the days since a first rent inside the period, like the other per-year metrics.
- **Tax savings** run while the property is in service, from the first rent, the date it was placed in service. There are none before the first rent, and a property first let in October saves for the days since.
- **Appreciation**, with no value on or before the period's start, runs from the first value recorded in the period to the last. With one value alone it is missing (`value_history`, "חסר · עדכון שווי נוסף") until a second is set. The purchase price is never the start: purchase to value is the forced equity of the renovation, shown on its own (השבחה צפויה).
- **`loans.closing_paid_minor`** is what the settlement statement shows the loan paid at closing: 0 to the principal, null for the whole principal (the default). It is set with `set_loan_closing_paid` (owner) and MCP `set_loan_closing_paid` (undo kind `loan_closing_paid`). A loan paid out at closing adds that amount to the price, and `taken_over_loans` names `closing_paid_minor` and `counted_minor`. The purchase page shows the calculation: the bank lines + each loan at closing = the purchase price.

## Consequences

- The total return of a newly let rental reads what it earns once let, and its tax savings no longer run before it was owned.
- Appreciation shows once a property has two values; until then it says what is needed.
- A hard-money loan's purchase price follows its settlement statement once the owner enters it.
