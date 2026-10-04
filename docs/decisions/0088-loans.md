# A loan is set up once and each payment is split

**Date:** 2026-10-04
**Status:** Accepted

## Context

A Mercury payment to a mortgage servicer lands whole in `תשלומי הלוואה`, which stays out of the P&L ([0086](0086-mercury.md)). The interest is a real expense. The escrow is taxes and insurance. The principal only pays the balance down. The connector contract named this and left it unaccepted. Eliran accepted it.

## Decision

A loan belongs to one company and is set up once, from a form or an MCP tool. The fields are the name or lender, principal, nominal annual rate, term in months, the first payment date, the payment amount, the escrow amount, and the currency. The currency stays the currency of the loan. Showing it in another currency is display-only, the same way a Mercury line stays dollars ([0087](0087-multi-currency.md)).

The schedule is monthly. Interest for a month is the remaining balance times the annual rate divided by 12, rounded half to even, in the loan's minor units. Escrow is the stored amount. Principal is the rest of the payment, and it reduces the balance. The last month pays whatever balance remains. A payment that clears the balance early ends the schedule. A payment that does not cover that month's interest and escrow is refused.

A matched bank line stays one transaction, with one `external_id` and one `amount_original`. Three split rows attach to it: interest in `ריבית משכנתא` (in the P&L), escrow in `מסים וביטוח` (in the P&L), and principal in `תשלומי הלוואה` (out of the P&L). The three amounts sum to the line. When the actual amount differs from the schedule, a correction replaces the amounts and keeps the scheduled figures for comparison. Project shares on the line do not change.

Until a line is split, the whole payment stays in `תשלומי הלוואה`.

The owner writes loans and splits. A demo viewer can read them. Anon cannot.

## Alternatives rejected

Three bank lines for one payment. Converting the principal to shekels at import. A stored balance that can drift from the principal parts. Putting escrow in `ביטוח`, which is a different expense. A second migration for the split table.

## Consequences

L-1 is the schema, the row level security, the two categories, and the schedule function. The form and the list read these tables. Matching writes the three split rows. The P&L reads still skip an excluded category, so interest and escrow enter the totals only when those reads are updated. That update comes after this migration has shipped.
