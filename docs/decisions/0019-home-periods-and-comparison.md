# Home periods are this month, last month, and year to date

**Date:** 2026-09-26
**Status:** Accepted

## Context

Home had two periods: this month (`החודש`) and year to date (`מתחילת השנה`). Owners also ask what changed versus the month they just finished. The project screen is already "since the job started."

Home v2 drew only the two-segment switch. [01-home-v3](../module-1-project-pnl/screens.md#01-home-v3) draws the three periods and the arrows. That image is pending owner approval.

## Decision

Home periods are:

- This month
- Last month
- Year to date

Each company total (income, expenses, profit) shows an up or down percent arrow versus the previous month.

The project screen defaults to project to date (`מתחילת הפרויקט`). There is no custom date range in this phase.

[0028](0028-period-sheet-with-custom-range.md) supersedes only that last sentence. The three periods above, and the comparison arrows, stay. A custom range is allowed from the period sheet.

## Alternatives rejected

Custom ranges in this phase. Leaving Home as only this month and year to date.

## Consequences

Definitions and the month-versus-month arrow are in [calculations](../module-1-project-pnl/calculations.md#period-filters). The year-to-date arrow's baseline is not settled by the phrase "versus the previous month," because a year-to-date sum and one month are different lengths. That baseline is [open](../open-questions.md#year-to-date-comparison). Until it is decided, the year-to-date tiles show no arrow. This-month and last-month tiles do.
