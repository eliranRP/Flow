# A recurring charge is a party's charges for one project

**Date:** 2026-10-18
**Status:** Accepted

## Context

[0172](0172-recurring-charges.md) and [0175](0175-recurring-pace-dismissals.md) read one recurring charge per supplier or customer and currency. The owner pays one loan servicer for several properties: one payment per loan, each filed to its own project. In קבועים they showed as one charge with one project. Its month summed every property's payment, so the usual amount and this month's arrival were the total of several loans. The change percent compared months with different numbers of payments in them. The owner's words: the servicer's loan should be split by project; different payments were merged.

## Decision

A recurring charge is a party's lines in one currency **for one project**. `private.recurring_stream_lines` gives each line the project its charge belongs to:

- A filed line goes to its own project.
- A line not filed yet goes to the party's project whose latest filed line is closest in amount. A new payment that has not been reviewed yet still arrives on its own property's charge.
- A party with no filed line has one charge with no project, as before.

`recurring_parties` keys by party and that project. `project_id` in its rows is the charge's project, where it used to be the party's most common project.

Every reader that keyed by party now keys by party and project:
- the arrivals and changes (`recurring_changes`, `recurring_this_month`);
- a project's arrivals;
- the schedule (`recurring_schedule`);
- the late bills (`missing_bills`);
- a line's recurring state (`payment_recurring`);
- the newest line of a charge (`recurring_party_line`, which takes `p_project_id`).

A late bill's `alert_key` adds `:<project_id>` for a party with more than one charge. A party with one charge keeps the key it had, so no dismissal comes back.

The owner's switches stay per party and currency: recurring or not ([0172](0172-recurring-charges.md)) and the pace ([0175](0175-recurring-pace-dismissals.md)). So does the answer that two parties are the same (FLOW-430). Each switch applies to every one of the party's charges.

In the app, a split party's charges are separate rows in קבועים. Each one opens its own page (`/recurring/:direction/:partyId?project=`).

## Alternatives rejected

**One charge per loan.** A payment attached to a loan knows its loan. But a utility or an insurer that bills several properties has no loan, and a new payment is not attached until it is reviewed. The project covers both.

**Splitting by amount alone.** Payments that change over time (escrow, a rate change) would jump between charges. The project the owner filed is the stable key, and the amount only places a line not filed yet.

## Consequences

- A party whose lines are filed to one project reads exactly as before.
- A line filed once to another project starts a separate charge there. It shows only if that project's lines recur on their own.
- The line page's charges (`party_charges`, [0178](0178-party-charges.md)) already compared a line with its own loan or project, so it does not change.
