# Jev splits a loan payment instead of filing it under one loan category

**Date:** 2026-11-05
**Status:** Accepted (owner, 2026-11-05, on the Loans tab: "Jev didn't split the payment, his suggestion was only one category. Can we add the ability of Jev to infer multiple categories specifically for loans, where most of the time things are recurring")
**Amends:** [0145](0145-jev-auto-mode.md)

## Context

Jev answers one category per line. A servicer's monthly payment synced from the bank, and Jev answered the loan interest category for the whole amount. In auto mode at or above the threshold ([0145](0145-jev-auto-mode.md)) that filled the line as all interest, the owner approved it, and no loan split was written ([0088](0088-loans.md)): the loan balance did not move, and the P&L counted principal and escrow as interest. Matching a payment to its loan was a manual step (the match sheet, or MCP `attach_loan_payment`), and approving a line did not ask for it.

A loan payment is the most regular line there is: the same amount to the same servicer every month. The split is not a guess; it is the schedule.

## Decision

**A loan category is never filled on a whole line.** `jev_prefill` skips a category with a `loan_part` (interest, escrow, principal). The owner can still choose one.

**Jev's loan category starts a split instead.** When Jev's category for an expense line is a loan category at or above the threshold, in auto mode, and the owner has not set the line, the tagging job looks for the loan the payment belongs to. It must be exactly one open loan with a schedule (not demand), in the line's currency, that takes a payment on the line's date, with a balance left, whose monthly payment on that date equals the line; else, the one such loan whose newest attached payment had the same amount (the same recurring payment after an escrow change). None, or more than one, writes nothing. A loan that already has a payment attached in the line's month is left out, so a second payment that month (a catch-up or a duplicate) never takes the same schedule row twice. The gate is the category answer alone: the project answer does not hold the split back.

**The numbers come from the schedule, as in the app.** The job computes the split the way `attach_loan_payment` does with no parts given: the schedule row for the line's date, principal taking any difference ([0088](0088-loans.md)), refused when the principal would pass the balance. Jev supplies no amount.

**One write, under the prefill gates and the split checks.** `jev_prefill_loan` (service role) writes the split only while the line's review is open, the owner has not assigned the line or its category, the line is not split already, and the anomaly gate of [0145](0145-jev-auto-mode.md) lets it through. It runs `save_loan_split`'s checks (now `private.loan_split_write`, which both call), so the parts take the loan's categories. A refusal of those checks writes nothing and answers `skipped: "refused"` with the reason; it is not an error. The line stays in לאישור: Jev never approves.

**Audit and undo.** The fill writes a `jev_prefills` row with `loan_id` and the parts written. `undo_jev_prefill` (and MCP `undo_jev_prefill`) clears that split while it is still the one Jev wrote, and returns `loan_id`; once the owner changed the parts or set the line, it answers `line changed since`.

**The candidates.** `jev_loan_candidates(company)` (service role) lists the open loans with a schedule and a balance, with their terms, rates and the amount of the newest attached payment. The job reads it only in auto mode, and a failed read lists no loans: the lines are still tagged.

## Alternatives rejected

- Asking Jev for the three amounts: every number stays in Flow's code ([0083](0083-jev-connector.md)), and the schedule already knows them.
- Asking Jev which loan: the amount names the loan for every recurring payment, and a guess between two loans with the same payment is worse than leaving the line to the owner.
- Matching by amount within a tolerance: an escrow change would match the wrong loan as easily as the right one; the last payment's exact amount covers the change from the second month on.
- Splitting without Jev, on every synced servicer line: the owner asked for it as Jev's fill, with Jev's switch, threshold and undo.

## Consequences

- From the next tagging run, a recurring loan payment in auto mode arrives in לאישור already split. The loan balance and the P&L move as soon as the split is written, while the line still waits for approval, as they do for any split on a posted bank line and for Jev's category fills ([0145](0145-jev-auto-mode.md)); undo puts them back.
- A payment that matches no loan, or two, waits for the owner as before, with the bank's hint, not a loan category.
- Lines already approved are not touched: the owner (or the MCP agent) attaches them with the match sheet or `attach_loan_payment`.
- The review card does not yet say that Jev split the line: [FLOW-1033](../backlog/tasks/FLOW-1033.md).
