# Loan split breakdown on the transaction

**Date:** 2026-10-07
**Status:** Accepted (owner chose option A of the FLOW-107 mockups, 2026-10-07)

## Context

Since [0100](0100-loan-split-pnl.md) a split loan payment counts by its parts: interest and escrow in the P&L, principal kept out. The transaction screen already listed the three parts, but with no sign, no icons, no total, and nothing saying the principal is out of the profit. Transaction lists showed nothing, and MCP `get_expense` did not return the parts.

## Decision

- One read, `public.get_loan_split(p_transaction_id)` (security invoker, the viewer's company), returns the split and what each part does in the P&L, taken from `private.pnl_lines`, so the screen and MCP never disagree with the totals. It is null when the line has no split or is removed. `by_parts` is true only when the P&L counts the line by its parts; then each part's `in_pnl` is the part category's flag. Otherwise `in_pnl` is null and the whole line counts.
- Transaction detail, "חלוקת התשלום": each part is a static row with a 24px text-secondary icon (percent for ריבית, house for מסים וביטוח, bank for קרן) and its amount with a U+2212 minus in the text colour. A last row "סה״כ" shows the line amount, so the parts visibly add up. When `by_parts`, one hint line under the heading says "נספר ברווח <amount>", and a kept-out part gets the hint "מחוץ לרווח" with an eye-off icon. The hero stays unsigned.
- When the whole line counts (a part waits for review, the line has VAT, or the parts no longer add up), there is no counted line and no "מחוץ לרווח". The waiting hint, "עדכון החלוקה", the currency-mismatch hint, and the viewer rules are unchanged.
- Transaction rows in the project's recent list, the category drill-down, and "שויכו היום" put "3 חלקים" before their hint when the line has a split. A split with a part waiting for review shows "ממתין לבדיקה" with the warning tone and the alert icon instead. The marks come from one read of `loan_splits` for the listed ids, at most 100 ids a request. Review lists are unchanged.
- MCP `get_expense` adds `loan_split` from the same function. Income skips the read and returns null.

## Alternatives rejected

- A two-part bar (counted, kept out) above the parts: option B. The owner chose the plain list.
- A three-colour bar with tinted tiles and the counted amount on every list row: dropped at design review (a gradient, non-token colours below 3:1, detail on the list).
- Adding the split to `get_transaction`: a separate function keeps that large function untouched while other work changes it.

## Consequences

The wording follows the app's own words for the P&L ("רווח"), not "רווח והפסד". A list row with a split makes one extra small read per list.
