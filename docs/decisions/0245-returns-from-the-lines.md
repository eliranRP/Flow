# A property's returns from its real lines: the first rent, holding costs and the net loan proceeds

**Date:** 2026-11-01
**Status:** Accepted (owner, 2026-11-01, on a real rental after the FLOW-451 deploy: "for total cost it seems we miss the loan costs" and "how do you treat the −14k? this is more money we put into the deal"; answers on cards the same day: the net loan proceeds, money in from the actual lines and the purchase price too, "∞" when all the cash came out, the first rent payment as the switch (option A), "show the user the holding costs as a separate line")
**Amends:** [0244](0244-property-returns.md)

## Context

0244 built money in the deal from the typed purchase price, rehab and the principal of the project's loans, and counted every cost of the period in the cash flow. On a real rental bought with a cash-out refinance three things were off: the loan costs held back at closing were nowhere (only the net proceeds reach the bank), the initial renovation and the costs of holding the property before it was rented showed as a negative cash flow instead of money the owner put in, and a depreciation journal entry counted as an operating expense.

## Decision

- **Cash lines only.** A line the cash view leaves out (a journal entry such as depreciation, a category out of cash, the owner's switch) is in neither the statement nor the money in.
- **The first rent payment splits the property's life** (the owner's option A). Before it the owner is still investing; from it on the property earns. The statement counts only the lines from the first rent on; a period's costs before it are listed apart (`before_rent_minor`).
- **Money in the deal is built from the real lines**: what the property took from the owner that is not its running results, in four parts the screen shows:
  - acquisition: kept-out costs at any time (the purchase, closing costs);
  - renovation: rehab categories before the first rent;
  - holding costs: every other cost before the first rent (interest, insurance, utilities, a loan payment's parts), its own line as the owner asked;
  - financing: kept-out income at any time (the net loan proceeds, closing refunds), so loan costs held back at closing count, and a cash-out refinance after the rent lowers the money in, as the book's BRRRR does.
- **The purchase price comes from the lines** (the acquisition lines), the typed figure only when there are none; it feeds forced equity and the building cost.
- **All the cash out.** Money in at or below zero: `all_cash_out`, and the screen shows "∞ · כל הכסף חזר" with how much more came out than went in; the per-cent figures (cash-on-cash, total return) are null.
- A loan payment's principal, interest and fees are debt service from the first rent on and holding costs before it.

## Consequences

- The loan amount no longer enters the money in; the loan-proceeds line does. A loan whose proceeds are not filed to the project (paid straight to a seller or a title company) is not subtracted until such a line exists.
- Kept-out income at any time counts as financing: a tenant's security deposit filed to the project lowers the money in while it is held.
