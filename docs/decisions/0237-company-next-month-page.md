# The company's צפי page: next month by project, from Home and Projects

**Date:** 2026-10-31
**Status:** Accepted (owner, 2026-10-31, FLOW-1000: concept A of two on the board, "Go with A and build it")
**Amends:** [0235](0235-next-month-on-home-and-projects.md) point 4 (the cards had no link)
**Builds on:** [0236](0236-forecast-page-leads-with-cash.md) (a צפי page leads with the cash)

## Context

The next-month card on Home and on the Projects tab is the company's sum: every project's forecast and the general costs. It had no link, so the owner could not get from it to the rows behind it or edit them.

## Decision

1. **A page at `/forecast/next`.** The card on Home and on Projects says "פירוט ועריכה ›" and opens it. Its grey caption ("5 פרויקטים וכללי") moves to the page's subtitle: "כל החברה · 5 פרויקטים וכללי · N צפויות".
2. **The same head as a project's צפי page.** "‹ בית", צפי נובמבר, the figure תזרים צפוי (the card's cash), and the summary: צפוי להיכנס, צפוי לצאת, then, when the loans hold a part the profit leaves out, מזה לא נספר ברווח and רווח צפוי.
3. **By project.** One section per project in the Projects tab's order, the general costs (כללי) last. Each is headed by its name and its own צפי net (the figure on its Projects row); the heading opens the project (כללי's, the overhead project, when the company has one). Its first three rows, then "עוד N בצפי של <project>" to that project's צפי page. The general costs list every row (FLOW-1001, owner 2026-10-31): they have no צפי page of their own, so their heading's net could not be checked otherwise. A project's part the profit leaves out is its last row, as on its own page.
4. **No new editing.** A project's row opens that project's existing edit page: the company's forecast is built from the same rows and keys. The general costs' rows are read only, since no project's צפי page holds them (charges and averages with no project).
5. **MCP.** Nothing new: `get_company_next_month_inputs` (FLOW-216) gives the same inputs and its recipe, and the edits are `set_project_forecast_edit` and its siblings.
