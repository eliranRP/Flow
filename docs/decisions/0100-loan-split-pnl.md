# Loan payments count by their split parts

**Date:** 2026-10-07
**Status:** Accepted

## Context

[0088](0088-loans.md) splits a loan payment into interest, escrow, and principal, and [0099](0099-categories-outside-pnl.md) put every P&L read behind `private.pnl_lines`. Until now the view emitted the whole bank line, so a payment counted in full under the line's category. Interest was overstated and principal was missing from the excluded totals.

## Decision

- `private.pnl_lines` emits one row per split part for a posted, non-removed line that has three split rows, no part flagged `needs_review`, and no VAT. `part` is the part, `category_id` is the split row's category, `amount_net` is the part amount signed like the line, and `line_amount_net` is the whole line. `in_pnl` follows the part's category, so interest (`ריבית משכנתא`) and escrow (`מסים וביטוח`) stay in and the principal (`תשלומי הלוואה`) is kept out and shows in the `excluded_*` totals.
- A line with split rows that is flagged or carries VAT is emitted whole, as before, with the new column `loan_split_fallback` true. A line with no split rows has it false. A removed or unposted line emits nothing.
- `company_pnl` returns `loan_split_fallback_count` on each `by_currency` row: the number of distinct lines in the period that fell back. `count` stays a count of distinct lines, so a split line counts once.
- A split whose parts no longer sum to the line's net amount also falls back, so stale parts never count.
- Deleting the split puts the whole line back under its own category. `loan_balances` reads `loan_splits` and is unchanged.
- The two private helpers behind the project category totals and the category drill-down now read the view, so `get_project` and `list_project_category` show the part categories. Their output columns are the same.
- Shared allocations multiply each project's share by the part over the line and round each part half to even (`private.div_half_even`) in `company_pnl`, `get_project`, and the category helper. Each part is within half a minor unit, so a project's parts sum to its share within 1 minor unit. The zero-amount guard stays: a zero line gives 0.

## Alternatives rejected

- Counting the interest only and leaving escrow out: the owner's call in 0099 keeps escrow in.
- Emitting the parts of a flagged split: its amounts may not match the line until the owner clears the flag.
- Splitting a VAT-bearing line: the parts sum to the gross amount, and the P&L counts net.

## Consequences

The totals reconcile with the bank: parts in plus parts out equal the line. A project's shared parts can differ from its share by 1 minor unit.
