# A category for each part of one loan payment, and a dated category switch on the loan

**Date:** 2026-10-27
**Status:** Accepted (owner, 2026-10-27, FLOW-148: "do 3 as well")
**Amends:** [0128](0128-loan-part-categories.md) (payments already attached keep their categories), [0130](0130-loan-fees-installments.md) (only the fees part may name a category on an attach)

## Context

A loan files each part of a payment under the loan's category for that part, or the built-in default ([0128](0128-loan-part-categories.md)); since [0166](0166-loan-interest-kept-out.md) interest may go to a kept-out category, such as a rehab loan's holding costs. A rehab ends and the same loan then carries a rental: its interest should count in the P&L from that day. `update_loan` changes the category only for payments attached later, and the MCP tools had no way to change one attached payment's part. The only way out was to detach the payments and file the whole line, which takes them off the loan's history and paid interest.

`loan_splits.category_id` was already stored per part, and the app's `save_loan_split` already took a category on each part; only the MCP attach took the fees one alone.

## Decision

1. **A category on any part of an attach.** `attach_loan_payment` takes `interest_category_id`, `escrow_category_id` and `principal_category_id` beside `fees_category_id`, each checked by `loan_part_category_ok` as the loan's own are.
2. **One part of attached payments.** MCP `set_loan_part_category` sets one part's category on 1 to 100 attached payments, which stay attached: the balance and history do not change, and each part counts in the P&L by its new category. `null` puts the part back on what the payment would take now. All or nothing; undo kind `loan_part_category` (the write id), a conflict when any part changed since.
3. **A dated switch on the loan.** `public.loan_category_switches` holds, per loan and part, the category from a date on. MCP `set_loan_category_from` adds, replaces or removes one (undo kind `loan_category_from`). A part a write names no category for takes the latest switch on or before the line's own date, else the loan's category, else the default (none for fees), in the MCP attach and in the app's `save_loan_split` alike (`private.loan_part_category_on`). A payment dated before the switch keeps the loan's category even when attached after it.
4. **Back-filing is asked for.** Payments already attached keep their categories (as 0128) unless `apply_to_existing` is true: then the payments of that part dated from the switch until the next switch are re-filed under what is now in force on their date, hand-set parts included. One undo puts the switch and every moved part back.
5. **A switch follows the loan rules.** Its category must fit the part (also checked by the table); a category a principal switch uses cannot be counted in the P&L, one any switch uses cannot be deleted, moving a category's lines moves its switches (and the move's undo moves them back), `list_categories` counts it as `loan_used`, and `delete_loan` keeps the switches for `restore_loan`.
6. **Refusals in words.** The loan split check's internal names (`loan_split_category`, `loan_split_sum`, `loan_split_incomplete`, `loan_split_currency`, `loan_split_balance`, `loan_split_income`) come out of the MCP tools as the words the tools use, not `The write was refused.`.

`get_loan_split` (and so `get_expense`) names each part's category; `list_loans` lists `category_switches`. There is no screen for the switches yet: the app follows them when it matches a payment, and they are set through the MCP tools.

## Alternatives rejected

- **`replace: true` on `attach_loan_payment`.** A re-attach rewrites amounts too, and undo of `loan_split` deletes every part, so it needs its own snapshot rules; `set_loan_part_category` changes only the category, with its own undo.
- **Re-filing attached payments whenever a switch changes.** It would move parts the owner set by hand without asking, against 0128; `apply_to_existing` makes it a choice per call, with one undo.
- **A switch keyed by when a payment is attached, as `update_loan` is.** Payments are often attached late or again (a catch-up, a re-sync, an undo), so the payment's own date is what decides.
