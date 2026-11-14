# A loan's renovation draws are not the purchase price

**Date:** 2026-11-14
**Status:** Accepted (owner, 2026-11-14: "fix the data ... and the bug", after a renovation's purchase price counted a hard-money loan's renovation draws that rehab already counted)
**Amends:** [0250](0250-returns-in-service.md)

## Context

0250 counts a loan paid out at closing into the purchase price by what the settlement statement shows it paid then (`loans.closing_paid_minor`), and by its whole principal when the owner has not entered that. A hard-money loan pays the purchase at the title company and holds the rest back for renovation draws. The draws reach the bank as loan proceeds and pay renovation costs that `rehab_minor` already counts. Left at the default, the price counted the draws a second time, and the net profit read that much too low.

## Decision

- With no closing amount set, a loan paid out at closing counts its principal less its **draws**, at least zero. A closing amount the owner sets still wins.
- A draw is a money-in line on the property's financing line that:
  - is dated after the loan's start, up to its payoff (`closed_on`, or today while it is open), and before the first rent;
  - is in a category that posts to a liability account and is not a renovation category (a store refund is not a draw);
  - is not another loan's proceeds (80% or more of that loan, from 120 days before its start to 30 days after it, the 0246 test).
- Some lenders hold the draws back inside the principal (interest on the whole loan from day one); others lend them on top of it (the balance grows with each draw). When the principal paid back on the property, from the loan's start to 30 days after its payoff, is above the loan's principal, the excess is draws lent on top, and those draws are not taken off.
- `taken_over_loans` gains `draws_minor`, the draws taken off; `counted_minor` is what the price counts.

## Consequences

- A hard-money loan whose draws are in the bank and inside its principal no longer counts them in the price; a loan whose draws were lent on top and whose payoff is in the books keeps its whole principal; entering the settlement statement's amount is needed only when the bank does not show the draws, or to be exact.
- A deposit or other liability money that arrives during the renovation, before the first rent, would read as a draw, and draws lent on top of a loan not yet paid off (or whose payoff is not in the books) are taken off until the payoff shows. The settlement statement's amount, set on the loan, overrides both, and is the reliable source.
