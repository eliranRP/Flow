# No invoicing in the proof of concept

**Date:** 2026-09-26
**Status:** Accepted

## Context

Israeli businesses often issue tax invoices in a dedicated invoicing product. Morning is the one owners ask about first. Building invoicing inside this product would mean tax documents, numbering, and allocation numbers (`חשבונית ישראל`) as a second product, before the owner can see project profit.

## Decision

The proof of concept does not issue invoices and does not integrate with Morning. Morning integration comes after the proof of concept. Income enters the way money already arrived: a bank deposit, a photographed invoice used as a supporting document, or a manual cash or cheque entry.

## Alternatives rejected

Building invoicing in this product.

## Consequences

There is no "create invoice" flow. iCount is in the same bucket as Morning for the proof of concept: no integration yet. Documents stored here are invoices the business received or already issued elsewhere. Their extracted fields, including an allocation number when one is printed, are kept for matching and for the accountant export.
