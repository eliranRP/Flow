<a id="flow-934"></a>
# FLOW-934 · The project page: next month's card and the income/expenses chart instead of "חודשים קודמים"
- **Type:** UI (design approved) · **Status:** ready · **Depends on:** [FLOW-932](FLOW-932.md) (the card and the chart), [FLOW-933](FLOW-933.md) (next month's numbers and the page the card opens) · **Source:** the owner approved it on 2026-10-19. Design: [Design canvas](https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD), page "Ready for dev", section "Projects tab" (boards "Project · rental" and "Project · flip in renovation", scroll to the end), light versions; spec note "Next month's forecast, the same on every related screen". The canvas page "What changed" lists it.
- **Files:** the project page in the Projects tab, its stories and tests. Remove the "חודשים קודמים" card and what only it uses.

- [ ] Replace "חודשים קודמים" with the next-month card ([FLOW-932](FLOW-932.md)) and the chart. On this page it is cash flow, so the card's net line is "תזרים צפוי". The card opens [FLOW-933](FLOW-933.md)'s page; under the chart "רווח לפי חודש ›" opens the project's profit page.
- [ ] Up to six months and next month; a project with less history shows fewer ("מתחילת הפרויקט וצפי").
- [ ] A flip shows its real cash flow: the purchase month sets the scale; income is $0 (grey) until the sale.
- [ ] A project with no history and no forecast shows neither.
- **Acceptance:** stories for a rental, a flip, a client job with two months, and a new project, dark and light; design review against the boards.
