# Cash basis for v1

**Date:** 2026-09-26
**Status:** Accepted

## Context

Owners reconcile the business against the bank. Accrual accounting (recognize income when it is billed, expenses when they are incurred) needs the official books the accountant already keeps. A management view that uses a different moment of recognition will disagree with the bank balance the owner checks on the phone.

## Decision

Version 1 uses cash basis. Money counts in profit and loss when it moves: a bank or card row, or a cash or cheque payment the owner records. An invoice alone does not move the numbers.

Accrual can be considered in a later version. It is not part of v1.

## Alternatives rejected

Accrual basis for v1.

## Consequences

Reports follow payments, so they can change when a later statement arrives and matches an invoice that was waiting. Unpaid invoices are visible as unpaid and are excluded from P&L until then. See [0007](0007-bank-statement-is-primary-input.md) for how invoices and statement rows relate. Progress billing and retention, which depend on a richer recognition model, are out of scope.
