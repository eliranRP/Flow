# SUMIT is the first data integration

**Date:** 2026-09-26
**Status:** Accepted

## Context

[0012](0012-bank-hapoalim-first.md) makes a Bank Hapoalim statement file the upload the owner brings in. The proof of concept also needs a first system it pulls from.

## Decision

The first data integration is the SUMIT API (sumit.co.il). Flow pulls data from SUMIT.

Endpoints, the sync design, and how this relates to the Bank Hapoalim statement upload are not decided here. They belong in the tech plan. Whether SUMIT replaces that upload in the proof of concept, or sits alongside it, is [open](../open-questions.md#sumit-and-the-hapoalim-upload).

## Alternatives rejected

Leaving the first integration unnamed. Starting with a different API.

## Consequences

0012 stays Accepted until that open question is decided. Do not treat this record as dropping the Hapoalim upload, and do not treat it as requiring both. Build the pull from SUMIT. The tech plan fills in the endpoints and the sync.

[0042](0042-sumit-primary-income-and-expenses.md) answers the open question. SUMIT is the primary source for income and expenses. The Hapoalim upload sits alongside it, for cash matching and for anything not in SUMIT.
