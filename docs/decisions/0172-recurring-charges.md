# Recurring charges: the owner's switch and big changes

**Date:** 2026-10-10
**Status:** Accepted (FLOW-415 server part; layout option A approved by the owner 2026-10-10. The app screens are UI lane 2's PR; pace, per-user dismissals and income alerts follow in a later server PR)

## Context

[0131](0131-jev-patterns.md) finds recurring suppliers and customers with a rule (a line in at least 3 of the last 6 complete months and in one of the last 2) and lists the late ones in `missing_bills`. The owner could not correct the rule, the late-bill row could not say which project or category it belongs to or what the last bill was, and nothing told the owner when a recurring charge came in much higher or lower than usual. FLOW-415 asks for all three, plus a way to keep one payment out of the cash view, which [0168](0168-cash-flow-view.md) already gives (`set_transaction_cash`, MCP `set_line_cash`).

## Decision

1. **The owner's switch.** `public.recurring_overrides` holds one row per company, direction, party (supplier for expenses, customer for income) and currency: `recurring` true or false. It is set from a payment, so it covers every line of that party in that currency. RLS is on and no client role can read or write the table; only the functions below do.
2. **The switch wins.** `private.recurring_parties(company, today, p_overrides default true)` drops parties marked false and adds parties marked true. A marked party with no complete month yet takes its usual day and amount from its latest month. Each row says `source`: `auto` (the rule) or `user` (the owner). `missing_bills`, `expected_months` and `recurring_changes` all read it, so the switch reaches every place recurring charges show. With `p_overrides` false it is the rule alone, which `payment_recurring` reports as `detected`.
3. **Richer late bills.** `missing_bills` adds `last_amount_minor` (the last bill's net), `project_name`, `category_name` and `source` to the existing `typical_day`, `last_doc_date`, `project_id` and `category_id`.
4. **Big changes.** `recurring_changes(p_today)` lists recurring suppliers seen this month whose lines so far (posted and pending) differ from the usual monthly amount by 20% or more, either way: `amount_minor`, `typical_amount_minor`, `change_percent` (signed, rounded), the month's latest `transaction_id` for the tap, and the project and category. Largest change first. Percentages only, never a multiple.
5. **Reads and writes.** `payment_recurring(p_id)` returns the line's party, `recurring`, `override`, `detected`, `typical_day` and `typical_amount_minor`. `set_payment_recurring(p_id, p_recurring)` (members who can write; `null` clears the switch) returns the same plus `prior_override`, which the app's undo toast puts back.
6. **The MCP.** `get_recurring_changes`, `get_line_recurring` and `set_line_recurring` (undo kind `line_recurring`: a conflict once the switch was changed since). `get_missing_bills` and `get_expected_months` carry the new fields.

## Consequences

- A party the rule missed (a new supplier, or one billed every two months) can be marked recurring and then shows in late bills and expected months from its latest month. Pace other than monthly comes with the follow-up PR.
- Marking a party not recurring hides it everywhere, including Jev's expected months, until the owner clears the switch.
- The switch is per currency: a supplier billed in two currencies has two switches.
