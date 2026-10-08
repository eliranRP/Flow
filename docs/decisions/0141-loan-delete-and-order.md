# Delete a loan with undo, and a saved loan order

**Date:** 2026-10-08
**Status:** Accepted (FLOW-110, server part; the owner chose "unmatch with undo")

## Context

FLOW-110 asks the owner to be able to delete a loan, with a confirm, and to reorder the loans list. MCP needs both too. Until now:
- A loan could not be deleted in the app or in MCP.
- The table still had a delete policy. A raw delete took the loan's split parts and rate rows with it (`on delete cascade`), without the locks loan writes take, and left no way back.
- The list was ordered by name.

## Decision

**Deleting unmatches, and can be undone (the owner's choice).**
- `delete_loan(loan)` is an owner call. It takes the loan lock, then each matched line's lock, the order every loan split write takes.
- It deletes the loan, which takes its rate rows and split parts with it. The matched payments count whole again under their own categories, and the loan's principal no longer counts.
- It returns the loan's name and how many payments it unmatched (lines not removed), so the confirm and the toast can say so.
- A viewer is `forbidden`. Another company's loan, or one that is gone, is `loan not found`.
- The delete policy on `loans` is dropped, so every delete goes through this call. Add-loan undo already deletes through its own definer function.

**What was deleted is kept.**
- `private.loan_deletions` holds the loan row, its rates and its parts.
- `restore_loan(loan)` is the app's undo. It puts back the latest delete of that loan.
- MCP `delete_loan` records undo kind `loan_delete`, which points at the same snapshot.
- Both restore through one function. It refuses with `loan cannot be restored` (`conflict` in MCP) when the loan id is taken again, a line was matched again since, or the parts no longer fit the line (`loan_splits_check`). Nothing is half restored.
- A line a sync removed keeps its parts, as it did before the delete (0136). A project or loan category deleted since is left empty, as `on delete set null` would have left it.
- Once restored by either path, the snapshot is spent: the app gets `loan not found`, and MCP undo gets `not_found`.

**The list keeps a saved order.**
- `loans.sort_order` starts as today's order by name, so the list reads the same until the owner changes it.
- `reorder_loans(ids)` takes the full order in one call: every loan of the company once, open and closed. A list that leaves one out, names one twice or names another company's loan is `validation`, so a list made before a loan was added or deleted is refused rather than half applied.
- A new loan has no place and goes last, by name.
- `mcp_list_loans` (MCP `list_loans`) reads in this order. The app list moves to it with the UI lane's screen.
- MCP `reorder_loans` records undo kind `loan_order`, with the company id. Undo puts back the order before, and is `conflict` when the order changed, or a loan came or went, since.

## Alternatives rejected

- **Refuse to delete while payments are matched.** Offered to the owner, who chose unmatch with undo. A loan with 24 matched payments would need 24 detaches.
- **Hide instead of delete.** A hidden loan would still count its parts in the P&L.
- **`reorder_loan(loan, position)` one loan at a time**, as the task first named it. Two clients moving loans at once would race on positions. The full list is one atomic write and one undo.
- **Restore from a snapshot the app sends back.** The server keeps the snapshot, so the app's undo needs only the loan id and cannot write parts the delete did not remove.
