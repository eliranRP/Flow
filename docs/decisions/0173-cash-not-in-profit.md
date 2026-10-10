# Home shows what profit leaves out of the month's cash

**Date:** 2026-10-10
**Status:** Accepted (owner picked option A on the plan-first card, 2026-10-10, and asked for the tap to open the transactions; FLOW-418)

## Context

Cash Home ([0168](0168-cash-flow-view.md)) shows the month's figure, then נכנס, יצא and a quiet "רווח החודש". On a month with renovation money, owner's capital or loan principal, נכנס less יצא is far from the profit, and nothing on the screen said why. The owner found the profit row confusing and asked for it to say what came out of profit.

## Decision

1. **One more row.** Under "רווח החודש", a quiet "לא נספר ברווח" row (the glossary's kept-out word) shows the month's net less its profit, so the two rows add up to the month's figure. A short hint under its label names the two largest categories it holds. The row shows only when some currency has any.
2. **A tap opens the lines.** The row opens the month's lines page (`/cash/<month>/kept/<currency>`), the same page as נכנס and יצא: money in green, money out with its minus, one line under the figure on what these are. VAT, and lines out of the view but in profit, are in the figure but have no row; the page says how much of the figure they are.
3. **Server.** `private.cash_parts` gains `in_pnl`. `cash_months` adds `not_in_profit_minor` (net less profit) and `not_in_profit_categories` (cash in the view that the P&L leaves out, by category, signed like net, largest first). `cash_month_lines` takes the side `not_in_profit` (in the view, out of the P&L). The MCP `get_cash_months` returns the new fields and `get_cash_lines` takes the new side.

## Consequences

- Nothing in profit or cash changes; the row only explains the gap between them.
- An earlier month's page shows the same row, since it reuses Home's rows.
