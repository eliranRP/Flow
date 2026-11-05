# A recurring charge that moves to another payee: the forecast stops expecting it, and Flow asks

**Date:** 2026-11-05
**Status:** Accepted (owner, 2026-11-05, on a card: "hide and ask")
**Amends:** [0179](0179-recurring-match.md) (only for the month forecast's hiding)

## Context

A company's loan moved to a new servicer. The old servicer's monthly charge (one project, a usual amount) stayed in the month forecast (תזרים צפוי, expected cash flow), while the new servicer's payment for the same project, at the same amount, was already in this month's cash. The month-end total counted the payment twice.

FLOW-430's suggestion ([0179](0179-recurring-match.md)) did not catch it. It looks for a late party's new name: a party first seen lately, with a name alike. Here the names share no word, and the new servicer was not new: it already paid other loans on other projects. Its answer also merges two whole parties (every line of one counts as the other's), which is wrong here: the new servicer has charges of its own. The move is one charge's, not a party's.

## Decision

**A likely handover, per charge.** A recurring charge ([0185](0185-recurring-charge-per-project.md): one party, direction, currency and project) that is due this month and has no line yet has a likely handover when a posted line this month, up to today, from another party has the same direction and currency, the charge's project, an amount within 2% of the charge's usual amount, and that party had no posted line on that project before this month. The nearest amount wins, then the latest line. A charge with no project never has one. A party the company already answered for the charge is not offered again. `private.recurring_handover` computes it.

**The forecast stops expecting it at once.** `expected_months` gives each `recurring[]` item a `handover`: null, or `{ party_id, party_name, transaction_id, doc_date, amount_minor }` while unanswered. The month forecast builder (`buildMonthForecast`: the app, Home and the MCP's `get_forecast`) leaves such a charge out of its items and totals, and this month's `by_currency` cells leave it out too, so the payment counts once, in today's cash. `missing_bills` does not call it late. The next months still expect the old charge until the owner answers.

This amends 0179's "nothing merges by itself" for the forecast only: the hiding happens before an answer, because the owner chose it. Nothing else changes until the owner answers: no override is written, no party is merged, no line moves.

**The answer is per charge and party.** `public.recurring_handovers` keeps it (RLS on, no client grants; written only by the functions). `answer_recurring_handover(p_direction, p_party_id, p_currency, p_project_id, p_to_party_id, p_same)`, owner or editor:

- **Yes:** the old charge gets its own "not recurring" override and the new party's charge on that project its own "recurring" ([0188](0188-recurring-switch-per-charge.md): the charge's own row wins over a party-wide one), so the next months expect the new payee. The overrides from before are kept with the answer.
- **No:** the old charge comes back into the forecast and the late bills, and the pair is not offered again.
- **Null:** the answer is taken back; after a yes, both overrides go back to what they were before it.

It returns what it replaced (`prior_same`, `prior_from_recurring`, `prior_to_recurring`) for the app's ביטול (undo). The MCP's `answer_recurring_handover` adds the idempotency key, the write rate limit and `undo` (kind `recurring_handover`, id: the write), which puts back the answer from before, and the overrides with it.

## Alternatives rejected

- Widening FLOW-430's suggestion (no name rule, an existing party): its yes merges whole parties, and the new servicer's other charges would become the old servicer's.
- Asking without hiding: the forecast would stay wrong, counting the payment twice, until the owner answers.
- Ending the old charge by itself: a payment from another party at the same amount can be a coincidence; the owner decides, and a no brings the charge back.

## Consequences

- Readers of `expected_months` get one more optional field; an older payload without it parses as before.
- The app's question (the card and its ביטול) is [FLOW-1038](../backlog/tasks/FLOW-1038.md).
