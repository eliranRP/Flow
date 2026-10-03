# Display currency is shekel or dollar

**Date:** 2026-10-03
**Status:** Accepted

## Context

Mercury amounts are US dollars. The books, the typed inputs, and the P&L are shekels ([0041](0041-amounts-before-vat.md)). The README out-of-scope line and the Module 1 spec bullet "Multi-currency. Amounts are ₪." said the product would not convert. There is no numbered decision that says "no multi-currency". This record supersedes those two lines. The spec bullets after that one (progress billing, category sub-groups, accrual basis) stay out of scope.

## Decision

Each company has one display currency, ₪ or $. One tap switches it, from the Home header and from Settings. Typed inputs stay ₪.

A Mercury line keeps its original currency. The stored amount and `currency` stay US dollars. Import does not convert the row to shekels. `companies.fx_policy` defaults to `original`. Under `original` and `today`, import does not freeze a rate on the row, and `fx_rate` and `fx_rate_date` stay null together. Under `historical`, import stamps both columns on each USD row from the newest `fx_rates` row on or before that line's date. An ILS row is never stamped.

Conversion happens at display time. The ₪/$ toggle, and a total that mixes currencies, reads `fx_rates`: that day's Bank of Israel USD rate, or the newest published rate on or before that day when the calendar is a weekend or a holiday. The shekel figure uses an explicit half-even round. Postgres `round` is not used. The rate is cached for the day in `fx_rates`. A missing rate does not zero a line and does not block the import. The line stays in its own currency. A total leaves that row out, counts it in `fx_missing_count`, and does not add the foreign minor units as if they were the display currency. `original` and `today` convert with the newest `fx_rates` row on or before today. `historical` shows an ILS line in shekels unchanged, converts an ILS line into dollars at the newest rate on or before the line date, and converts a USD line into shekels with the pair import stored.

`reprice_usd_lines` runs only if the policy is switched off `original`. `today` stamps the rate for the chosen date onto every USD row. `historical` import has already stamped each USD row at its own date. Reprice writes the chosen date only onto USD rows that still have no pair, and it does not replace a pair import already wrote. Neither rewrite changes the stored dollar amount or the currency. Switching back to `original` displays from `fx_rates` again.

The displayed shekel amount is before VAT, in agorot, as [0041](0041-amounts-before-vat.md) requires. Mercury's VAT is 0 ([0086](0086-mercury.md)), so gross and net match in cents. The document fingerprint for a USD line uses the original cents, so a later stored rate does not look like a new document.

## Alternatives rejected

A rate picked by the owner. Refetching a posting-date rate forever. Converting typed inputs when the toggle is on dollars. Storing only shekels and dropping the original dollars. Converting each Mercury row to shekels at import. Freezing today's rate onto the row as the default. Repricing with a stale rate and labelling it today. Adding the rate columns after Mercury rows already exist.

## Consequences

Home can show a Mercury line in dollars and a mixed total in the company's display currency. The dollar row stays dollars in storage. The Bank of Israel fetch and the `fx_rates` table land with the display work, not in the contract layer. The contract names them.
