# Amounts are shown before VAT

**Date:** 2026-09-26
**Status:** Accepted

## Context

Profit in Flow is a management figure, net of VAT, beside the accountant's books ([0001](0001-management-tool-alongside-accounting.md)). Some sources have no VAT split. The [technical plan](../tech/tech-plan.md) already recommended showing those amounts gross and marking them, rather than inventing a split.

## Decision

The P&L shows amounts before VAT everywhere: Home, projects, and reports.

VAT is stored per document. It is excluded from profit.

Where a source has no VAT split, show the gross amount flagged "VAT unknown".

## Alternatives rejected

Deriving VAT at the standard rate when the source has no split. Asking in review, for large items, instead of showing the flagged gross amount.

## Consequences

The open questions on bank-only income and on unknown-VAT expenses are answered by this record. Whether a SUMIT website or OCR expense actually carries a split is still a data question. If it does not, this record is how it is shown.
