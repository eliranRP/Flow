# Profit follows the company's date choice

**Date:** 2026-10-10
**Status:** Accepted (owner picked "Payment date" on the FLOW-103 card, 2026-10-10; server PR. The Settings row and the app reading the basis are UI lane 1's PR)

## Context

[0168](0168-cash-flow-view.md) added `companies.cash_basis` for the cash view only: `paid` (the default) counts a line in its payment month, `invoice` in its document month. The P&L kept its own basis: the app passes `invoiced` ([0060](0060-library-review-calls.md)), the MCP P&L tools defaulted to `invoiced` (#404), and the P&L RPCs defaulted to `cash`. So Home's cash figure, its "רווח החודש" row, the profit view and the MCP could each count by a different date. The owner asked for one choice, invoice date or payment date, that the app and the tools both follow (FLOW-103), and picked payment date as the default for every company, existing ones included.

## Decision

1. **One setting.** `companies.cash_basis` is the company's one date choice. For the P&L, `paid` is the `cash` basis and `invoice` is `invoiced`. No new column, and nothing is backfilled: every company is already `paid`.
2. **Reads without a basis follow it.** `private.pnl_basis(company, basis)` returns the basis a caller named (`cash` or `invoiced`), else the company's choice. `get_dashboard`, `get_project_group`, `get_breakdown`, `get_breakdown_lines`, `get_profit_months` and `list_project_category` default `p_basis` to null and use it; `get_project(p_id, p_basis)` reads a null basis the same way. A caller that names a basis still gets it. The old one-argument `get_project(p_id)` stays `invoiced`; nothing in the app or the MCP calls it.
3. **"רווח החודש".** `cash_months.profit_minor` is the month's net profit on the company's basis, counted as `get_profit_months` counts it, so the row on Home and the profit view agree.
4. **The MCP.** The P&L tools (`get_totals`, `list_projects`, `get_project`, `get_project_group`, `get_breakdown`, `get_profit_months`) read `company_pnl_basis()` when the client names no basis, after their arguments are checked, and echo the basis they used. `company_pnl_basis()` returns the readable company's basis, or null without a company.
5. **The app.** It still passes `invoiced` until UI lane 1's PR reads `basis` from `get_dashboard` (called without one) and passes it to the other reads, with the Settings row "רווח ותזרים לפי".

## Consequences

- Once the app follows, Home's profit and the project pages count by payment date: an open income invoice is not income until its receipt, and an unpaid supplier invoice is left out ([0118](0118-unpaid-invoices-cash-basis.md)). The owner can switch to the invoice date in Settings.
- Until then, "רווח החודש" on Home (payment date) can differ from the profit view it opens (still invoice date).
- An MCP client that asked the P&L tools for a figure without `basis` gets the company's choice, `cash` for every company today, where it got `invoiced` since #404.
- `get_home` is unchanged: the app reads only its `company_id`, and no MCP tool calls it.
