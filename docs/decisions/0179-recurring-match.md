# Recurring charges: a renamed supplier is suggested, and the user decides

**Date:** 2026-10-10
**Status:** Accepted (FLOW-430; the owner's rule of 2026-10-10. Builds on [0172](0172-recurring-charges.md) and [0175](0175-recurring-pace-dismissals.md))

## Context

A recurring supplier's bill sometimes comes in under a different name (a longer legal name, a new brand). The bank sync then makes a new supplier, `private.recurring_parties` sees no bill for the recurring one, and the קבועים screen lists it under לא הגיעו although the money went out. The owner does not want names merged by themselves: a different name may be a different payee. Flow may suggest that two names are one supplier, and the user decides.

## Decision

1. **The answer.** `recurring_matches` holds the company's answer for a pair in one direction: the recurring party (`party_id`) and the suggested one (`match_party_id`) are the same (`same` true) or not (false). RLS on, read and written only through the functions. A party is the same as one recurring party at most, and a matched party takes no matches of its own (one step, no chains).
2. **"The same" counts.** `private.recurring_parties`, `private.recurring_arrivals` and `private.payment_party` count a matched party's lines as the recurring party's. Its bill arrives, הגיעו החודש shows it with its amount, expected months follow, and the payment page's switches act on the recurring party.
3. **The suggestion.** Each `missing_bills` row has `suggestion`: null, or one party that may be this one: first seen in the due month or the month before, same direction and currency, a name alike (the same first word of 3 letters or more, or one name's words inside the other's), its newest line within 50% of the usual amount, and no answer for the pair. The nearest amount wins. It names `party_id`, `party_name`, `transaction_id`, `doc_date` and `amount_minor`.
4. **Writing it.** `answer_recurring_match(p_direction, p_party_id, p_match_party_id, p_same)`, owner or editor; null takes the answer back, and it returns `prior_same` for ביטול. The MCP's `answer_recurring_match` adds the idempotency key and an undo (kind `recurring_match`, id: the suggested party).

## Alternatives rejected

- **Merge alike names on sync.** The owner's rule: a name change is never merged by itself.
- **Merge the two supplier rows.** Changes the books' supplier on past lines and can't be undone cleanly; the answer table keeps both suppliers and only joins them for recurring charges.

## Consequences

- Nothing changes until someone answers; a "no" stops the pair's suggestion for the whole company.
- The suggested supplier stays its own supplier everywhere else (search, review, reports).
