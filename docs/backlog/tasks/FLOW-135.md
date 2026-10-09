<a id="flow-135"></a>
# FLOW-135 · Loan installments follow-ups (FLOW-106 part 3 review)
- **Type:** BACKLOG NIT · **Status:** done (#162) · **Depends on:** FLOW-106 part 3
- [x] N1. `attach_loan_payment` `installments` finds the first unpaid row from the principal already paid: a part-paid row counts as unpaid; extra principal paid ahead skips rows; a row with zero scheduled principal always counts as paid; and pending lines do not lower the balance, so two quick installment attaches before the first line posts start on the same row. (The first unpaid row now compares interest plus principal attached, pending lines included: `paidInterestAndPrincipal` in `loan-split.ts`, decision 0132.)
- [x] N3. Exact `parts` still need a schedule row for the line's date (`no schedule row for this date`), although the scheduled figures are only kept for comparison. (Accepted with scheduled figures of 0, decision 0132.)
