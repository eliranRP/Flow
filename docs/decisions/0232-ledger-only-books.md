# The ledger is the only booking model: a line's parts are its legs, and the chart of accounts is open

**Date:** 2026-10-28
**Status:** Accepted (owner, 2026-10-28, FLOW-152 + FLOW-153: "full cut" of the legacy write model, in one PR)
**Amends:** [0208](0208-balanced-legs-ledger.md) (items 1, 6 and 8: the legacy rows stay authoritative), [0209](0209-legs-source-of-truth.md) (item 9: `pnl_lines_legacy` and the legacy tables stay maintained as a rollback), [0210](0210-balance-sheet-accounts.md) (a fixed set of balance-sheet accounts), [0228](0228-journal-entries.md) (a journal entry needs a leg in the P&L)

## Context

After FLOW-952 the P&L reads the legs, but the legs were still compiled from the legacy rows. Every writer wrote `transactions`, `line_splits` and `loan_splits`, and a trigger re-derived the legs from `private.pnl_lines_legacy`. `ledger_pnl_diff` and the legacy view stayed as a rollback. Some readers still read the split tables directly. Two models of the same books had to be kept equal, and every new booking shape had to be expressed in the older, narrower one first.

The chart of accounts was fixed at 12 system accounts. A kept-out category with no fitting account (a utility deposit paid, a prepaid insurance) could only sit on Suspense, and a journal entry had to touch the P&L.

## Decision

1. **Legs are the only booking store.** A line's split by category and its loan payment parts are item legs. `line_splits`, `loan_splits`, `private.pnl_lines_legacy`, `private.ledger_pnl_diff` and `private.rebuild_legs_many` are dropped.
2. **The line header stays the source document.** `transactions` keeps the bank or document facts (amounts, dates, direction, VAT, status, currency) and the whole-line coding (category, project, P&L role, overrides). A line with no parts posts one item leg from its header, as before.
3. **New columns on `public.legs`.**
   - `split_part` and `part_ordinal`: a part of a split by category and its place in the person's order.
   - `loan_id`, `scheduled_minor` and `needs_review`: a loan payment part, its scheduled amount, and the re-sync flag.
   - `draft`: a part kept for the person but not on the books.
   A part's magnitude is `abs(amount_minor)`. Its sign, account and project are derived again on every posting.
4. **Draft parts keep the old fallback.** When a split no longer matches its line, the parts become draft legs and the line posts whole from its header. A line no longer matches when its amount changed, or when a loan split is flagged, incomplete or carries VAT. Draft legs are outside the balance check, `pnl_lines` and every money read. When the amounts match again, or the review is cleared, the parts are on the books again. Nothing the person sees changes.
5. **One posting function and a small writer API.**
   - `private.post_lines(company, lines[])` posts lines. It keeps their parts and rebuilds the bank, VAT, journal and whole-line legs with the posting rules of 0209.
   - Parts are written only by `private.set_line_parts`, `private.set_loan_parts` and `private.set_loan_parts_review`. They validate the parts, write them and post the line.
   - The loan rules run when the parts are written, where the old deferred table triggers ran them at commit. These are the closed loan, three or four parts, the part categories, the currency, the sum and the balance.
   - `private.split_parts` and `private.loan_parts` read the parts back in the old tables' shape.
6. **Every public RPC keeps its name, arguments and refusals.** The app and the MCP tools do not change their calls. The app's direct reads of loan parts read `legs`.
7. **The chart of accounts is open (FLOW-152).**
   - Accounts have `is_system`, `archived_at`, `description` and an `equity` type. Owner capital is equity.
   - MCP `create_account`, `update_account`, `archive_account`, `restore_account` and `merge_account` manage the balance-sheet accounts. Each write takes an idempotency key and has an undo kind.
   - The 12 system accounts cannot be renamed, archived or merged away.
   - Archiving is refused while any project and currency holds a balance, or while a category posts there.
   - A merge rebinds the categories and journal legs and posts their lines again. No P&L figure moves.
   - A journal entry may move only balance-sheet accounts.
   - MCP `get_balance_sheet` reads assets, liabilities, equity and retained earnings (the running P&L) as of a date, per currency and project. It checks that the sides balance and warns while Suspense holds money.
8. **The migration proves it.** It snapshots every company's legs and P&L rows, moves the parts into the legs and posts every line again. It aborts if a single leg or P&L row differs. It then drops the legacy objects, and aborts if any function still names them.

## Alternatives rejected

- **Keep the legacy rows as the input and only cut the readers.** Two models would still have to agree, and every ledger-only shape would still need a legacy disguise first.
- **Move the stale parts to a separate review table.** Each writer and reader of parts would have to look in two places. A `draft` flag keeps one home for the parts, and the posting decides what is on the books.
- **Drop the header's category and project too.** Hundreds of reads filter by them (review, search, Jev, recurring). A whole line's one item leg is posted from them, so they are the line's coding, not a second model.
- **Run the loan rules as a deferred trigger on `legs`.** Every posting rebuilds a line's legs, so a re-sync or a category change would re-run the rules and could refuse a write the old model allowed.

## Consequences

- One booking model: what the legs say is the books. The P&L, the cash views, the loans and the balance sheet all read it.
- No P&L figure moves in the migration. The gate proves that per company, leg by leg.
- There is no rollback view. Reverting means restoring the database from before the migration.
- A part written by a new feature goes through the writer API, so the loan and split rules hold everywhere.
