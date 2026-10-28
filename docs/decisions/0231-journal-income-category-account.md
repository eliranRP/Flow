# A journal entry's income counts, a kept-out category can be bound to a balance-sheet account, and a detached payment attaches again

**Date:** 2026-10-28
**Status:** Accepted (owner, 2026-10-28, FLOW-151: "There is a bug can you review and fix it")
**Amends:** [0228](0228-journal-entries.md) (an entry's document kind; a leg that would land on Suspense), [0210](0210-balance-sheet-accounts.md) (a binding set by a tool, not only by the name)

## Context

The MCP agent booked a tenant's forfeited deposit applied as rent: Dr the deposits category (kept out of the P&L) / Cr rental income, on the house. `create_journal_entry` answered ok, and two things were wrong.

- **The income counted nowhere.** Every P&L reader counts an income line by its document kind: a receipt or invoice_receipt on the cash basis, an invoice, credit or invoice_receipt on the invoiced basis. 0228 wrote an entry's line as `other`, so that it never pairs with an invoice. An expense line counts whatever its kind, which is why a depreciation entry counted and an income entry did not.
- **The deposits leg landed on Suspense.** 0210 binds a kept-out category to a balance-sheet account by its name when it is created, and only the built-in English names are on the list. A category under another name, in any language, lands on Suspense, and nothing could bind it later. The entry put the leg there without saying so.

It also tried to re-attach payments it had detached (`detach_loan_payment`) so the loan's history comes back. Each re-attach answered `The write was refused.`. The first attach's write record stayed open after the detach, and `private.mcp_writes` allows one open `loan_split` record per user and line, so the second insert failed on a unique index. That error is not a worded reason, so it came out as the generic refusal.

## Decision

1. **An income entry's line is `invoice_receipt`.** An entry whose P&L legs net to a credit (an income line) is written as `invoice_receipt`, the kind income counts by on both bases, so it counts in the month of its date on either basis. An expense entry's line stays `other`. Both stay out of the cash view by `in_cash_override`, as 0228 says. `invoice_receipt` pairs with nothing: invoice matching pairs a connector's invoice with its receipts by external id, and the recurring and anomaly reads need a supplier or customer, which an entry has none of. No income entry existed, so no line is rewritten.
2. **A leg that would land on Suspense is refused**, as `the category posts to Suspense`. Book the balance-sheet system account itself, or bind the category first.
3. **MCP `set_category_account`** binds a kept-out category (not a loan part category, which posts by its part) to an asset or liability system account (not the bank, Suspense or VAT control), or back to the default with `null`. The categories trigger posts its lines again, so their legs move and no P&L figure does (the P&L reads the category, and `ledger_pnl_diff` compares `in_pnl`, false either way). A journal entry already booked keeps its legs. Undo kind `category_account` puts the binding back while it is still the one written. Refusals: `the category is counted in the P&L`, `a loan part category posts by its part`, `a category posts only to a balance-sheet account`; an unknown or another company's account stays `The write was refused.`, as in `book_line`.
4. **A re-attach supersedes the stale record.** `attach_loan_payment` runs only on a line with no loan split, so an open `loan_split` record on that line belongs to a split that is gone. The attach closes it before it writes its own, as a review write closes the earlier one. Undo then takes back the new attach. This also lets the payments detached before this change attach again, with no data change.

## Alternatives rejected

- **Count `other` income lines in every reader.** The income filter is repeated in about 15 readers (company_pnl, get_project, the breakdowns, the cash and recurring reads). One document kind at the source changes none of them.
- **Hebrew names on 0210's binding list.** The owner's categories have names of their own, and a list would miss the next one. A tool binds whatever name the category has, and says where it lands (`posts_to`).
- **Bind on the fly inside the journal entry.** It would move every earlier line of the category without the owner asking. Binding is its own write, with its own undo.
- **Close the `loan_split` record in `detach_loan_payment`.** It would not fix the lines already detached, and the detach's own undo puts the parts back, after which the attach record is the right one to undo again.

## Consequences

- A forfeited deposit applied as rent books as one entry: the rent counts in the house's month on both bases, and the deposit held goes down.
- The kept-out categories that sit on Suspense today can be bound one by one (deposits to Security deposit held, owner money to Owner capital, purchase and renovation to Property, loan proceeds to Loan principal), and `get_account_balances` then shows them where they belong.
- A payment taken off a loan to file it elsewhere can be put back on it.
