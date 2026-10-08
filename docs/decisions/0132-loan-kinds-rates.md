# A loan can be interest-only, balloon or on demand, and its rate can change

**Date:** 2026-10-08
**Status:** Accepted (owner approved the FLOW-106 plan, 2026-10-08)

## Context

[0088](0088-loans.md) holds one shape of loan: a level monthly payment over a fixed term at one rate. Real books also hold a hard-money loan that pays interest only, a note that amortizes over 30 years but is due in 5, partner loans with no term and no schedule (some at 0%), and loans whose rate follows an index such as prime. [0122](0122-loan-status.md), [0128](0128-loan-part-categories.md) and [0130](0130-loan-fees-installments.md) were FLOW-106 parts 1 to 3; this is part 4. The owner approved the plan's defaults: demand interest is daily on actual/365, rounded half to even; prime is entered by hand as rate rows; loan draws are out of scope.

The same change folds in the open loan follow-ups FLOW-132 (closed loans), FLOW-134 items 1 and 4 (part categories) and FLOW-135 N1 and N3 (installments).

## Decision

**Kinds.** `loans.kind` is `amortizing` (the default: every loan saved before keeps its schedule exactly), `interest_only`, `balloon` or `demand`. One check constraint (`loans_kind_chk`) holds the fields of each kind, for the app and MCP alike:

- `interest_only`: `interest_only_months` from 1 to the term. Those rows pay interest and escrow only. Later rows use the stored payment, which for this kind is the payment after the interest-only months (MCP's default: the annuity over the months left, or over one month when they equal the term, so the principal is due in the last month).
- `balloon`: `amortization_months` from the term to 600. The payment is the annuity over those months, and the row at the term pays the rest of the balance (reported as the schedule's balloon). A loan saved before with a payment below the annuity stays an amortizing loan with a balloon, as 0088 says.
- `demand`: no term, no payment and no escrow (`term_months` and `payment_minor` are null for this kind only). Nothing is scheduled ahead.

**Payment covers interest, per kind.** The database guard of FLOW-111 skips a demand loan (no payment) and holds an interest-only or balloon loan to the same rule as an amortizing one: the stored payment less escrow covers a month of interest on the whole principal, which is the balance when that payment first falls due.

**Rate rows.** `loan_rates` (`loan_id`, `effective_date`, `annual_rate_ppm`, unique per loan and date, row level security like `loans`) holds rate changes. The rate in force on a date is the latest row on or before it, else the loan's own `annual_rate_ppm`. A schedule row uses the rate on its due date. When the rate in force differs from the rate the payment was set at, principal-and-interest is recast from that row: the annuity of the balance over the months left to amortize (to the term, or to `amortization_months` for a balloon), rounded half to even. An `amortizing` loan whose stored payment is below the term annuity (an implicit balloon, 0088) amortizes over the period that payment implies: the smallest number of months n, from the term on, whose annuity (rounded half to even, like the level payment) is at or below the stored principal-and-interest, at most 600 (`impliedAmortizationMonths`). It is recast over the months left in that period, so the payment moves with the rate and the balloon stays at the term; recast over the months left in the term, 100,000.00 at 6% for 60 months with a 360-month payment would jump about 3.5 times at a move to 6.5%. So a schedule never has a payment below the interest, and a loan without rate rows is never recast. Flow does not fetch an index; MCP `set_loan_rate` adds, changes or removes a row (null removes), refuses a date before the loan's start (`rate before the loan start`), and undo kind `loan_rate` (the row's id) puts the row back as it was, or is `conflict` if it changed since. Payments already attached keep their parts.

**Demand interest.** When a payment is attached to a demand loan, interest is the balance left after the payments already attached, times the rate in force on each day, for the days since the last attached payment (or since the start), on an actual/365 basis, as one exact sum rounded half to even once, plus the interest carried from before; the rest is principal (`allocateLoanSplit`, so a line smaller than the interest pays interest only). Interest is simple: each period between payments accrues on the balance at its start, rounded half to even on its own; a payment's interest part pays that period's accrual and what was carried before it, and what it leaves unpaid is carried forward (it earns no interest, and an interest part above what was due carries nothing back). So 50,000.00 at 8% from 2026-01-01 accrues 986.30 by 2026-04-01; a 500.00 payment that day pays 500.00 of interest and 486.30 is carried, and a 2,000.00 payment on 2026-05-01 pays 486.30 plus 328.77 of interest and 1,184.93 of principal. Payments counted are those on lines still on the books and not waiting for review, pending lines included. A line dated before the start is `payment before the loan start`; one dated before a payment already attached is `a later payment is already attached` (attach in date order); `installments` is `a demand loan has no schedule rows`. A line already split on this loan skips the date-order check, so a replay of the same attach returns the stored response. `get_loan_schedule` for a demand loan returns those payments with the balance after each, and `accrued`: the interest due on `as_of` (default today, UTC), with `carried`, the part earlier payments left unpaid.

**Where the math lives.** All of it stays in `packages/shared/src/loan-schedule.ts` (`buildLoanSchedule`, `regularPaymentMinor`, `rateOnDate`, `demandAccrual`, `demandStatement`), shared by the app and MCP. `mcp_list_loans` returns the kind fields and the rate rows; `mcp_loan_payments` lists a loan's attached payments by part.

**The first unpaid row (FLOW-135 N1).** `installments` starts at the first schedule row whose scheduled interest plus principal through it is more than the interest plus principal already attached (pending lines included, review-flagged ones and the line itself left out). Escrow and fees are left out: they do not pay the loan down, and escrow drifts from the schedule. So an interest-only row counts once its interest is paid, a part-paid row stays unpaid, two attaches before the first line posts do not start on the same row, and a replay starts where the first attach did. A row with neither interest nor principal (a 0% interest-only month) is paid as soon as the rows before it are.

**Exact parts need no row (FLOW-135 N3).** `parts` on a date with no schedule row is accepted; the scheduled figures stored for comparison are then 0.

**Closed loans (FLOW-132).** A line attached to a loan that is not open, which comes back from removal or whose `doc_date` moves past `closed_on`, cannot be refused (the bank sync and undo write it). Its parts are flagged for review instead, as [0121](0121-loan-balance-checks.md) does for the balance, and clearing that review runs the closed check again (`loan_closed`). Like 0121 the trigger never waits for the loan: if another write holds it, the parts are flagged anyway. `get_project`'s `loans[]` gains `status`, `closed_on` and `kind`.

**Part categories (FLOW-134).** `merge_category` moves a loan's part category from the merged category to the target when the target fits that part (`private.loan_part_category_ok`); otherwise the merge is refused (`a loan uses this category for a part the other category cannot take`) and nothing moves. Parts already attached keep their category, as when a loan's categories change ([0128](0128-loan-part-categories.md)). `mcp_update_loan` checks the four part categories in one loop, and the loans part-category trigger runs on an update only when one of them changes.

## Alternatives rejected

- Monthly (1/12) interest on a demand loan: simpler, but wrong for irregular partner repayments (the owner's default).
- Dropping the interest a short demand payment leaves unpaid (restarting from the payment's date): the next payment would book too much principal. Compounding it instead: simple interest is the review's rule and keeps each figure checkable by hand.
- Recasting an amortizing loan with an implicit balloon over the months left in the term: a rate change would remove the balloon the stored payment implies and multiply the payment.
- Fetching prime: another outside dependency for a rate that changes a few times a year.
- Keeping the stored payment after a rate change: a rise could leave the payment below the interest and break the schedule.
- A term and payment of 0 for a demand loan: they would read as real figures; null says there are none.
- Refusing a restored or re-dated line on a closed loan: it would fail the whole bank sync, the reason 0121 flags instead.
- Moving attached parts on a merge: the same reason 0105 and 0128 leave attached parts where they are.

## Consequences

The bookkeeping agent can record an interest-only hard-money loan, a balloon note and the partner loans (as 0% or interest-bearing demand loans), and enter prime changes as rate rows. The app reads the kind and rate rows when it splits a payment by the schedule; it does not offer a demand loan in the match sheet (MCP `attach_loan_payment` splits those). Setting the kind and rates from the loan sheet goes to the Mercury UI thread with the rest of FLOW-106. Loan draws stay out of scope.
