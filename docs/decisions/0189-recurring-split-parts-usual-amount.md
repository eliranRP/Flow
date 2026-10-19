# A recurring charge counts its own split parts, and the owner can set its usual amount

**Date:** 2026-10-19
**Status:** Accepted

## Context

One rent platform pays several properties' rent in one bank transfer, and the owner splits each transfer into parts ([0104](0104-line-split-by-category.md)). One property's transfer is rent 1,700, electricity 171.76 and water 183.10; two earlier months were not split (1,757.40 and 2,013.33). Another property's transfer is a tenant deposit 2,500 (a kept-out category), that property's prorated rent 161.29 and a third property's rent 564.39.

A recurring charge ([0185](0185-recurring-charge-per-project.md), [0188](0188-recurring-switch-per-charge.md)) read whole lines, so the first property showed 1,757.40 usual and 2,054.86 this month, and the second showed 3,225.68: the transfer, not the rent. The owner says the first property's rent is 1,700 and the second's is 2,500, a figure no month of lines shows.

## Decision

**Split parts.** A recurring charge reads `private.recurring_line_parts`: every line it read before, with a split line (two or more `line_splits` parts that sum to the line and no loan split, as `pnl_lines` counts it) replaced by its parts.

- A part in a kept-out category (`excluded_from_pnl`: a deposit, loan principal) never counts.
- A part is for its own project, else the line's ([0104](0104-line-split-by-category.md)).
- **The charge's part.** Of a line's counted parts for one project, the charge takes one: the part in the line's own category, else the largest. The rule looks at the line alone, so a line counts the same in every window and every reader, and a split line's main category (the one its "rest" part takes) is the one the owner filed the transfer under. In the first transfer that is rent 1,700; in the second, whose own category is the kept-out deposit, it is each property's rent part.
- A part for another project counts for the party's charge there: the second transfer gives the third property's rent charge 564.39 that month.
- An unsplit line is read whole, as before.

`recurring_stream_lines` reads these parts, so every reader of a recurring amount follows: `recurring_parties` (each month's amount and the last bill), the arrival this month and its change (`recurring_this_month`, `recurring_changes`), the schedule, missing bills, `expected_months` and the forecasts built on it. `party_charges` (MCP `get_line_charges`) counts the line's own part in its context, and a project's arrivals count each charge's parts for that project. A line's own charge is the one its part for its own project feeds, else its largest part's. The newest line of a charge (`recurring_party_line`) prefers a line whose own part is that charge's, so the charge page writes through a line of its own. Loan splits (`loan_splits`, `pays_loan`) are unchanged.

**The owner's usual amount.** `recurring_overrides.typical_amount_minor` (positive, at most 999,999,999,999 minor units, in the charge's currency) is the owner's usual amount for one charge, on the charge's own row ([0188](0188-recurring-switch-per-charge.md)); a charge with no project reads the row with no project.

- When set, it replaces the computed median, with the direction's sign, in `recurring_parties` and every reader downstream. `typical_amount_source` says `owner` or `computed`.
- Days and pace are computed or overridden as before.
- A charge with the owner's amount and the switch on recurs with no complete month yet, and its arrival is compared with that amount. The amount alone does not make a charge recur.
- **No change alert in a first month.** In a charge's first month seen (no complete month yet), an arrival against the owner's amount is not a change: `changed` is false, `recurring_changes` and a project's changes leave it out, and the app shows no banner or ▲. The percent is still reported. A first month is often partial (a prorated rent of 161.29 against 2,500 reads −94%), and the owner typed the amount for the months to come.
- `set_payment_amount(p_id, p_amount_minor, p_project_id default null)` writes it for the line's charge through `private.write_recurring_override`, owner or editor only. Null clears it. It returns `prior_amount`, which the app's ביטול writes back.
- **A charge with no line of its own.** The third property's charge is fed only by the second property's split transfer. `set_payment_recurring`, `set_payment_pace` and `set_payment_amount` take an optional `p_project_id`: the charge of another project the line feeds (`private.line_charge_project`; a project it does not feed is refused). The charge page, its "הסתיים" and its pace pass the charge's project. MCP `set_line_recurring`, `set_line_pace` and `set_line_usual_amount` take an optional `project_id`, kept in their undo.
- MCP `set_line_usual_amount(transaction_id, amount, idempotency_key, project_id?)` takes major units, with undo kind `line_amount`: a conflict once the amount changed since, and the undo goes to the same charge's row. `get_line_recurring` reports `typical_amount_source` and `owner_amount_minor`, and `get_recurring_schedule` reports `typical_amount_source`.
- **The app.** On the charge page, a "הסכום הרגיל" row shows the usual amount, with "קבעת" when the owner set it. Tapping it opens a sheet with the forecast edit page's amount field. שמירה writes it and toasts "הסכום הרגיל עודכן: <name>" with ביטול. "חזרה לחישוב" clears it.

## Alternatives rejected

**The charge's category across its lines.** A rule like "the category the party's parts for the project use most" depends on the window and on other months' lines. A line's count would then change as months pass and differ between readers with different windows (the line page reads 24 months back from the line's month). The line's own category, else the largest part, gives the same answer for a line everywhere.

**Counting every counted part of the project.** The first transfer's electricity and water recharges are filed to the same property. Counting them would keep the usual amount at the transfer.

**Letting the owner's amount make a charge recur.** The switch is the owner's word for that ([0188](0188-recurring-switch-per-charge.md)). An amount typed for a charge that has stopped would bring back its late alerts.

## Consequences

- A party whose lines are not split reads exactly as before.
- A split line can show in more than one charge's history, each with its own part.
- The line page's comparison uses the charge's usual amount when every line of the line's project is in its context. Before, every one of the party's lines had to be in it, so a platform paying several properties always fell back to the median of earlier months.
- Clearing a charge's amount keeps its switch and pace. A row with no word left is removed.
- The charge page writes through the charge's newest line and names the charge's project, so a charge fed only by another property's split transfer is the one changed.
