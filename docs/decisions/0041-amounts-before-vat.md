# Amounts are shown before VAT

**Date:** 2026-09-26
**Status:** Accepted

## Context

Profit in Flow is a management figure, net of VAT, beside the accountant's books ([0001](0001-management-tool-alongside-accounting.md)). Some sources have no VAT split. The [technical plan](../tech/tech-plan.md) already recommended showing those amounts gross and marking them, rather than inventing a split.

## Decision

The P&L shows amounts before VAT everywhere: Home, projects, and reports.

VAT is stored per document. It is excluded from profit.

Where a source has no VAT split, show the gross amount flagged "VAT unknown".

[0043](0043-assumed-vat-on-expenses.md) amends that last sentence for expenses, and for a bank-statement line with no supplier match. Those use the standard rate (currently 18%) unless the supplier is VAT-exempt. Income documents that carry a VAT split are unchanged.

## Alternatives rejected

Deriving VAT at the standard rate when the source has no split. Asking in review, for large items, instead of showing the flagged gross amount.

## Consequences

The open questions on bank-only income and on unknown-VAT expenses were first answered here. [0043](0043-assumed-vat-on-expenses.md) replaces the expense answer, and the answer for a bank line with no supplier match. Whether a SUMIT website or OCR expense actually carries a split is still a data question. If it does not, 0043 is how it is shown.
