# A project opens on its cash

**Date:** 2026-10-10
**Status:** Accepted (owner's card, option A "Like Home", 2026-10-10 09:19Z; FLOW-419)

## Context

A project page opened on its profit for a period, with a month pill, and showed no cash. The owner mostly wants a project's cash, and needed several taps to get a view he uses. He also wanted investment and loans in one place of their own. Home already opens on the month's cash ([0168](0168-cash-flow-view.md)).

## Decision

1. **The project page is the project's cash, like Home.** The band shows this month's תזרים for the project. The rows are נכנס and יצא (each opens the project's lines for the month), רווח החודש (opens the profit page), השקעה והלוואות (opens its page; left out when the project has no investment data and no loan), and then the earlier months under חודשים קודמים, each opening its own page.
2. **A project's cash.** `public.project_cash_months(p_project, p_months, p_today)` and `public.project_cash_month_lines(p_project, …)` have `cash_months`' and `cash_month_lines`' shapes. They read `private.cash_parts` and keep the project's parts: a line filed or split to the project counts whole (its part), and a shared line counts the project's `allocations.share_bp` of its gross. A project shows its own part of a bill, never the whole bank amount. `profit_minor` is the project's profit on the company's basis (get_project's income, direct and shared lines), before the overhead share. MCP: `get_project_cash_months`, `get_project_cash_lines`.
3. **Profit has its own page.** `/projects/:id/profit` is the page the project used to open on: the band with the period pill, then הכנסות, הוצאות, לפי חודש and תנועות. The period pill leaves the project page.
4. **השקעה והלוואות.** `/projects/:id/investment` shows the investment card and the project's loans on one page.

## Alternatives rejected

- **Three tabs under the band (B)** and **a cash/profit switch with property and loans always at the bottom (C).** Both add a control or more figures; A reads exactly like Home.

## Consequences

- The project page's first read is `project_cash_months` (4 months). `get_project` serves the profit, investment and loans pages.
- The רווח החודש row is before the overhead share; the profit page still applies the project's overhead switch.
- The cash of a shared line is split by `share_bp`, rounded half-even per project, so the projects' shares can differ from the bank amount by a cent.
