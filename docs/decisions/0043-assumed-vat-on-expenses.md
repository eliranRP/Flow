# SUMIT expenses without a VAT split default to 18%

**Date:** 2026-09-27
**Status:** Accepted

## Context

[0041](0041-amounts-before-vat.md) shows a source with no VAT split as the gross amount, flagged "VAT unknown". On the SUMIT test company, expenses created through the API (`addexpense`) are stored with no VAT split: the VAT line is 0, there is no VAT rate, and the amount without VAT equals the gross. [0042](0042-sumit-primary-income-and-expenses.md) makes SUMIT the primary source for contractors, so that 0041 rule would overstate every such expense by 18%.

## Decision

This amends 0041. It supersedes the "shown gross and flagged VAT unknown" part of 0041 for expenses.

For a SUMIT expense, and for any expense source, that arrives with no VAT split, Flow assumes the standard Israeli VAT rate. The rate is a configurable constant, currently 18%, not a hard-coded number. The amount shown is net = gross / 1.18.

If the supplier is marked VAT-exempt (for example an insurance company, or `עוסק פטור`), net = gross.

The owner sets a supplier's VAT-exempt flag once. Supplier memory keeps it. The owner can toggle it later, and past amounts recompute.

Store `vat_status='assumed'`. That value sits alongside `source`, `derived`, and `unknown`. The detail screen may show a subtle hint, so the owner can correct it. Home has no warning banner.

Documents that carry a VAT split, including SUMIT income documents, keep the source values.

A bank-statement line with no supplier match follows the same 18% default.

## Alternatives rejected

Showing those expenses gross and flagged "VAT unknown", as 0041 said. Guessing nothing, which overstates profit's expenses by the VAT.

## Consequences

The demo client's expected P&L, Rule A, is the target the implementation must match: net = gross / 1.18 for VAT-registered suppliers, and gross for the exempt insurer `ביטוח המגן`.

0041 still stands for amounts before VAT, and for using a real VAT split when the document has one.
