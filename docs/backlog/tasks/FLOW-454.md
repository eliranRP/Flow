<a id="flow-454"></a>
# FLOW-454 · Property returns on real deals: Sub2 purchase price, one unit by default, aligned rows, before the first rent
- **Type:** MCP + UI · **Status:** done (#925) · **Depends on:** [FLOW-453](FLOW-453.md) · **Source:** the owner, 2026-11-01, on real properties after the FLOW-453 deploy: "UI need to fix the items to be aligned on same line regardless of the content", "loans number are not correct for subto deals", "unit number by default should be 1 unless user change". On a card the same day: the purchase price = the cash purchase lines + a loan taken over (automatic).
- [ ] The purchase price adds a loan paid out at closing without passing through the bank (a Sub2 mortgage taken over, or a lender who paid the title company): a loan starting 30 days before to 75 days after the closing (the largest purchase line) with no proceeds line of 80% of it or more. A later refinance is not part of the price. The money in stays cash only. The ⓘ rows show it ("הלוואה שנלקחה בסגירה").
- [ ] Units are 1 until the owner sets them; the row reads "1 · ברירת מחדל".
- [ ] The total-return card's source rows keep their amounts and per-cents in fixed columns, whatever the row holds (a missing note, ∞, a long label).
- [ ] Before the first rent the per-cent figures read "לפני השכר הראשון" instead of 0.0%.
- **Acceptance:** pgTAP for the Sub2 price and the default unit; stories for a Sub2 property, a property before its first rent and the aligned card at 320; TOOLS.md and decision 0246.
