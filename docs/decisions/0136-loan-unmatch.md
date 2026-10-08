# Unmatch a loan payment in one call, and the split on the transaction read

**Date:** 2026-10-08
**Status:** Accepted (FLOW-114, loan match server items)

## Context

The loans review (FLOW-114) listed loan match gaps:
- the split correction should be one server call, with the balance checked on the server;
- there was no way to unmatch a payment, and nothing locked a matched payment's category;
- every expense view read the split on its own.

`save_loan_split` (20261010120000) already writes a split atomically with the balance check. The app still writes `loan_splits` rows itself, and has no unmatch. MCP can only undo its own attach, and only while nothing changed since.

## Decision

**Unmatch is one owner call.** `clear_loan_split(transaction)` takes the line off its loan.
- It takes the loan lock, then the line lock, the order every loan split write takes.
- It removes every part of the split and returns them.
- A viewer is `forbidden`. A line with no split is `line has no loan split`. A removed line, or another company's, is `transaction not found`.
- The line keeps its project and category and counts whole again under its own category. The loan balance no longer counts its principal.
- It does not undo a project the attach filed. That stays with the MCP `loan_split` undo, which checks nobody changed the line since.

**MCP `detach_loan_payment`** does the same, with the usual idempotency key and write rate limit.
- It records undo kind `loan_detach` with the removed parts: amounts, scheduled figures, categories and review flags.
- Undo puts the same parts back and runs the split check.
- Undo is `conflict` when the line was matched again, or when the parts no longer fit (the amount, the balance or a part's category changed). It is `not_found` when the line or the loan is gone.

**`get_transaction` returns `loan_split`.** It is what `get_loan_split` returns, so the transaction screen and MCP `get_expense` need one read. `get_expense` still reads it on its own from a database without the field, for the gap between the migration and the edge deploy.

**The category lock stays in the app.** A matched payment counts by its parts' categories, so its own category matters only while a part waits for review, and then the whole line counts under it. A database lock on `category_id` would also block category merges and the review flow on matched lines. The transaction screen locks the picker on a matched payment and offers unmatch instead (UI lane).

## Alternatives rejected

- **Clearing the split with `save_loan_split` and no parts.** That function validates a full split, and an empty list read as a mistake would silently unmatch.
- **A trigger that refuses category changes on matched lines.** It would block `merge_category` and the review of a line whose split waits for review.
