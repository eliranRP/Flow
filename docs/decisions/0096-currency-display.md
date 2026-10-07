# Currency display in the app

**Date:** 2026-10-07
**Status:** Accepted

## Context

Bank-imported USD lines already roll into `company_pnl.by_currency` and MCP `get_totals` / `list_projects`, but the app still read only ILS `*_agorot` fields and showed ₪ on every row.

## Decision

| Area | Call |
| --- | --- |
| Totals | One row per currency on Home and project screens; ILS first; no FX conversion |
| Expenses | Unicode minus (U+2212) on every expense figure, including zero as `$0` / `₪0` without a sign |
| Formatting | Single shared `formatAmountText` in `packages/shared` |
| Non-ILS detail | Hide VAT copy and the "חשבונית ותשלום" row |
| Non-ILS categories | Show amounts in the line currency; rows are not tappable (drill-down stays ILS-only) |

## Alternatives rejected

- A ₪/$ toggle and converted totals (deferred with decision 0087).
- Per-currency category drill-down in this change.

## Consequences

- `get_project` adds `by_currency`, `categories_by_currency`, and `transactions[].currency`.
- Display-only; MCP already exposes per-currency totals (decision 0095 exemption).
