# Cash words on the forecast card and chart; תזרים צפוי shows the whole sum

**Date:** 2026-10-20
**Status:** Accepted (owner's board note spec-cash2, approved 2026-10-20; FLOW-144). Amends [0196](0196-next-month-forecast-card-and-chart.md) points 1 and 4 (the card's and the chart's words on the project page).

## Context

[0196](0196-next-month-forecast-card-and-chart.md) built one forecast card and one month chart, both in profit words (הכנסות צפויות, הוצאות צפויות, "הכנסות והוצאות לפי חודש"), and used them on the project page too, whose figures are cash. The month-end forecast (צפי, FLOW-141) is cash as well, but showed its sum as a big figure with a grey "היום $X" line under it and no chart. DESIGN-RULES' money terms keep נכנס and יצא for the cash view, so a cash figure under profit words said the wrong view.

## Decision

1. **Words follow the view, the parts stay one.** The card and the chart take a kind: a cash view says צפוי להיכנס / צפוי לצאת / תזרים צפוי on the card and "נכנס ויצא לפי חודש" with the legend נכנס · יצא · צפי on the chart; a profit view keeps הכנסות צפויות / הוצאות צפויות / רווח צפוי and "הכנסות והוצאות לפי חודש". The words live in the shared parts, never per screen. The project page (פרויקטים) is a cash view; the project profit and company profit pages stay on profit words.
2. **The month-end forecast is "תזרים צפוי"**: its header, its compact bar and the item page's back link. The big figure is the month's end, with nothing under it.
3. **Its card shows the whole sum**, top to bottom: "עד סוף <month>" with the צפי tag and a grey count of every item still expected ("N פריטים · פירוט למטה", no link: the list is below); a first row "תזרים היום" with today's cash net and a divider under it; צפוי להיכנס and צפוי לצאת, the forecast's remaining totals, with honest counts ("N פריטים · M באיחור", lateness as the rows say it; "N פריטים, מהם M קבועים", the small charges counted with the rest); and a strong last row "תזרים בסוף <month>", start plus income minus expenses, the big figure in the same colour.
4. **Its chart** is the company's cash months from May (five months back) as they ended, and the current month in progress: solid bars for what came in and went out so far, and a dashed cap for what is still expected (the forecast's remaining totals). The scale counts so far plus expected. The profit pages keep next month fully dashed.
5. **One more read, not one per month.** Home reads four cash months; the chart reads six with the same `cash_months` call, under the `dashboard` key (one of `LEDGER_KEYS`, decision 0191), so a write, a sync or a focus refreshes it with Home's.

## Alternatives rejected

- **Keep profit words on the project page.** Its figures are cash (0196 point 4); the words said profit.
- **Labels per screen.** The card and chart would drift; the board shows one part with two sets of words.
- **Today's figure under the big one, as before.** The card now carries it as the start of the sum, so a second copy would repeat it.
- **Raise Home's read to six months.** It would change what Home loads first for a chart Home does not draw.

## Consequences

- The project page's card is named "צפי <month>: צפוי להיכנס …, צפוי לצאת …, תזרים צפוי …", and its chart's label says נכנס and יצא.
- The month-end forecast reads `cash_months` twice on a cold open (four months for today's net, as Home, and six for the chart); opened from Home, only the six.
- **No new flow-mcp tool (0095).** Nothing here is a user action or a new figure: `get_forecast` gives the forecast's items and totals and `get_cash_months` the months, so an agent can say the same sum.
