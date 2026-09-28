# SUMIT integration is read-only

**Date:** 2026-09-26
**Status:** Accepted
**Amended by:** [0065](0065-review-round5.md) point 40. The pull does replace the Hapoalim upload. The read-only rule is unchanged.

## Context

[0035](0035-sumit-api-first.md) makes the SUMIT API the first data integration. Flow pulls from SUMIT. The [verified research](../tech/sumit-api-research.md) shows a project tag can be written back onto a SUMIT document, and that write costs no action quota.

The owner does not want Flow editing customers' SUMIT data.

## Decision

SUMIT integration is read-only for the proof of concept.

Flow never writes to the customer's SUMIT. That includes creating documents, and writing project or budget-section tags back, even where a write would cost no quota.

Project tags chosen in Flow stay in Flow.

Revisit this after the proof of concept.

## Alternatives rejected

Writing project tags back to SUMIT budget sections, including the no-quota write.

## Consequences

The question of writing project tags back to SUMIT is answered by this record. [0035](0035-sumit-api-first.md) is unchanged: Flow still pulls. Whether that pull replaces the Hapoalim upload stays [open](../open-questions.md#sumit-and-the-hapoalim-upload).
