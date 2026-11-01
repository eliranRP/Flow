# A property's purchase price counts a loan paid out at closing; one unit by default

**Date:** 2026-11-01
**Status:** Accepted (owner, 2026-11-01, on real properties after the FLOW-453 deploy: "loans number are not correct for subto deals", "unit number by default should be 1 unless user change"; on a card the same day: the purchase price = the cash purchase lines + a loan taken over, automatic)
**Amends:** [0245](0245-returns-from-the-lines.md)

## Context

0245 took the purchase price from the purchase lines. In a Sub2 deal the mortgage taken over never passes through the bank, and a hard-money lender often pays the title company directly: the bank shows only the cash the owner brought to closing. The price from the lines alone was a fraction of the real one, so forced equity and the building cost (tax savings) were wrong. Cash flow per unit read "missing" on every property whose units were not set.

## Decision

- **A loan paid out at closing is part of the price.** A project loan counts when it starts (its first payment) from 30 days before to 75 days after the closing, which is the date of the largest purchase line, and no loan-proceeds line (kept-out income) of 80% of its amount or more comes from 120 days before its start to 30 days after. A loan whose proceeds came through the bank is not added (the cash it brought is already in the purchase lines), and a later refinance falls outside the window. The read names the loans (`taken_over_loans`) and their sum (`taken_over_minor`); the screen shows them as a row of the purchase.
- **The money in stays cash only**: the loan taken over is not money the owner put in.
- **Units are 1 until the owner sets them**; the read says so (`units_default`) and the screen shows "1 · ברירת מחדל".

## Alternatives rejected

- **A Sub2 switch on the loan.** One more setting; the dates and the missing proceeds line already tell.
- **The typed price when it is higher.** The owner asked for the price from the lines.
