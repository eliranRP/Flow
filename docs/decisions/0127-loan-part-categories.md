# A loan names its own category for each part

**Date:** 2026-10-08
**Status:** Accepted (owner approved the FLOW-106 plan, 2026-10-08)

## Context

[0088](0088-loans.md) files a split loan payment under three fixed categories: interest in `ריבית משכנתא`, escrow in `מסים וביטוח`, principal in `תשלומי הלוואה` (matched by `categories.loan_part` since FLOW-112). That fits a mortgage. A partner loan's interest belongs in its own expense category (for example a partner-interest category), and the check refused it. FLOW-114 already noted the owner's call to relax the interest check. This is FLOW-106 part 2.

## Decision

- `loans.interest_category_id`, `escrow_category_id` and `principal_category_id` are optional. Null keeps the keyed default. Each references a category of the same company; deleting the category clears only that column.
- The rule for a part's category, everywhere (`private.loan_part_category_ok`): an expense category; interest and escrow need one counted in the P&L, principal one kept out of it; a keyed loan category (`loan_part` set) takes only its own part. This replaces 0088's fixed-category check in `loan_splits_check`, so the owner's correction of a part can also move it into another category that fits. A trigger on `loans` holds the same rule for the app's own writes (`loan_category_not_allowed`).
- A category that holds a loan part, or that a loan names, cannot flip in or out of the P&L in a way that breaks the rule (`loan category is fixed`), whether the flip comes from the app or MCP `set_category_pnl` and its undo.
- MCP `attach_loan_payment` and the app's split use the loan's category for each part, else the default. Parts already attached keep their categories when the loan's change.
- MCP `update_loan` takes the three ids (null for the default). A category of another company, or an unknown one, is `category not found`; one that breaks the rule is `category does not fit the loan part`. Undo restores them. `list_loans` returns each id and its name.
- The P&L needs nothing new: `private.pnl_lines` already counts each part under its own category ([0100](0100-loan-split-pnl.md)).

## Alternatives rejected

- Any expense category for any part: principal in a category counted in the P&L would count loan repayment as a cost.
- A per-company setting instead of per loan: a company holds mortgages and partner loans at once.
- Moving parts already attached when the loan's categories change: the same reason 0105 leaves attached lines on their project.

## Consequences

This supersedes the fixed-category paragraph of 0088 (the split rows keep their meaning). The fees part and its category come with FLOW-106 part 3. The loan sheet does not show or set these yet; that goes to the Mercury UI thread.
