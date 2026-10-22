# Balance-sheet accounts through book_line: kept-out categories bind to asset and liability accounts

**Date:** 2026-10-22
**Status:** Accepted (FLOW-953, step 3 of [0209](0209-legs-source-of-truth.md). Builds on [0208](0208-balanced-legs-ledger.md))

## Context

The company's AI bookkeeper books closing wires and loan lines with `split_line`, because `book_line` refused every leg that is not an in-P&L category: loan principal, escrow, the purchase price. These lines are common:

- **A closing wire.** Bank −X = the purchase price (an asset, kept out of the P&L) + closing costs + prorated property tax − the seller's property-tax credit − the loan the lender funds at closing (a liability).
- **A refinance deposit.** Bank +X = the new loan (a liability credit) − the old loan paid off (a liability debit) − closing costs − escrow funding (an asset debit).
- **A mortgage payment.** Bank −X = interest (an expense) + escrow (an asset) + principal (a liability debit).

Since 0209 a kept-out row is a leg on a balance-sheet account, but only three accounts were reachable: Loan principal and Escrow by a category's loan part, and Suspense for everything else. A purchase price or an owner contribution landed on Suspense, so the legs could not say what the money was.

Until FLOW-952 flips the P&L to the legs, the P&L still reads the legacy rows, so every booking must also be written as legacy rows that the P&L reads correctly.

## Decision

1. **Two new system accounts:** Transfers in transit and Property, both asset. Every company now has Loan principal, Escrow, Owner capital, Security deposit held, Transfers in transit, Property and Suspense as balance-sheet accounts.

2. **A kept-out category posts to one balance-sheet account.**
   - `categories.ledger_account_id` is a composite FK to `accounts`, null by default.
   - `private.kept_out_account` reads the binding first, then the loan part (principal to Loan principal, escrow to Escrow), then Suspense.
   - A category is bound by its **name** when it is created, by the after-insert trigger that already provisions its account (`private.kept_out_default_account`). The names are the built-in kept-out names, so they come from the same list as `private.non_pnl_category`, matched by kind:
     - loan proceeds and `כסף שהתקבל מהלוואות` to Loan principal;
     - owner contributions and owner distributions to Owner capital;
     - security deposits received and returned to Security deposit held;
     - internal transfers in and out, and `העברות`, to Transfers in transit;
     - property purchase price, purchase deposits (with or without "earnest money"), closing & acquisition costs, capex & rehab, and furniture & fixtures to Property.
   - A category named like one of these accounts binds to that account, whatever its kind.
   - Loan-part categories are never bound; their part routes them.
   - A rename keeps the binding, as it keeps the P&L flag.
   - The migration binds existing categories the same way. The categories trigger re-posts a category's lines when its binding changes, so their legs move from Suspense to the bound account. The FLOW-951 gate then proves the shadow P&L still equals the posting rules for every company.
   - A binding moves only legs, never a P&L figure. The P&L reads the category and its kept-out flag, and `ledger_pnl_diff` compares `in_pnl` (asset or liability, either way false), not the account.

3. **`book_line` takes asset and liability legs, mirrored as kept-out category parts.**
   - A leg on a kept-out category's own account uses that category and lands on its account (`posts_to` in `list_accounts`).
   - A leg on a balance-sheet system account (any except Suspense and VAT control) uses the kept-out category of the leg's side that posts there: a debit an expense category, a credit an income category. That is how the built-in kept-out categories already pair up: loan proceeds and loan principal, owner contributions and distributions, deposits received and returned, transfers in and out.
     - With none, `book_line` makes a **hidden** kept-out category named like the account. Its name binds it, so a restored copy binds again. It is kept on undo and reused by the next booking.
     - With more than one, `book_line` refuses and asks for the category's own account. It never guesses.
   - The part's sign follows 0208 item 9: opposite to the bank leg it counts toward the line; with the bank leg's sign it is a gross-up part, which needs a project. The sign rules of `pnl_lines` place a kept-out part correctly in either kind, and `save_line_split` writes it with every split rule.
   - The P&L of a `book_line` booking is therefore, by construction, the P&L of the equivalent `split_line` booking with the same categories.

4. **The self-check compares accounts.** The item legs that posting derives from `pnl_lines_legacy` are grouped by account, project and sign. They must equal the requested legs, each mapped to the account it posts to (a kept-out category's leg to its balance-sheet account, an in-P&L one to its own). This is stricter than 0208's per-category projection: a kept-out part that would land in profit, or on another account, is refused rather than booked.

5. **Loans.** A loan's balance is its principal less the principal parts of its attached `loan_splits`. A `book_line` part is a `line_split`, so it never moves a tracked loan's balance, and it cannot corrupt one either.
   - **Allowed:** `book_line` takes principal and escrow legs. A line that already has a loan split is still refused (`line has a loan split`). A loan split attached to a booked line later decides that line's P&L, because loan splits win in `pnl_lines`.
   - **Documented:** for a payment of a loan Flow tracks, use `attach_loan_payment`. Use `book_line` for loan money Flow does not track as a payment: proceeds funded at a closing, a refinance, a payoff, or a payment of an untracked loan.

6. **Transfers between own accounts** stay one line per bank. Each line gets its bank leg and a Transfers in transit leg, filed under the transfer category of its side. The pair nets to 0 on Transfers in transit. A transfer filed to `העברות` by any tool posts there too.

7. **Refused:**
   - a VAT leg (VAT control; still a later phase);
   - more than one bank leg;
   - Suspense and the Uncategorized accounts;
   - a kept-out leg on an existing line switched into the P&L by `set_line_pnl`, since the override counts every part that has no loan part.

   Legs carry no currency, so a booking is always in the line's one currency, and a leg with a `currency` key is `validation`. The new reasons join `mcp_refused`'s allowlist and replace the phase-1 reason, which is no longer raised. `account not found` and `transaction not found` stay as they are, so nothing says whether another company's account or line exists. The signature is unchanged, so `privilege_guards` and `cross_company_sweep` cover it as before.

8. **Reads.**
   - `list_accounts`: `bookable` covers every category account and every balance-sheet system account except Suspense and VAT control, and `posts_to` names a kept-out category's account.
   - `get_line_legs`: `category_id` and `category_name` name the category behind every leg, kept-out legs included.

## Alternatives rejected

- **A balance-sheet account per kept-out category.** It makes list_accounts long and splits one real balance across several accounts: loan proceeds and loan principal would be two liabilities, and transfers in and out would never net. Shared system accounts with sign-paired categories keep one balance per kind of money.
- **Every kept-out category on Suspense, with only hidden categories for the system accounts.** The P&L totals would match, but `book_line` would file the purchase price under a hidden "Property" category rather than the company's own purchase-price category, and existing lines would stay on Suspense. Binding the built-in names puts both on Property.
- **A `category_id` key on a leg.** It would give one leg two ids. A leg on the category's own account says the same thing, and `posts_to` shows where it lands.
- **Refusing principal and escrow legs in favour of `attach_loan_payment`.** Mirroring into `line_splits` cannot break a loan balance, and closing and refinance lines are not loan payments. The rule is documented instead.
- **Picking one of several candidate categories by a tie-break.** A silent choice would misfile money. A refusal names the fix.

## Consequences

- An assistant can book a closing wire, a refinance deposit and a mortgage payment with `book_line`, on a synced line or as a new one. The P&L is what the equivalent split booking gives, and `get_line_legs` shows the price on Property and the loans on Loan principal.
- No P&L figure moves. The migration only re-routes kept-out legs, and its gate checks that.
- A company may gain hidden kept-out categories named like a balance-sheet account (Escrow, Security deposit held, …) the first time `book_line` needs one.
- Deferred:
  - routing a transfer kept out by `confirm_transfer_match` (an override) to Transfers in transit when its category posts elsewhere;
  - VAT-control legs;
  - an equity type for Owner capital, which stays a liability;
  - a bank account per bank;
  - the balance-sheet read.
