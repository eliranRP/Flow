# A loan can be paid off or closed

**Date:** 2026-10-08
**Status:** Accepted (owner approved the FLOW-106 plan, 2026-10-08)

## Context

A loan ([0088](0088-loans.md)) had no end. Real books hold loans that are already over: a hard-money loan paid off when the property was refinanced, a note that was closed. Without a status they look like open loans with a balance, and nothing stops a later bank line from being attached to them. FLOW-106 is the bookkeeping agent's request for more loan types; this is its first part.

## Decision

- `loans.status` is `open` (the default), `paid_off` or `closed`. `loans.closed_on` is the day it ended, set exactly when the status is not open (a check constraint), so the app and MCP cannot store one without the other.
- A loan that is not open takes only payments dated on or before `closed_on`, so its history can still be attached. A later one is refused (`loan_closed`) by a trigger on `loan_splits`, from MCP `attach_loan_payment` (`loan closed`) and the app alike. The app's match sheet does not offer such a loan for a later line; a loan already on the line stays shown.
- Closing a loan on a day before a payment that is already attached (on a line still on the books) is refused (`payments after closed_on`), by a trigger on `loans`.
- A loan can be marked paid off while `balance_minor` is above zero: an old loan's earlier payments may never have been in Flow. `update_loan` returns that remainder as `balance_left`. Nothing writes a payoff line.
- MCP `update_loan` takes `status` and `closed_on`. `status: "open"` alone reopens the loan and clears the date. A non-open status without a date is `closed_on required`; a date on an open loan is `loan is open`. Undo restores both. An edit kept before this change has neither in its snapshot, and undoes without touching the status.
- MCP `list_loans` returns `status` and `closed_on`, and takes `include_closed` (default true, so existing callers see every loan as before).

## Alternatives rejected

- Refusing to mark a loan paid off while its balance is above zero: it would force a fake payoff line for every historical loan.
- Deleting paid-off loans: their attached payments and the P&L split need the loan.
- A single `closed` flag: a paid-off loan and one closed another way (refinanced, forgiven) read differently in the books.

## Consequences

The bookkeeping agent can record a historical loan as paid off and still attach its payments. The loan sheet does not show or set the status yet; that screen work goes to the Mercury UI thread with the rest of FLOW-106.
