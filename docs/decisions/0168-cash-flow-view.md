# The monthly cash view counts money moved, with its own switches

**Date:** 2026-10-09
**Status:** Accepted (owner picked "Cash first" for FLOW-413, and "the user picks the basis" for FLOW-103; server PR 1 of the data plan)

## Context

The owner asked for a monthly view of all money in and out (FLOW-413), and made it the main monthly figure on Home. The P&L cannot serve it: it leaves out loan principal and transfers (`excluded_from_pnl`), counts amounts net of VAT, and dates expenses by document date. Rent alone looks positive there while the month's loan payment is mostly principal. FLOW-103 asked that the user pick whether the view counts by payment date or invoice date.

## Decision

1. **Which lines.** Every posted line that is not removed or void, by the same parts as `private.pnl_lines`: a complete loan split's parts, a complete line split's parts, else the whole line. Each part counts once.
2. **Gross.** The cash view counts `amount_gross`, what moved in the bank. A line split's parts share the VAT in proportion, rounded on running totals so the parts add up to the line's gross. A VAT-only document (net 0) counts its VAT. The P&L stays net.
3. **The month.** `companies.cash_basis`:
   - `paid` (the default): the payment date (`cash_date`). An open invoice or credit note with no payment date is not cash yet; any other line with no payment date counts on its document date.
   - `invoice`: the document date, open invoices included.
   - Income lines follow the P&L's document rule on each basis (receipts on `paid`, invoices and credit notes on `invoice`, invoice-receipts on both), so an invoice and its receipt never both count.
4. **In or out of the view.** Separate from the P&L flags:
   - `transactions.in_cash_override`: null follows the category, false takes the whole line out, true keeps it in. It works on loan payments too; the P&L's loan lock is not the cash flag's.
   - `categories.in_cash`, default true. A guessed category does not take a whole line out, as in the P&L: a bank transfer still guessed as העברות counts until the owner confirms it. Its two sides move נכנס and יצא alike, so the month's net holds, while a wrong guess never hides a real expense.
   - Out by default, by name (`private.non_cash_category`, applied when a category is created; a rename keeps the flag, as every rename path keeps the P&L flag, and undo of a delete puts back the owner's setting): both העברות categories, internal transfers in and out, credit card bill payments (the card's charges are already lines), and money received from a loan.
   - Every company gets an income category, כסף שהתקבל מהלוואות, out of the P&L and out of cash. Existing companies get it unless they already have one by that name or "loan proceeds".
   - A loan payment's principal, interest and escrow are all money out: their categories stay in cash.
5. **Reads.**
   - `cash_months(p_months 1-24, p_today)`: the company's basis and base currency, and the months newest first, the current month included. Each month has one row per currency, the base currency first and always present: `in_minor` (נכנס), `out_minor` (יצא), `net_minor`, `profit_minor` (company_pnl's invoiced net profit for the month, for the "רווח החודש" row), and `excluded_count`, `excluded_in_minor`, `excluded_out_minor` for what the view leaves out.
   - `cash_month_lines(p_month, p_side 'in'|'out'|'excluded', p_currency, p_limit, p_offset)`: the lines behind a figure, newest first, in `get_breakdown_lines`' row shape plus `side` and `cash_month_date`. A line split's parts on one side are one row; a loan payment has a row per part.
   - `list_categories` returns `in_cash`; `get_transaction` returns `in_cash_override` and `cash_state` (in, out, or mixed for a line split across categories in and out). `cash_state` describes the line's switch; it does not say the line shows in a given month (an income invoice is never cash on the paid basis).
   - Both reads take the signed-in company (owner, or a viewer of a demo company), like `get_breakdown`.
6. **Writes**, owner only, each returning the prior value for ביטול: `set_category_cash(p_category_id, p_in_cash)`, `set_transaction_cash(p_id, p_in_cash | null)`, `set_cash_basis(p_basis)`.
7. **Nothing is converted.** Each currency is its own row, as in the P&L (0146).

## Alternatives rejected

- **One flag for both views.** Loan principal is out of profit and in cash, and an owner's transfer is in neither, so one flag cannot serve both.
- **Reusing `company_pnl` per month.** It is net of VAT and drops kept-out categories. The profit row is computed from the same lines with the P&L's own filters, and a test holds it equal to `company_pnl`.
- **Net amounts.** The owner compares the view with the bank, which moves gross amounts.

## Consequences

- MCP tools for the view, and the FLOW-103 default switch for the P&L tools, come in server PR 2.
- The app (Home frame b, the drill-ins, the "מה בתזרים" sheet and the "בתזרים" switch) comes from a UI lane; the owner sees real-app shots before it merges.
- A SUMIT receipt and the bank deposit for the same payment are both cash on the `paid` basis, as they are both income on the P&L's cash basis today. The optional "יתכן כפל" hint from the plan is not built.
- Tests counting a new company's default categories count one more.
