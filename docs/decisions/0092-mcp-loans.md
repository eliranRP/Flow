# MCP cycle 5 loan tools

**Date:** 2026-10-06
**Status:** Accepted

## Context

Loans already live in the app with schedule math in `@flow/shared` and splits on bank lines. MCP cycle 4 established write idempotency, writer gate, and undo on `private.mcp_writes`.

## Decision

Add read tools `list_loans` and `get_loan_schedule`, write tools `add_loan`, `update_loan`, and `attach_loan_payment`, with undo kinds `loan`, `loan_update`, and `loan_split`. Edge handlers import schedule and split helpers from `packages/shared` (no duplicate copy). Default loan currency when omitted follows `companyLoanCurrency` via `mcp_company_loan_currency()`. `mcp_writes.prior` for `loan_update` stores `{ before, after }` snapshots so undo can detect drift. `get_transaction` exposes `amount_original` for attach. Undo `loan_split` uses the ledger `transaction_id` as `id`.

## Alternatives rejected

- Copying loan math into `supabase/functions/_shared`: Deno resolves `packages/shared` imports; a duplicate would need parity tests without adding behavior.
- Requiring `currency` on every `add_loan`: the app default is derived from open lines; the read RPC matches that rule.

## Consequences

Agents can set up a loan, adjust terms, preview the schedule, and attach a payment line with the same split rules as the app. Undo removes a loan only when no splits exist; split undo is per transaction.
