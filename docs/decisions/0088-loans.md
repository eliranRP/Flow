# A loan is set up once and each payment is split

**Date:** 2026-10-04
**Status:** Accepted

## Context

A Mercury payment to a mortgage servicer lands whole in `תשלומי הלוואה`, which stays out of the P&L ([0086](0086-mercury.md)). The interest is a real expense. The escrow is taxes and insurance. The principal only pays the balance down. The connector contract named this and left it unaccepted. Eliran accepted it.

## Decision

A loan belongs to one company and is set up once, from a form or an MCP tool. The fields are the name or lender, principal, nominal annual rate, term in months, the first payment date, the payment amount, the escrow amount, and the currency. The currency stays the currency of the loan. Showing it in another currency is display-only, the same way a Mercury line stays dollars ([0087](0087-multi-currency.md)).

The schedule is monthly. Interest for a month is the remaining balance times the annual rate divided by 12, rounded half to even, in the loan's minor units. Escrow is the stored amount. Principal is the rest of the payment, and it reduces the balance. The last month pays whatever balance remains. A payment that clears the balance early ends the schedule. A payment below that month's interest is refused, because the balance must not rise. A payment equal to the interest is kept, and so is any shorter payment that still covers the interest. A loan is a balloon only when the entered principal-and-interest payment is more than one cent below the exact, unrounded annuity. Escrow is left out of that comparison. A payment within normal rounding is never a balloon, so 600.00 against an annuity of 599.55 is not one, and 254.71 on 26,319.35 at 11.2 percent over 360 months is not one. At 112,042 parts per million the same 254.71 stays quiet and 254.70 is a balloon. When a full term ends on a final payment that differs from the regular one only because of rounding, the schedule reports that adjusted final payment. An early payoff does not, and neither does a full term whose principal-and-interest sits outside one cent of that annuity. The form shows one line. תשלום אחרון מותאם, with the amount, when the difference is only rounding and the final principal-and-interest is under twice the regular one. When it is exactly twice, that line is התשלום האחרון כפול, with the amount, in the warning colour at hint size, and the adjusted line is not shown again. Above twice, the line is התשלום האחרון גבוה פי N, with N floored to one decimal and never below 2.1, and a trailing zero dropped, so 2.02 is פי 2.1, 2.95 is פי 2.9, and three times is פי 3, and the amount once. Escrow is left out of both sides, so a large escrow on a level loan does not warn. A 600 month term that ends at exactly twice the regular one uses the כפול line. 34,910.09 at 29.8 percent over 480 months is פי 2.9. The same amount is never printed twice. The level payment is that annuity rounded half to even, so one half rounds up to the even minor unit and the other half rounds down to it. The rate field keeps four decimal places, so 11.2042 is stored as 112,042 parts per million. The schedule function returns the rows, the balloon, and the adjusted final payment separately.

A matched bank line stays one transaction, with one `external_id` and one `amount_original`. Three split rows attach to it: interest in `ריבית משכנתא` (in the P&L), escrow in `מסים וביטוח` (in the P&L), and principal in `תשלומי הלוואה` (out of the P&L). The three amounts sum to the line. When the actual amount differs from the schedule, a correction replaces the amounts and keeps the scheduled figures for comparison. Project shares on the line do not change. The owner can change a part's amount and its category. The owner cannot set the review flag. The line, the loan, the company, and which part the row is stay fixed, and a change that does move a part still rechecks the line it left. An income line cannot be split. A loan's currency cannot change once a split exists.

A connector re-sync that changes a split line's amount or currency does not fail. Every part of that line is marked `needs_review`, and the sum and the currency wait until the flag is cleared, so a later screen can offer the correction in one tap. Only that re-sync, and the service role, can set the flag. `clear_loan_split_review` clears it for the owner once the parts match the line amount and the loan currency. The balance subtracts principal only from a posted line that is still on the books and is not flagged. The view counts the flagged parts.

Until a line is split, the whole payment stays in `תשלומי הלוואה`.

The owner writes loans and splits. A demo viewer can read them and cannot insert, update, or delete them. Anon cannot.

## Alternatives rejected

Three bank lines for one payment. Converting the principal to shekels at import. A stored balance that can drift from the principal parts. Putting escrow in `ביטוח`, which is a different expense. A second migration for the split table.

## Consequences

L-1 is the schema, the row level security, the two categories, and the schedule function. The form reads these tables. Matching writes the three split rows. The P&L reads still skip an excluded category, so interest and escrow enter the totals only when those reads are updated. That update comes after this migration has shipped.

The setup form computes the monthly payment as the exact annuity rounded half to even, then adds the escrow. It reads the adjusted final payment from the schedule instead of deriving it, and it shows that figure once. At exactly twice the regular principal-and-interest the line is התשלום האחרון כפול, with the amount. Above twice it is התשלום האחרון גבוה פי N, with N floored to one decimal and never below 2.1, and a trailing zero dropped, and the same amount. ✕, Escape, Back, and a successful save discard the draft. Otherwise it is תשלום אחרון מותאם. The 2× line is warning colour at hint size and replaces the adjusted line. The payment stays under an advanced field so a balloon can still be entered. The currency control is a ₪/$ toggle under the principal, and it starts as the company's currency. `companies.display_currency` is not in the schema yet ([0087](0087-multi-currency.md)), so a company whose open lines are all USD starts in dollars, and every other company, including one with no lines, starts in shekels.
