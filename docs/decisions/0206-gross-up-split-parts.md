# A split can carry a gross-up part: an opposite-sign item that nets against the line

**Date:** 2026-10-22
**Status:** Accepted (owner-approved design, FLOW-946. Extends [0104](0104-line-splits.md), [0123](0123-line-split-percent-rest.md), [0138](0138-line-split-review-followups.md))

## Context

A bank line is one net amount, but it can carry an opposite-sign item inside it. A deposit of loan proceeds arrives net of a cost paid at closing: the bank shows one deposit, but the books owe a gross income (the full proceeds) and a real expense (the cost). A payment can carry a positive credit the same way. Today a split by category can hold an opposite-**kind** part (a reversal/refund), but a reversal keeps the line's money sign: an income category on an expense line **reduces** income, an expense category on an income line **reduces** expense ([0104](0104-line-splits.md), [0138](0138-line-split-review-followups.md)). A loan gross-up is the opposite: the cost is a **real** expense that **raises** the expense total, and the proceeds are the full gross income. Confusing the two would misstate both the income and the expense of every financed deal.

The two cases look alike on the wire — an opposite-kind category on a part — so the books cannot tell them apart from the category alone. They need an explicit marker.

## Decision

1. **D1 — one tool.** `split_line` is extended; no new tool. Existing positive-only calls are unchanged.
2. **D2 — a flag, not a signed amount.** `amount_minor` stays positive. A new `gross_up boolean not null default false` column on `public.line_splits` marks the part. Every legacy row is `false` and reads byte-identically. The sum rule becomes **signed**: each part's signed contribution (its `amount_minor`, negated when `gross_up`) must equal the line's net exactly, to the cent. The same signed sum is the split's validity gate everywhere it is checked (`private.pnl_lines`, `private.line_split_valid`, `private.line_split_review_sync`, `get_line_split.parts_match`).
3. **D3 — the part's own sign.** A `gross_up` part's category kind is validated against the part's own sign: a gross-up part on a deposit (income line) must carry an **expense** category, and one on a payment (expense line) an **income** category — the opposite of the line's own kind. A non-gross-up part keeps today's rule (a reversal part of the other kind, a normal part of the same kind). A gross-up part **must** name its own project (mirroring the reversal-expense rule). In v1 a gross-up part is an exact `amount_minor` only: `gross_up` with `percent` or `rest` is refused. Gross-up parts are VAT-free in v1 and operate on `amount_net`, like the existing split path.
4. **D4 — the P&L sign source.** In `private.pnl_lines`' line-split branch, a `gross_up=false` part keeps the current expression byte-identically (its sign comes from the line's direction, so a refund reduces the other side). A `gross_up=true` part is emitted as a **real item of its category's kind** (an expense becomes a negative `amount_net`, an income a positive one), the opposite of the refund branch; `kind` stays the category kind. `private.cash_parts` and `private.breakdown_rows` read `amount_net` and `kind` from `private.pnl_lines`, so the one change there carries into the cash view, the company P&L, the project reads and the breakdown without a second copy of the rule.

The marker rides through: `private.line_split_parts` and `line_split_parts_full` carry `gross_up`, so `get_line_split`, `get_expense` and the `mcp_undo` line_split restore round-trip it. The P&L drill-down (`get_breakdown_lines`) carries it too, so a gross-up part can be tagged "paid from deposit".

## Alternatives rejected

**Infer gross-up from the sign of a signed amount.** Storing `amount_minor` signed would break every reader that assumes a positive amount and every legacy row, and it still could not tell a gross-up from a reversal (both are opposite-kind). An explicit flag is the only unambiguous marker ([0104](0104-line-splits.md) keeps amounts positive).

**A new tool for gross-up splits.** The parts, the preview, the review-mismatch handling and undo are all `split_line`'s; a second tool would duplicate them and split the editor in two. One flag on the existing part is smaller (0095, MCP-first).

**Let gross-up parts take percent or rest.** A gross-up amount is a known figure from the closing statement, not a share of the line; percent and rest describe shares of the primary side. v1 keeps it an exact amount; a later decision can revisit.

**Mirror the D4 conditional separately in `cash_parts` and `breakdown_rows`.** Both derive `amount_net` and `kind` from `private.pnl_lines`; a second copy of the sign rule would be a place to drift. The single change in `pnl_lines` is enough.

## Consequences

- A financed deal reads right: the gross proceeds are income and the closing cost is a real expense that raises the expense total and lowers the profit, while the bank still shows one net deposit.
- A reversal/refund part is unchanged: it still reduces the other side. The two are told apart only by the `gross_up` flag.
- A split that mixes a gross-up part no longer sums in absolute value; readers that gated on `sum(amount_minor) = abs(amount_net)` now use the signed sum.
- Legacy splits, reversals and loan splits are byte-identical; the output-pinning pgTAP (`main_screens_speed`, `pnl_scans_speed`) stays green.
