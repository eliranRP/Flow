# A loan balance never goes below zero

**Date:** 2026-10-08
**Status:** Accepted

## Context

[0088](0088-loans.md) keeps a loan's balance as its principal minus the posted principal parts that are still on the books and not waiting for review (`public.loan_balances`). FLOW-111 added a database check that refuses a split past the balance, but the #72 review found three ways around it (FLOW-123):

- The app path's check did not lock the loan, so two app splits on the same loan at once could both pass it.
- The check ran only when splits changed. A pending bank line that later posts, or a removed line that comes back, starts to count without any check.
- An edit that lowers the principal below what was already paid was not checked.

## Decision

- `private.loan_splits_check` waits for any open write on the line (`for share`), then locks the loan row (`for no key update`, which does not wait on the key-share lock every `loan_splits` insert takes) before the balance check. Concurrent splits on one loan check one after the other, and a split on a line the bank sync is posting sees the posted status.
- When a line with loan parts starts to count (it becomes posted, or its removal is undone) and the balance would go below zero, its parts are flagged for review (`needs_review`), the same way an amount change already flags them. The write itself is not refused: the bank sync and undo write these lines, and a refusal would stop a whole sync. The trigger never waits for the loan (`skip locked`): the sync already holds other lines and the MCP attach locks the loan before the line, so waiting could deadlock the sync. If another write holds the loan at that moment, the parts are flagged anyway, and clearing the flag runs the check. A flagged line's parts count nowhere in the balance until the owner corrects the split and clears the flag, and clearing runs the balance check again.
- Lowering a loan's principal below the principal already paid is refused with `loan balance exceeded`, from MCP `update_loan`, its undo, and any direct update. Equal is allowed (balance zero).

## Alternatives rejected

- Refusing the line update. It would fail the bank sync on one line and hold back every other line in it.
- Letting the balance go negative and reporting it. Every reader of `loan_balances` assumes zero or more.

## Consequences

A line flagged this way shows in the loans list as waiting for review, with no change to the P&L rule for flagged splits ([0100](../decisions/0100-loan-split-pnl.md): a split that needs review counts whole).
