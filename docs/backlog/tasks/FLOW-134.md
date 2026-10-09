<a id="flow-134"></a>
# FLOW-134 · Loan part categories follow-ups (FLOW-106 part 2 review)
- **Type:** BACKLOG NIT · **Status:** done (#242) · **Depends on:** FLOW-106 part 2
- [x] `merge_category` does not move `loans.*_category_id`, so a loan keeps filing new parts under the hidden source category. Move them in the merge (the target must fit the part) or refuse the merge. (Moved when the target fits, else the merge is refused: migration `20261010090000`, decision 0132.)
- [x] The categories screen shows a generic error when a flip is refused with `loan category is fixed` for a category a loan uses; give it copy (Mercury UI thread). (`pnlFailureText` in `category-copy.ts`.)
- [x] The match sheet offers a loan only for lines on the keyed principal category (`offerMatch` in `loan-match.tsx`); also offer it on a loan's own principal category (Mercury UI thread). (`LoanTransactionSplit` takes the line's `categoryId` and offers שיוך when a loan's principal category is that category.)
- [x] `mcp_update_loan` repeats the fit check for each part; one loop over the three keys would do. The loans trigger also runs on every `update_loan` and `loan_update` undo, since they always set the three columns. (One loop over the four keys; the update trigger runs only when a part category changes: migration `20261010090000`, decision 0132.)
- [x] (from #248 review, not a bug) `get_transaction`'s `pnl_fixed` is already `loan_part is not null or exists (loan_splits)` (since `20261007210000`); pgTAP `line_state_in_lists` covers a loan payment on a plain category.
