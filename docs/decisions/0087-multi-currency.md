# Display currency is shekel or dollar

**Date:** 2026-10-03
**Status:** Accepted

## Context

Mercury amounts are US dollars. The books, the typed inputs, and the P&L are shekels ([0041](0041-amounts-before-vat.md)). The README out-of-scope line and the Module 1 spec bullet "Multi-currency. Amounts are ₪." said the product would not convert. There is no numbered decision that says "no multi-currency". This record supersedes those two lines. The spec bullets after that one (progress billing, category sub-groups, accrual basis) stay out of scope.

## Decision

Each company has one display currency, ₪ or $. One tap switches it, from the Home header and from Settings. Typed inputs stay ₪.

A USD line stores the original gross cents, the rate, and the rate date. Once a day, Flow takes that day's Bank of Israel USD rate, or the newest published rate on or before that day when the calendar is a weekend or a holiday, and sets the shekel amounts with an explicit half-even round. Postgres `round` is not used. The rate is cached for the day. A missing rate fails that sync with `sync_fx_missing` and does not zero a line. Yesterday's shekel amounts stay until a rate is stored. The default policy reprices every USD row. Columns are shaped so a later lock-to-the-line's-date policy is one predicate. That lock is not accepted here.

The shekel amount is before VAT, in agorot, as [0041](0041-amounts-before-vat.md) requires. Mercury's VAT is 0 ([0086](0086-mercury.md)), so gross and net match. Allocations are recomputed from `share_bp`. The document fingerprint for a USD line uses the original cents, so a reprice does not look like a new document.

## Alternatives rejected

A rate picked by the owner. Refetching a posting-date rate forever. Converting typed inputs when the toggle is on dollars. Storing only shekels and dropping the original dollars. Repricing with a stale rate and labelling it today. Adding the rate columns after Mercury rows already exist.

## Consequences

Home can show the same books in ₪ or $. Reports stay in shekels in storage. The Bank of Israel fetch and the `fx_rates` table land with the display work, not in the contract layer. The contract names them.
