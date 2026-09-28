# SUMIT is the primary source for income and expenses

**Date:** 2026-09-26
**Status:** Accepted
**Amended by:** [0065](0065-review-round5.md) point 40. The Hapoalim upload in this record is dropped. Bank lines come from the SUMIT sync. SUMIT remains the source for income and expenses.

## Context

[0035](0035-sumit-api-first.md) makes the SUMIT API the first integration and left open whether that pull replaces the Bank Hapoalim upload. [0012](0012-bank-hapoalim-first.md) still limits a statement file to Hapoalim. The open question was also whether contractors record expenses in SUMIT, or keep them elsewhere.

## Decision

Contractors record expenses in SUMIT.

SUMIT, the expense module and the documents, is the primary source for both income and expenses.

The Hapoalim bank upload remains as a complement: cash matching, and anything that is not in SUMIT.

## Alternatives rejected

Dropping the Hapoalim upload. Treating the bank file as the primary source of income and expenses when those documents are already in SUMIT.

## Consequences

This answers the SUMIT-versus-Hapoalim question: they sit side by side, and SUMIT is primary for income and expenses. [0007](0007-bank-statement-is-primary-input.md) still holds for cash basis: an unpaid invoice stays out of profit until it is paid. A Hapoalim file is still Hapoalim only ([0012](0012-bank-hapoalim-first.md)). The pull stays read-only ([0036](0036-sumit-read-only.md)).
