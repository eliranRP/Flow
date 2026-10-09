<a id="flow-106"></a>
# FLOW-106 · More loan types and loan fields
- **Type:** PLAN FIRST · **Status:** MCP side done (#132 #151 #157 #162); screens in progress (PR #343, layout B, owner's pick 2026-10-09) · **Depends on:** — · **Owner's approval:** 2026-10-08, the whole plan ("Approve all")
- **What:** Gaps found while setting up real mortgages: (a) balloon, interest-only and demand notes (no term, variable prime-linked rate); (b) a closed or paid-off status for historical loans; (c) attach a payment that includes fees and several missed installments; (d) per-loan category mapping for the split parts instead of the Hebrew defaults. MCP-first for each.
- **Plan (approved):** one PR at a time, MCP first, in this order. Screen fields go to the Mercury UI thread once the MCP side is merged.
  1. (b) `loans.status` (`open`, `paid_off`, `closed`) and `closed_on`, set with `update_loan`; a closed loan takes only payments dated on or before `closed_on`.
  2. (d) Per-loan categories for the parts (null keeps the defaults); interest, escrow and fees go to any expense category in the P&L, principal to one kept out.
  3. (c) A fourth part `fees`; `attach_loan_payment` takes `installments` (1 to 12) or exact `parts` that add up to the line.
  4. (a) `loans.kind` (`amortizing`, `interest_only`, `balloon`, `demand`), a `loan_rates` table and `set_loan_rate`. Demand interest is daily on actual/365; rates are entered by hand. Loan draws are out of scope.
- **Acceptance:** plan approved, then one PR per item with schedule tests at the boundaries.
- [ ] Screens (the project's plans/flow-106-loan-screens.md, layout B; PR #343):
  - [x] Copy for every loan refusal (`loan-copy.ts`, checked against the migrations).
  - [x] The loan page `/settings/loans/:id`: balance and status, סוג, ריבית and שינויי ריבית, פרויקט (moved from the list), מצב with the close date from the last payment, קטגוריות לחלקים.
  - [x] The list: open loans, then paid-off and closed under a collapsed "נסגרו (N)"; a row opens the loan page; the new-loan toast has פתיחה.
  - [x] (UI lane 1, 2026-10-09) The match sheet says what one tap writes on each loan: "לפי הלוח · $x", "N תשלומים לפי הלוח · $x" when the line equals 2 to 12 unpaid rows to the cent (that tap writes them together), and demand loans with "ריבית צבורה $x · השאר לקרן". A loan that cannot take the line shows off with its reason (closed or paid off before the line's date, before a demand loan's start, a later demand payment attached, above the balance). The match already saves through `save_loan_split`.
  - [x] (UI lane 1, 2026-10-09) The split editor "חלוקת התשלום", opened from "חלוקה אחרת" under the match sheet: by the schedule over 1 to 12 installments with fees off the top (demand loans: the accrued interest), or the lender's exact parts; fees name their category and can keep it on the loan.
  - [ ] Open the same editor from "עריכת החלוקה" on a matched line.
  - [x] (UI lane 1, 2026-10-09, #382) The kind field on the new-loan form: "סוג" first, רגילה by default, picked in a view inside the sheet like פרויקט. Interest-only adds "חודשי ריבית בלבד" and names the payment after them; balloon adds "פריסה בחודשים" and the balloon line; demand drops the term, escrow and עוד, the date reads "תאריך התחלה", and it saves with no term or payment.
  - [ ] The locked line in Categories for a category a loan uses (categories-screen is in #259).
