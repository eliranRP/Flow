# A balanced signed-legs ledger, reconciled in parallel to the P&L (foundation first)

**Date:** 2026-10-22
**Status:** Accepted (owner-approved design, FLOW-948. Foundation of the ledger engine; builds on [0103](0103-reversals-across-directions.md), [0100](0100-loan-split-pnl.md), [0206](0206-gross-up-split-parts.md), [0207](0207-gross-up-contra-effect.md))

## Context

The P&L pipeline carries a different sign rule for each shape of line — whole line, line split, loan split, reversal, gross-up (normal and contra), kept-out, overhead, shared, VAT. Each new shape adds another branch to `private.pnl_lines` and to every reader. A general ledger replaces those per-shape rules with one primitive: a bank line resolves into N signed **legs** that balance, each hitting an **account** typed income/expense/asset/liability. The AI (MCP) can then book any correct entry — loan proceeds, closing costs, escrow, transfers, deposits, owner draws — while the human UI stays as simple as today.

The highest risk is correctness: the legs must not change a single number the P&L already shows. An earlier attempt over-reached by rebuilding `pnl_lines` over the legs, which fights the goal of keeping the legacy representation authoritative. The owner chose **foundation first**.

## Decision

1. **Foundation first — the P&L does not change.** This phase adds the ledger **in parallel**. `private.pnl_lines` and every P&L consumer (`cash_parts`, `breakdown_rows`, `company_pnl`, `get_totals`, `get_project`, …) are **byte-unchanged**. The legacy tables (`transactions`, `line_splits`, `loan_splits`, `allocations`, `categories`) stay authoritative. The legs are **derived from**, and **reconciled against**, the live P&L. A later phase-2 PR may flip the source of truth; this PR does not.

2. **Accounts.** `public.accounts` (company_id, name, type in income/expense/asset/liability, `category_id` bridge, `loan_part` bridge, `is_bank`, `excluded_from_pnl`). Every category gets one **bridge** account (type = the category's kind; `category_id`, `loan_part` and `excluded_from_pnl` copied). Each company also gets **system** accounts: Bank/Clearing (`is_bank`), Loan principal (liability), Escrow (asset), Owner capital (liability), Security deposit held (liability), Suspense, a VAT control account (needed to balance a VAT line as one more leg), and an Uncategorized income / Uncategorized expense account (so a line with no category still has an in-P&L account to project to). RLS on; revoked from public/anon/authenticated; `authenticated` gets SELECT only; writes go through definer functions.

3. **Legs.** `public.legs` (company_id, transaction_id, account_id, project_id, `amount_minor` **signed**, ordinal). Same RLS/grant pattern. `amount_minor` is a **ledger** value, **not** a P&L-display amount.

4. **Leg sign convention (documented once).** **Debit positive, credit negative.** A bank (asset) leg carries the signed statement movement = `transactions.amount_gross` (an income deposit debits the bank `+gross`; an expense payment credits it `-gross`). An income/expense leg projects to the P&L as `amount_net = -amount_minor` (an income credit `-X` → `+X` income; an expense debit `+Y` → `-Y` expense). This one rule reproduces the P&L's "income positive, expense negative".

5. **Balance invariant.** A deferred constraint trigger enforces, for every transaction that has legs, `sum(amount_minor) = 0` and **exactly one** leg on an `is_bank` account. Because `amount_gross = amount_net + vat_amount` (a `transactions` check) and the signed sum of a line's `pnl_lines` rows equals the line's `amount_net`, every line balances by construction.

6. **Backfill and maintenance.** Legs are derived per live `pnl_lines` row: an in-P&L income/expense row → its category bridge account (or the Uncategorized account); a kept-out row → a system asset/liability account (Loan principal / Escrow by `loan_part`, else Suspense), so the projection ignores it; one bank leg = `amount_gross`; a VAT leg = `-vat_amount` when VAT is non-zero. **Routing by the live `in_pnl` flag** (not by the category's excluded flag) reproduces per-line `in_pnl_override` exactly, so the projection needs no excluded filter: every income/expense-type leg is, by construction, in the P&L. Statement triggers on the legacy tables re-derive a transaction's legs whenever the existing write RPCs change it; the write RPCs are **unchanged**.

7. **The reconciliation proof.** `private.legs_pnl_projection(company)` projects the income/expense legs to the shape of `pnl_lines` (income positive, expense negative, via `amount_net = -amount_minor`). A pgTAP over a broad invented fixture — plain, line-split, loan-split, reversal, gross-up normal + contra, kept-out proceeds, overhead, shared, VAT, ILS + USD, cash + invoiced — asserts the projection **equals** the live `pnl_lines` output per line/category/project, and that every line balances. This proves the legs faithfully mirror the P&L **without changing it**.

8. **The booking tool.** `public.mcp_book_line(idempotency_key, new-line fields, legs[])` (MCP `book_line`): validates the legs balance to 0 including the bank leg and that every account is the caller's company, writes the legs **and** the equivalent legacy rows (a line, or `line_splits`, with the right category/kept-out flags) so the unchanged P&L reflects it, and **self-checks** that the derived legs project back to the request — refusing rather than mis-booking. Idempotency + rate limit via `private.mcp_writes`; a new `book_line` undo kind in `mcp_undo` (restore prior legs + legacy, conflict check). Company scoping and RLS exactly as every other write; it joins `privilege_guards` and `cross_company_sweep`. Phase 1 books in-P&L categorized lines and splits; asset/liability and VAT bookings are a later phase and are refused (no invented behavior).

## Alternatives rejected

- **Rebuild `pnl_lines` over the legs now.** The over-reach of the earlier attempt: it makes the legs authoritative before they are proven, and any projection bug changes a real number. Deriving and reconciling in parallel proves the model against the live output first, at zero risk to the P&L.
- **Extend `categories` with a type column instead of an accounts table.** Accounts carry asset/liability types and system accounts (bank, escrow, loan principal, VAT) that are not categories; a type column on categories cannot express the bank leg or the balance invariant.
- **A projection that filters on the account's `excluded_from_pnl`.** It cannot honor a per-line `in_pnl_override` (an overridden-in line on an excluded category, or an overridden-out line on an included one). Routing each leg by the live `in_pnl` flag at backfill time makes the projection a simple "every income/expense-type leg", which is correct across overrides.

## Consequences

- The P&L is unchanged: every existing pgTAP passes untouched because none of the P&L functions changed.
- A single `book_line` primitive can express any balanced entry; existing write tools keep working.
- A later phase can flip the source of truth to the legs and switch on a balance-sheet view, building on a foundation already proven to mirror the P&L.
