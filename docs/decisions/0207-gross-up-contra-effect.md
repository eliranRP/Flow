# A gross-up part may be a contra entry: either category kind, effect auto-derived

**Date:** 2026-10-22
**Status:** Accepted (owner-approved design, FLOW-947. Extends [0206](0206-gross-up-split-parts.md))

## Context

[0206](0206-gross-up-split-parts.md) lets a split carry a gross-up part — a real item that nets against the line, told apart from a reversal by the `gross_up` flag. In v1 a gross-up part had to carry the **opposite** category kind to the line (an expense category on a deposit, an income category on a payment): the closing cost raises the expense total, the credit raises income.

But a financed deal often wants the gross-up on the **same** side as the category it belongs to, ending as a credit against that category rather than as a new line on the other side. A property-taxes payment that is mostly offset by an escrow credit should end as a net credit under Property taxes, not as "Other income". The books want the amount to **reduce its own category** (net it), the way a refund does, while the bank still shows one net line.

The two readings differ only by the category kind relative to the line, so the effect can be derived with no new marker.

## Decision

1. **D1 — either kind, effect auto-derived.** A gross-up part may now carry **either** category kind. The effect is derived at read time from the part's category kind vs the line's direction, with **no new column** and **no data migration**:
   - category kind **opposite** the line direction → **normal** (0206's rule, byte-identical): a real item of its category's kind (an expense lowers profit as a real cost, an income raises income).
   - category kind **equal** to the line direction → **contra**: the part reduces its own category (like a refund), netting it. An **expense** category on a payment credits it (`+minor`, so the category can end as a negative expense); an **income** category on a deposit lowers it (`-minor`).
2. **D2 — cash and the sum rule do not change.** A gross-up part's bank contribution is still `-amount_minor` either way, so the signed sum rule (= the bank amount) is untouched. Only the P&L placement/sign changes. `private.pnl_lines` negates a contra part; `private.cash_parts` and `private.breakdown_rows` read `amount_net`/`kind` from it, so the one change carries through.
3. **D3 — drop the same-kind rejection.** `save_line_split` no longer refuses a same-kind gross-up part (`category kind must match the part sign` is gone, and removed from `private.mcp_refused`). It **keeps**: a gross-up part needs its own project, is an exact `amount_minor` only (no percent or rest), and the signed sum rule.
4. **D4 — optional explicit `effect`.** `split_line` accepts an optional per-part `effect` (`'contra'|'normal'`) for explicitness; the server validates it against the derived value and refuses a mismatch (reusing `validation`). Omitted means derived. `get_expense` reports the derived `effect` per gross-up part; `category_kind_mismatch` no longer fires for a gross-up part.

The derived effect is reported by `get_line_split` (hence `get_expense`) per gross-up part. No value is stored, so `mcp_undo` restore, `line_split_parts` and `line_split_valid` are untouched; a split round-trips through undo unchanged.

5. **D5 — one normal and one gross-up part per category and project** (amended 2026-10-22, FLOW-949). The per-line key that allows a category and project pair once now includes `gross_up`: a line may hold one normal and one gross-up part on the same category and project, so a cost and its contra credit can share them (this record's own example: Property taxes / a project, a 249.48 cost and an 850.77 contra credit, netting to a 601.29 credit). Two normal parts, or two gross-up parts, on one pair are still refused (`same category and project twice`). The key is the same in `split_line`'s schema, `save_line_split`, the `line_splits` unique constraint (`transaction_id, category_id, project_id, gross_up`, nulls not distinct), the editor's check and the category merge. The two parts are never summed: they stay separate rows, and their P&L amounts always carry opposite signs. No stored row changes.

## Alternatives rejected

**Store the effect in a column.** The effect is a pure function of the category kind and the line direction, both already stored, so a column would be redundant state that could drift and would need a data migration. Deriving it at read time is smaller and cannot disagree with the P&L.

**A separate "contra" flag beside `gross_up`.** Two flags for one concept invite the invalid fourth combination. One flag plus the derived effect keeps the part's meaning in one place.

**Keep contra out and let people use the other-kind category.** That forces an escrow credit into "Other income" instead of netting Property taxes, which misstates the category the owner reads. The whole point is to net the category.

## Consequences

- A category can end as a credit (a negative expense) or a reduced income through a single bank line, with the bank still showing one net amount.
- A normal (opposite-kind) gross-up part and every legacy split, reversal and loan split are byte-identical; the output-pinning pgTAP (`main_screens_speed`, `pnl_scans_speed`) stays green.
- `category_kind_mismatch` no longer fires for a gross-up part; the only new refusal path (an explicit `effect` that disagrees with the derived value) reuses `validation`.
- (D5) A category merge moves a normal and a gross-up part of one pair side by side; it is still refused when two parts with the same flag would share a pair. A shared line's project cash settles its rounding per part, so two parts of one category that follow the line's allocations (income-category parts on a shared payment, which take the line's shared role even with a project) no longer mix their shares. Expense-category parts that name a project are project parts and were never affected.
