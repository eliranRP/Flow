<a id="flow-933"></a>
# FLOW-933 · A project's next-month forecast, and editing it
- **Type:** Feature + UI (design approved) · **Status:** ready · **Depends on:** [FLOW-932](FLOW-932.md) (the card that opens it), [FLOW-930](FLOW-930.md) (ended recurring charges drop out), [FLOW-366](FLOW-366.md) (the transaction page's parts) · **Source:** the owner approved it on 2026-10-19. Design: [Design canvas](https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD), page "Ready for dev", section "Profit (רווח)" (boards "Project profit · צפי נובמבר", "צפי נובמבר · tap a line → its page", "צפי נובמבר · הוספה (same page, new line)", "קטגוריה picker · searching "ביטוח"", "קטגוריה picker · no match → create", "כל כמה זמן · same sheet as קבועים", "צפי נובמבר · after edits (scroll)"), light versions; spec note "Editing the next-month forecast" at the end of the Profit row. The canvas page "What changed" lists it.
- **Files:** the project month screen's forecast mode, a forecast line page, a category picker sheet (search), the forecast read and writes (server and a migration for the user's changes), `app/src/forecast-next.ts` (pure: lines, averages, changes applied), their stories and tests.

**The numbers**
- [ ] Next month for a project = its recurring items (from קבועים, assigned to the project, not ended) with their dates, plus one line per non-recurring category: its 6-month average in the project. Income and expenses apart; the general-costs share as on the profit page.
- [ ] The user's changes sit on top and win: a changed amount, a removed line, an added category; each either "פעם אחת" (only that month) or with a pace (כל חודש, כל חודשיים, כל רבעון, כל שנה). Totals, the card ([FLOW-932](FLOW-932.md)) and the company forecast use the changed numbers. "חזרה לצפי של Flow" clears them.
- **MCP:** a read of a project's next-month forecast with its lines and the user's changes; writes to change, remove and add a line, and to reset. List them in TOOLS.md.

**The page "צפי <month>"**
- [ ] Opens from the card: the summary (הכנסות צפויות, הוצאות צפויות, the share, profit after it), a note on where the numbers come from, the lines (recurring with "צפוי dd/mm · קבוע", averages with "ממוצע 6 חודשים"), "הוספת קטגוריה לצפי", "הוסרו מהצפי · N" with החזרה, and "חזרה לצפי של Flow" once anything changed. A changed line says "שינית · היה $X" in accent.

**A line's page (built from the transaction page)**
- [ ] Status tag ("צפי · <month>", or "חדש בצפי · <month>"), the name, the amount as an input (40/400, pencil, underline, formatted like an amount), the meta line; card פרויקט / קטגוריה (קטגוריה opens the picker); card with the recurring row ("חד פעמי" / "הוצאה קבועה בצפי", the pace in accent) and the category's history bars (five months and a dashed accent bar for next month, "בדרך כלל $X · גבוה ב־$Y"); one line on what the change does; שמירה; הסרה מהצפי.
- [ ] "כל כמה זמן" is the same sheet as on a recurring charge, with "פעם אחת · רק ב<month>" as the first row (the default).
- [ ] Adding opens the same page empty ("שורה חדשה בצפי", $0, "בחרו קטגוריה"); picking a category with history fills its amount.

**The category picker**
- [ ] A sheet with a search field, "מוצעות לפרויקט" (categories the project used, with their average or yearly charge), then all categories A–Z; typing filters both ("תוצאות"); categories already in the forecast aren't listed; no match offers "+ יצירת קטגוריה" (created for the company and selected).

- **Acceptance:** unit tests of `forecast-next.ts` (averages, ended items out, each pace, removed and added lines, reset); stories of every board above in dark and light; an e2e that changes, removes and adds a line and sees the card's totals change; design review against the boards.
