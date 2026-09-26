# Bank statement is the primary input

**Date:** 2026-09-26
**Status:** Accepted

## Context

Under cash basis, the moment money counts is the payment, not the invoice. Contractors still photograph invoices, because the invoice is what they have in their hand and what the accountant will ask for. Treating the invoice as the P&L entry would pull unpaid bills into profit and would double-count once the bank row arrives.

## Decision

The bank or credit-card statement is the primary input. Each row becomes a transaction. Transfers between the company's own accounts are detected and removed; they are not income and not expense.

An invoice (photo or PDF) is a supporting document. The product extracts supplier, amount, VAT, date, and invoice number, checks for a duplicate, and keeps the Israel invoice allocation number (`חשבונית ישראל`) when the document has one. It then tries to link that document to a statement row.

An invoice with no matching payment is unpaid. It stays out of P&L until a later statement row matches it, or the owner marks it paid (cash or cheque). Marking it paid is the manual-entry path: there is no bank row, and the owner is attesting that the cash moved.

Manual entry remains available for cash and cheques that will never appear as a card or bank row.

## Alternatives rejected

Posting invoices straight into P&L and treating the bank import as a reconciliation after the fact.

## Consequences

Upload results show four outcomes: matched to an existing invoice, classified by a learned rule, removed as an own-account transfer, or waiting for review. A separate note lists invoices that are still unpaid and therefore not in profit. Linking a statement row to an invoice does not create a second transaction. The invoice's extracted fields hang off the payment that counts.
