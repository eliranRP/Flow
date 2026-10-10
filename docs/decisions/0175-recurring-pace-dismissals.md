# Recurring charges: pace, income and per-user dismissals

**Date:** 2026-10-10
**Status:** Accepted (FLOW-415 server PR 2; the owner's additions of 2026-10-10 08:40–08:43Z. Builds on [0172](0172-recurring-charges.md). The app screens are UI lane 2's PR)

## Context

[0172](0172-recurring-charges.md) treats every recurring charge as monthly, lists late bills and changes for suppliers only, and shows every alert to everyone in the company. The owner asked that a charge can repeat every month, every 2 months, every quarter or every year, and that the user can change it; that recurring income gets the same alerts as expenses, with a קבועים screen whose הגיעו החודש section lists what came in this month; and that each user can dismiss a late bill or a change for themselves.

## Decision

1. **Pace.** `private.recurring_parties` returns `pace` (`month`, `2months`, `quarter`, `year`), `pace_source` and `next_due_month`, reading 24 months of lines. Detection: every 2 months or quarterly when the last two gaps between complete months are both 2 (or 3) and the party is at most one cycle behind; monthly by the old rule (3 of the last 6 complete months and one of the last 2); yearly when the last gap is 11 to 13 months and it is at most a month behind. A monthly party keeps its old usual day and amount (the last 6 months); other paces use the 24 months.
2. **The owner's pace.** `recurring_overrides.pace` (null: detected). A row now holds the recurring switch, the pace, or both; clearing one keeps the other. `set_payment_pace(p_id, p_pace)` returns the state and `prior_pace` for ביטול. `payment_recurring` adds `pace`, `pace_override`, `detected_pace` and `next_due_month`.
3. **Due and late.** A monthly party is due this month until its line comes, as before. Any other pace is due one pace after the last month it was seen. `missing_bills` lists parties whose due month has come with no line, past the usual day plus 5 in the due month (or its last day).
4. **Income.** `missing_bills`, `recurring_changes` and the new `recurring_this_month` cover suppliers and customers. Each row has `direction`, `party_id` and `party_name`; `supplier_id` and `supplier_name` stay, null on income rows.
5. **הגיעו החודש.** `recurring_this_month(p_today)` lists every recurring party seen this month with this month's amount, the usual amount, `change_percent` and `changed` (20% or more either way). `recurring_changes` is the changed rows of the same list.
6. **Dismissals.** `recurring_dismissals` holds one user's dismissed alerts, read and written only for the caller through `dismiss_recurring_alert(p_kind, p_key)` and `undismiss_recurring_alert` (the undo). Each row's `alert_key` is the key: a late bill's is direction, party, currency and due month, so the next cycle's bill shows again; a change's is the payment's line. `missing_bills` and `recurring_changes` leave out what the caller dismissed; `recurring_this_month` does not.
7. **The MCP.** `set_line_pace` (undo kind `line_pace`) and `get_recurring_this_month`. The rows of `get_missing_bills` and `get_recurring_changes` carry the new fields; a token's dismissals are its user's. The MCP has no dismiss tool.

## Consequences

- A charge billed every 2 months is no longer late every other month, and its expected months fall only on its due months.
- A party that is late and stays late keeps one alert for its due month; a dismissal holds until a line comes and the next due month moves on.
- A change dismissal holds for that payment; a second payment the same month is a new line and shows the change again with the new total.
