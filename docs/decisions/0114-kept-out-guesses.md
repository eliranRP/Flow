# Kept-out guesses and project income

**Date:** 2026-10-07
**Status:** Accepted

## Context

[0099](0099-categories-outside-pnl.md) left two gaps (FLOW-121). A guessed category (`category_suggested`, from the supplier's history or a default, [0069](0069-back-and-one-tap-review.md)) that is kept out of the P&L already took the line out, before anyone confirmed the guess, so money left the totals without anyone looking at it. And `get_project` listed kept-out project expenses in `excluded_categories_by_currency` but had nothing for kept-out project income.

## Decision

- **A guess counts until it is confirmed.** `private.line_category_out(excluded, suggested, loan_part)` is the category's say for a whole line: a kept-out category keeps the line out only once it is no longer a guess. `private.pnl_lines` passes it to `private.line_in_pnl`, so totals, projects, the breakdown and the overhead share all follow on both bases. Confirming the category (approval, an owner pick, an MCP write) takes the line out. This was the recommended answer to the owner's question; it is built that way unless the owner picks otherwise.
- **What does not change.** A line's own override ([0112](0112-line-out-of-pnl.md)) still wins. A loan category follows its flag even as a guess, so a guessed principal stays out. Split parts carry their own confirmed categories and are not affected.
- **Reads.** `get_transaction` (MCP `get_expense`) adds `category_suggested`; `category_excluded_from_pnl` stays the category's own flag and `in_pnl` is the answer. `set_transaction_pnl` returns `in_pnl` the same way. The transaction card reads the guess, so a guessed line shows no ⊘ pill and its עוד sheet offers "מחוץ לרווח והפסד".
- **Project income.** `get_project` adds `excluded_income_by_currency[]` (`currency`, `id`, `name`, `amount_minor`, `count`): income filed to the project that is out of the P&L, by category, on the same basis as `income_agorot`, positive minor units. A line taken out by its own override is listed under its category.

## Alternatives rejected

- Keep a guess out at once: a guess the owner never saw would quietly move money out of the totals.
- Put income rows in `excluded_categories_by_currency`: its amounts are positive for an expense, so callers summing it would mix signs.

## Consequences

A line guessed into a kept-out category now shows in the totals and in the review queue until it is confirmed, then moves to the `excluded_*` totals.

## Follow-up (FLOW-126)

Income that already had a project and only a guess of a kept-out category never reached the review queue, so the guess was never confirmed and the line kept counting. `sync_review_queue` now queues it with reason `suggested`; approving it confirms the category and takes the line out. The owner was asked on 2026-10-07; this is the recommended answer and can still be reversed. Migration `20261007224500_kept_out_income_review.sql`.
