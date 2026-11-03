# Money in counts the cash added to cover losses; ∞ only for a gain

**Date:** 2026-11-03
**Status:** Accepted (owner, 2026-11-03, on a real rental after a cash-out refinance: "If the cash flow is negative and we draw 34k more than what we put in … the 6k negative cashflow should be represented somehow, right now the return will be infinite even if we negative cashflow to the point we start putting money more than we draw"; then "yes do both" to the two changes below)
**Amends:** [0245](0245-returns-from-the-lines.md)

## Context

0245 fixes the money in the deal at what the property took before the first rent, less what the loans brought back. A cash-out refinance can bring that below zero, and then the total return shows ∞ ("כל הכסף חזר"), with no per-cent figure. Two things were wrong on a rental whose cash flow is negative:

- The money the owner adds every month to cover the loss never counted as money in. The cash taken out runs down, then the owner's own money goes in again, and the screen still said all the cash came out.
- ∞ was shown whatever the deal earned. A rental losing money on nothing in is a loss, not an infinite return.

## Decision

- **Money in counts the shortfall.** `money_in_parts.shortfall_minor` is the running cash flow since the first rent (income, operating expenses, loan payments and CapEx, all time) when it is below zero, else 0. Money in adds it, so it rises from below zero toward the owner's own money again as the losses add up. A positive running cash flow does not lower money in: it is the return, not a return of capital.
- **How long the cash out lasts.** With money in below zero and a negative cash flow in the period, `equity.cash_out_cover_months` is the whole months of that cash flow, at its yearly pace, the cash still out covers. The card's meta adds "הכסף שיצא מכסה עוד כ־5 שנים של תזרים שלילי".
- **∞ only for a gain.** With all the cash out, the total return reads ∞ only when the total is zero or more. A negative total reads as the loss in money (the period's total, red), with the same meta. Cash on cash reads ∞ only when the cash flow is not negative; a negative one reads as the cash flow for a year.
- The money in page lists "כיסוי תזרים שלילי · מאז השכר הראשון" as its own row when there is a shortfall. The row opens nothing: it is the net of the cash-flow lines, which the cash flow's own page lists.

## Consequences

- A rental with all the cash out and a negative cash flow shows what it loses and how long the cash taken out covers it; once the losses pass the cash out, the per-cent figures come back on the owner's money.
- MCP `get_property_returns` returns `shortfall_minor` and `cash_out_cover_months`; `money_in_minor` changes for every rental whose running cash flow is below zero.
