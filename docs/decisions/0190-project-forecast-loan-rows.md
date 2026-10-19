# A project's next-month forecast takes its loans' interest and escrow from the loan

**Date:** 2026-10-19
**Status:** Accepted

## Context

A project's next-month forecast (ProfitNext, the ProfitProject card and the edit page) is the project's recurring charges due that month and a six-month average of every other expense category, over the months since the project's first expense in the window. A recurring charge that pays a loan (`pays_loan`) is left out, since its usual amount is the whole payment with principal; the loan's interest and escrow came in as the averages of their categories.

A loan younger than the window is badly diluted. One property's amortizing loan started 2026-09-01: payment 2,506.09 at 6.75%, with escrow 741.90. The owner set up the property's first costs in July, and the first payment was split into interest 1,530.00, escrow 741.90 and principal. The forecast showed interest −382.50 and taxes and insurance −185.48 ("ממוצע 4 חודשים"), that is 1,530 ÷ 4 and 741.90 ÷ 4. The owner expects the real monthly figures: about 1,527 interest and 741.90 escrow.

## Decision

The forecast takes a loan's profit parts from the loan's payments left, as the loan page shows them.

- For each loan filed under the project (`project_id`) that is open, has a schedule (amortizing, interest only or balloon; not demand) and is in the forecast's currency, the payment due in the forecast month gives:
  - its **interest**, in the loan's interest category;
  - its **escrow**, in the loan's escrow category.
- **The payment is the loan page's, from the balance in the books.** The loan page's payments left (FLOW-427: from the payment due today or later, recast from the loan's balance in `loan_balances`, keeping its payment, its months of interest only and its balloon) are what the forecast reads; the app shares one function for both (`paymentsLeft`). When next month's payment is the next one due, the forecast's interest and escrow are the loan page's "התשלום הבא".
- Principal never counts.
- A part's category is the loan's own, else the company's keyed category for that part (`categories.loan_part`), as a payment's split files it. A part whose category is kept out of the profit ([0166](0166-loan-interest-kept-out.md)) gives nothing, and so does a part of zero.
- Several loans in one category sum into one row.
- A month before the first payment left or after the last one (the balance in the books paid off, which can be before the original term), a closed or paid-off loan, and a demand loan give nothing.
- A category a loan row fills is left out of the averages, as a category a recurring charge files to is. A loan that gives nothing that month fills nothing, so its categories are averaged as before.
- **Row key.** A loan row keeps the key `avg:<category_id>`, so the owner's edits of that category's row (change, remove) keep applying, and `private.pfe_check_row_key` needs no change. Its kind is `loan`.
- **Words.** Under the row's name: "לפי ההלוואה" instead of "ממוצע N חודשים". On the edit page, the meta line reads "<month> · הוצאה · לפי ההלוואה" and the hint "ההלוואה עצמה לא משתנה. השינוי שלך גובר על לוח ההלוואה בצפי." The page's note reads "לפי הקבועים של הנכס, לוח ההלוואה וממוצע 6 החודשים האחרונים לכל קטגוריה" when a loan row is in the forecast. The card's basis counts them: "2 קבועים, 2 לפי ההלוואה ו־2 ממוצעים" ("שורה לפי ההלוואה" for one).
- **Reads.** The app reads the project's loans as the loan page reads a loan (the `loans` row with its `loan_rates`, and its balance in `loan_balances`, under the `loans` query key so a loan write refreshes it) and the company's categories (`list_categories`). No new RPC and no migration. MCP has what an agent needs to build the same rows: `list_loans` (terms, rates, part categories and `balance_minor`); `get_loan_schedule` gives the original schedule, which differs after an extra principal payment.

## Alternatives rejected

**Average only over the months since the loan's first payment.** Still a past figure: it misses the interest falling as the balance drops, a rate change, and the first month of a new loan before any payment.

**Count the loan payment's recurring charge and subtract principal.** The charge's usual amount is a median of past payments, and its split is per line. The schedule already holds each month's parts exactly.

**The loan's original schedule** (`buildLoanSchedule` on its terms and rates, ignoring the balance in the books). It was the first version of this rule. The owner compared the forecast with the loan page's "התשלום הבא" (interest 812.26, escrow 564.56 on a VA loan) and expects the two to match. They differ whenever the balance in the books is not the schedule's (an extra principal payment, a flagged split), and then the original schedule forecasts interest on principal already paid. Reading the loan page's own payments left keeps one number for one payment across the app.

**A new row key (`loan:<category_id>`).** It would drop the owner's existing edits of those rows and need a migration of `private.pfe_check_row_key`.

## Consequences

- The ProfitNext page, the ProfitProject card and the edit page show a young loan's real interest and escrow, the same as the loan page's next payment when it falls in that month.
- A forecast row moves when a payment is attached or a split corrected, since the balance in the books moves.
- The edit page's history bars still show the category's months in the project, so they can differ from the loan row's amount in the loan's first months.
- A loan whose payments are split to categories other than its own or the keyed ones (a payment split by hand) is forecast in its own categories.
