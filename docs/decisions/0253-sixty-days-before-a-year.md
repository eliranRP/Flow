# Sixty days before a per-year figure; the closing amount only on a loan paid out at closing

**Date:** 2026-11-04
**Status:** Accepted (owner, 2026-11-04, on FLOW-473's card: "Show 60 days as מעט נתונים; closing row only for Sub2")
**Amends:** [0249](0249-returns-from-first-rent.md), [0250](0250-returns-in-service.md)

## Context

0249 and 0250 scale cash on cash, cap rate, the cash flow per unit and the total return to a year over the days since a first rent inside the period. With no minimum, a first rent three weeks back multiplied three weeks by 365/21: a figure that reads like a year's return but rests on a few payments. FLOW-467 named the days under it; the UX rules review (2026-11-04) still found the figure misleading.

0250 added "סכום ששולם בסגירה" to every loan with a project. It matters only for a loan paid out at closing without passing through the bank (a Sub2 mortgage taken over, a lender who paid the title company, 0246): only those count into the purchase price. On every other project loan it was a row with no effect.

## Decision

- **60 days.** When the first rent falls inside the period and fewer than 60 days have passed (`earning_days` < 60 with `annualized_from` set), the scaled figures read "מעט נתונים" in place of the figure: cash on cash (its loss a year included), cap rate, the cash flow per unit, and the total return's per-cent on the investment page. The hint says why: "מהשכירות הראשונה · 21 ימים · מחושב לשנה מ־60 ימים"; a metric's page adds it to its caption and shows no division. From 60 days on nothing changes, and the server computes the figures as before. DSCR (a ratio), ∞ (all the cash out, gaining), the amounts and the total's loss in money (not scaled) keep their figures. The number is `MIN_EARNING_DAYS` in the app.
- **MCP.** `get_property_returns` still returns every figure and adds `few_earning_days`, true below 60 days, so an assistant does not quote a figure the app does not show. The server SQL is unchanged.
- **The closing row only on a loan paid out at closing.** The loan page shows "סכום ששולם בסגירה" for a project's loan that its project's returns name in `taken_over_loans` (0246's rule, read with `get_property_returns`). Another project loan keeps whatever amount is stored (no data change); when one is stored, the row still shows, so it can be seen and cleared, and it hides once cleared.

## Alternatives rejected

- **The unscaled figure below 60 days.** A per-cent for three weeks beside per-cents for a year reads as a year's return either way.
- **Keeping the figure with the day count (FLOW-467 alone).** The figure still leads; the hint is easy to miss.
- **A Sub2 switch on the loan.** 0246 rejected it: the dates and the missing proceeds line already tell.
- **Hiding a stored amount on a loan that is not paid out at closing.** It would stay in the data with no way to see or clear it, and count again if the loan were ever read as paid out at closing.

## Consequences

- A newly let rental shows "מעט נתונים" for its first 59 days, then the figures 0249 describes.
- The loan page reads the project's returns for a project loan; until they land, the closing row stays hidden.
