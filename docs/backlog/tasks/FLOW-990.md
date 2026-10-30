<a id="flow-990"></a>
# FLOW-990 · Next month's forecast on Home and on Projects
- **Type:** SMALL UI (design approved) · **Status:** claimed (UI lane 1, 2026-10-30, claude/flow-990-next-month-home) · **Depends on:** [FLOW-216](FLOW-216.md) (the MCP read, same PR) · **Source:** the owner, 2026-10-30: "I want to see a prediction cash flow for next month on the home screen like we have in the project screen". Six concepts on the board; the owner picked A (Home) and E (Projects) together and approved them ("Approve and start building"). Board: Ready for dev, "Next month's forecast on Home and Projects" (`HomeNextMonth`, `ProjectsNextMonth` and their light twins).
- **Files:** `app/src/company-next-month.ts` (`companyCashForecast`, `companyPartNet`), `app/src/screens/company-cash-next-month.tsx` (new), `app/src/screens/home-next-month.tsx` (new), `app/src/screens/HomeScreen.tsx`, `app/src/screens/projects-screen.tsx`, `app/src/ui/css/51-next-month.css` (`.ui-home-next`, `.ui-projects-next`, `.ui-proj-next`), stories and tests for both screens, a design log entry, a changelog fragment.

The company's next month, in cash terms (decision 0196: the loans' principal due next month added), the same card on both screens. No new component: `ForecastCard` and `MonthChart` as the project page uses them.

- [ ] Home, current month only: after the split card, "החודש הבא", the dashed card (the month and its צפי tag, צפוי להיכנס, צפוי לצאת, תזרים צפוי) with no link and the grey caption of what the sum covers ("4 פרויקטים וכללי"), then the chart of the company's last six cash months with next month dashed. Hidden when nothing is expected or the read fails; a skeleton while it loads. Its code loads in its own chunk, so Home's first load does not grow.
- [ ] Projects: the same card under the subtitle, above פעילים. Each project row, and the overhead row, gets a muted צפי figure under this month's: that project's (or the general costs') next-month cash forecast. The figures add up to the card's net.
- [ ] Stories for both; unit tests for the cash sum and the per-project figure.

**Acceptance:** the card's net equals the sum of the rows' צפי figures; the profit page's card is unchanged (profit terms).
