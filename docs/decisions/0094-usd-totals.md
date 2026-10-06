# Per-currency P&L in company_pnl and MCP totals

**Date:** 2026-10-06
**Status:** Accepted

## Context

`company_pnl` counted only ILS lines in the shekel agorot fields. Non-ILS lines appeared in `other_currencies` as income/expense totals without direct, shared, or overhead splits and without per-project breakdown. A USD-only Mercury company showed zero shekel P&L. `flow-mcp` `get_totals` and `list_projects` did not expose foreign-currency buckets. [0087](0087-multi-currency.md) keeps each line in its original currency; conversion is display-only.

## Decision

Extend `company_pnl` with `by_currency` at company scope and `by_currency` on each `projects[]` row. Each bucket uses the same basis, date window, posted-line, and P&L role rules as the existing ILS agorot fields. Amounts stay in minor units of that currency (cents for USD). The ILS row in `by_currency` must match the existing `*_agorot` fields. MCP read tools pass `by_currency` through unchanged.

## Alternatives rejected

- Converting USD into agorot inside `company_pnl`: violates [0087](0087-multi-currency.md) and would double-count with `other_currencies`.
- Replacing `other_currencies`: callers still rely on the legacy shape; add fields instead.

## Consequences

The app can show full USD P&L in a follow-up UI PR. Agents and MCP clients should prefer `by_currency` for non-ILS profit. `other_currencies` remains until a later cleanup.
