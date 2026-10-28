# Prepaid amortization schedules, and a books-closed date

**Date:** 2026-10-28
**Status:** Accepted (owner, 2026-10-28, FLOW-155 + FLOW-156: the prepaid spec, and "books-closed date" for its closed-period rule)
**Builds on:** [0228](0228-journal-entries.md) (journal entries), [0232](0232-ledger-only-books.md) (the ledger-only books and the open chart of accounts)

## Context

A cost paid once can cover many months, such as a yearly insurance premium. The bank moves once, the payment belongs on a Prepaid asset, and every month 1/N of it should become expense on the property. Flow could already do every piece by hand: an asset account, a kept-out category bound to it, and `create_journal_entry`. But someone had to remember a journal entry every month for every policy. Flow had no notion of a closed period to protect months already reported.

## Decision

1. **A schedule spreads one payment.** `public.prepaid_schedules` holds the line, the prepaid account, the expense category, the project, the total, the start month, the number of months (1–120) and the day of the month (1–28). `public.prepaid_rows` holds one row per month. `public.prepaid_refunds` holds refund lines attached to a schedule.
2. **The payment is filed to Prepaid.** The whole line, or a part of it (the rest stays on the line's category), goes to a kept-out category bound to the prepaid account. The default account is "Prepaid expenses", created if missing. The line's previous coding is kept, so deleting the schedule, or undoing its creation, restores it exactly.
3. **A posted month is a normal journal entry.** It credits Prepaid and debits the expense on the project, with no cash moved. It goes through `private.post_journal_entry`, the core of `create_journal_entry` that MCP now shares. A planned month is only a row: it is on no P&L and no balance sheet.
4. **The amounts.** Each month is the total over N, rounded half up, and the last month takes the rounding. When rounding up would overshoot a tiny total, the months round down instead. 2,621.00 over 12 is 11 × 218.42 and 218.38.
5. **Posting runs itself.** `private.prepaid_post_due` posts every planned row due on or before today, oldest first. A daily pg_cron job (`flow-prepaid-post`) runs it, and a re-run posts nothing, because only a row without an entry posts. A schedule that starts in the past posts its due months at once, with their own dates.
6. **Changes touch only the future.**
   - A refund line (income) is filed to Prepaid and lowers what remains.
   - `update_prepaid_schedule` changes the months, category or project of the planned rows.
   - Both re-spread what remains over the months left.
   - `end_prepaid_schedule` drops the planned rows from a month on. What is left is either expensed in that month (`expense`) or stays on Prepaid (`keep`).
   - A posted month is never changed. Only deleting the schedule removes its entries.
   - **A line held by a schedule is locked.** No person can recategorize, re-project, split, switch in or out of the P&L, remove or delete the payment line, a refund line, or a posted month's entry ("the line is in a prepaid schedule", "the entry belongs to a prepaid schedule"). Otherwise the same cost would count twice, or the schedule would lose its money. Only the prepaid tools change them. A company that is deleted takes its schedules with it.
   - **A bank sync is never refused.** If the bank removes or voids the payment line, the schedule stays and its months wait. Posting resumes when the line comes back.
   - **Posting is safe to run twice at once.** A month that another write is holding is skipped and posts on the next run. A write never posts inside a period being closed at the same moment.
7. **A books-closed date per company.** `companies.books_closed_through` is set with MCP `set_books_closed_through`, owner only, never after today. The prepaid writes refuse to add, change or remove a posted month on or before it. Closing past a due month that isn't posted yet is refused. Other write tools don't check it yet.
8. **MCP.**
   - Writes: `create_prepaid_schedule`, `attach_prepaid_refund`, `update_prepaid_schedule`, `end_prepaid_schedule`, `delete_prepaid_schedule` and `set_books_closed_through`. Each takes an idempotency key, is logged, and has an undo kind (`prepaid_create`, `prepaid_refund`, `prepaid_update`, `prepaid_end`, `prepaid_delete`, `books_closed`).
   - Reads: `list_prepaid_schedules` and `get_prepaid_schedule`.

## Alternatives rejected

- **Post the months as cash-moving lines.** That would show money moving that didn't move, and it would double the bank.
- **Keep the planned months as draft legs.** Draft legs belong to a line that exists. A planned month has no line until it posts, and rows are simpler to re-spread.
- **A full period close for every write tool now.** It touches every writer. The owner chose a date that the prepaid tools respect first.

## Consequences

- A yearly premium needs one MCP call. Its months appear in the P&L on their own dates, and the cash reads and bank totals never move.
- An app screen for schedules is PLAN FIRST (FLOW-157).
- The same engine can later handle other prepaid costs, and, reversed, rent received in advance.
