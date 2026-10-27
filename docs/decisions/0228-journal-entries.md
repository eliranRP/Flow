# Journal entries that move no money, and the balance-sheet balances per project

**Date:** 2026-10-27
**Status:** Accepted (owner, 2026-10-27, FLOW-149: "review this and implement it")
**Builds on:** [0208](0208-balanced-legs-ledger.md), [0209](0209-legs-source-of-truth.md), [0210](0210-balance-sheet-accounts.md)

## Context

The tax books record each property's depreciation once a year: a debit to a depreciation expense and a credit to accumulated depreciation, per property. It moves no money, so Flow had no way to book it. `book_line` needs exactly one bank leg, `create_manual_entry` is a cash or cheque payment, and the split tools need a bank line. Booking it with any of them would invent a cash movement. It was the largest gap between Flow's P&L and the tax P&L.

The P&L still reads the legacy rows (`transactions`, `line_splits`), not the legs: the flip is FLOW-952 ([0209](0209-legs-source-of-truth.md) item 9). So an entry must be written as legacy rows the P&L reads correctly, as `book_line` does ([0208](0208-balanced-legs-ledger.md) item 8).

## Decision

1. **Accumulated depreciation** is a system asset account in every company, beside Property. A depreciation credit sits on it, per project, so it carries a credit balance per property.
2. **An entry is a line.** MCP `create_journal_entry` takes balanced legs with no bank leg and splits them in two:
   - the **P&L legs** (on a category counted in the P&L) are booked by `private.book_line_core`, with `book_line`'s rules, messages and self-check. The counter legs' sum stands in for the bank movement, so a debit to an expense makes an expense line. The line has document kind `other`, so it never pairs with an invoice.
   - the **counter legs** (on a balance-sheet system account, or a kept-out category's account, which lands on its bound account) are kept in `public.journal_counter_legs`.
   `public.journal_entries` marks the line (with its reference). Posting writes the counter legs in place of the bank leg (`leg_kind` `journal`), and the balance check takes a journal entry with no bank leg. The P&L counts the entry from the legacy rows like any line, by project and by the month of its date, on either basis. The FLOW-951 diff compares item legs only, so it is unchanged.
3. **No money moved.** The line is kept out of the cash view (`in_cash_override` false), so no cash figure, cash list or cash flow counts it. It is written with a category and `user_assigned`, so it never waits for review, and Jev's booking review lists only `book_line` and `line_split` writes.
4. **It is fixed.** A trigger refuses any change to what posts or counts the line: direction, document kind, amounts, category, project, role, P&L or cash flag, status, dates, currency, and any insert, update or delete of its split parts, loan splits or shares (`journal entry is fixed`). Deletes are allowed only when the line itself is going (undo, a deleted company). So `assign_expense`, `split_line`, `set_line_cash`, `attach_loan_payment` and the category move refuse it, and a category an entry uses cannot be deleted. Its description, note and files stay editable. To change an entry, undo it and book it again.
5. **Undo** (`journal_entry`, the line id) removes the line, its parts, its entry and its legs while it reads as written (amount, date and legs), like `book_line`'s.
6. **Reads.** `get_transaction` (and `get_expense`) and `get_line_legs` carry `journal_entry` (`{ reference }`, null on any other line). MCP `get_account_balances` sums the legs on every asset and liability account but the bank, per project and currency, as of a date. It also gives each project's net book value: Property (the kept-out categories bound to it, 0210) plus Accumulated depreciation.
7. **Refused:**
   - a bank leg;
   - an entry with no P&L leg (a pure balance-sheet reclass);
   - P&L legs that net to 0 (a move between two P&L categories with nothing on the balance sheet);
   - Suspense, VAT control and the Uncategorized accounts.

   Another company's or an unknown account stays `The write was refused.`, as in `book_line`.

## Alternatives rejected

- **A zero bank leg.** The ledger would carry a bank movement of 0 on every entry, `book_line`'s sign rule has no sign for it, and the split tools refuse a line of 0.
- **The counter legs as kept-out split parts, as `book_line` does.** The line's amount would be 0, which the split rules refuse, and the parts would add nothing the P&L reads.
- **An entry outside `transactions`.** Every P&L reader reads `transactions` until FLOW-952. An entry elsewhere would need every reader changed, the same flip done twice.
- **Editable entries.** An edit would need the counter legs and the P&L legs re-checked together, and a half-edited entry would not balance. Undo and book again is one rule.

## Consequences

- An assistant can book the year's depreciation per property. The P&L of the property and month moves, no cash figure moves, and undo takes it back.
- `get_account_balances` is the first balance-sheet read: accumulated depreciation and net book value per property.
- Later:
  - the screen (a design task): "פקודת יומן" as an entry of its own, and its badge in the lists;
  - a depreciation schedule per property (basis, useful life, start) that makes the entries;
  - an entry with no P&L leg, once the P&L reads the legs (FLOW-952).
