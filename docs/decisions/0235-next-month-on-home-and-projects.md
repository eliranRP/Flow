# Next month's forecast on Home and on the Projects tab

**Date:** 2026-10-30
**Status:** Accepted (owner, 2026-10-30, FLOW-990: of six board concepts, A (Home) and E (Projects) together, "Approve and start building")
**Builds on:** [0196](0196-next-month-forecast-card-and-chart.md) (the forecast card and chart, cash terms on a cash screen), [0197](0197-company-next-month.md) (the company's next month)
**Amends:** Home's figure budget (implementation guide §1 P2 and P3, the figure budget in §11.3; DESIGN-RULES "Use few numbers" and "Don't pile extra figures")

## Context

The owner wanted next month's cash forecast on Home, "like we have in the project screen". Home's figure budget allowed no new figure without a design decision, and P3 sends charts to inner screens. The company's next month already existed on the company profit page, in profit terms.

## Decision

1. **Home**, on the current month only, gets one more block, after the split card and before the דוחות card: "החודש הבא", the company's dashed forecast card (the month, צפוי להיכנס, צפוי לצאת, תזרים צפוי) and the month chart of the last six cash months with next month dashed. It is the one card and chart the project and profit pages use. This is the only exception to Home's budget; any other figure still needs a decision.
2. **The Projects tab** gets the same card above the list, and each project row (the overhead row: the general costs) its next month's cash net under this month's figure, with the צפי tag. The figures add up to the card's net.
3. **Cash terms**, as 0196 rules for a cash screen: the company profit page's forecast with each part's loans' principal due next month added. The profit page keeps profit terms.
4. **No link yet** (amended by [0237](0237-company-next-month-page.md): the cards open the company's צפי page). A company-level detail page is not designed; the cards carry the grey caption of what the sum covers, as on the company profit page, until one is.
