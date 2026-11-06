# 0260 · ROI, a renovation's net profit, and the deal metrics on the investment page

**Date:** 2026-11-06
**Status:** Accepted

## Context

The owner asked, 2026-11-06, for ROI on a property's investment page and for the metrics from Real Estate by the Numbers that the page did not show. The plan and its mockups were approved the same day (option A, FLOW-1068), and the v3 canvas boards `V3-Investment`, `V3-Calc-FlipProfit`, `V3-Calc-Roi` and `V3-Calc-Roe` carry the design.

A renovation's "רווח צפוי" was the ARV less the purchase and the renovation ([0143](0143-project-investment.md)). The book (Ch 42) counts four cost buckets: purchase, rehab, holding and selling. Leaving out the holding and selling costs made the profit read high, and an ROI built on it would read high too.

## Decision

1. **Selling costs.** A property has `projects.selling_cost_bp`, the costs of selling (agent, closing, transfer taxes) in basis points of the ARV, 0 to 3000. Null reads as 8% and is shown as an estimate the owner can change (`set_project_investment`, undo `project_investment`; a write from before this decision undoes without touching it).
2. **Net profit.** A renovation's profit is the ARV less the selling costs, the purchase, the renovation so far, and the holding costs the renovation does not already count (a category counts in rehab unless it is switched off, so a line is never taken twice). `forced_equity_minor` stays as it was, a rental's forced appreciation.
3. **The purchase date** is the first purchase line's date; a renovation's ROI per year runs from it to the end of the period (to today by default). A planned sale date is not asked for.
4. **The metrics,** worked out by `get_property_returns` and each null with a missing input named: for a rental, ROI since purchase ((cash back + equity today − money in) ÷ money in, cash back being the cash flow since the first rent when above zero), return on equity (the year's total return ÷ equity today), the equity multiplier, break-even occupancy, the expense ratio, the gross rent multiplier and loan to value; for a renovation, ROI on the money in, ROI per year, the margin on the ARV, the 70% rule (ARV × 70% − rehab − purchase) and the break-even sale price.
5. **The מדדים tab** groups them by kind: a rental's תשואה, סיכון and מחיר; a renovation's תשואה and מחיר. Each row opens its calculation page. The page shows figures only, no targets, as before (FLOW-451).
6. **Later:** IRR since purchase, from dated flows (FLOW-1069).
