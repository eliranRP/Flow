<a id="flow-829"></a>
# FLOW-829 · The everyday taps take effect at once
- **Type:** SMALL CYCLE · **Status:** claimed (temporary lane, owner request, 2026-10-11, claude/compassionate-goldberg-ubfcqg) · **Depends on:** FLOW-828 · **Source:** owner, 2026-10-11 ([0180](../../decisions/0180-instant-tap-notify-on-failure.md)).
- [ ] Move the writes 0180 point 1 covers onto `optimistic`: approving a card on לאישור, a project or category pick in the change sheet (0075), marking an invoice paid, settings switches, hiding a category. Their busy spinners and disabled neighbours go. List each of the 78 writes as instant or busy (0180 point 4) in the PR.

## Classification of the `useWrite` calls (0180 points 1 and 4)

77 `useWrite` call sites in 33 files under `app/src` (non-test; `git grep -n useWrite -- app/src`, the hook's own definition and the `useWriteGate` helper excluded). **Instant** = the result is drawn from what the owner tapped (0180 point 1). **Busy** = 0180 point 4, with the reason. **Migrated** = now passes `optimistic`.

Counts: instant and migrated **11**; instant, later **11** (candidates for a next wave); busy **55**.

| File | What the write does | Instant / busy | Migrated | Reason |
| --- | --- | --- | --- | --- |
| `reviewer-preview.tsx` (change save) | Reviewer preview's own sample save, no server write | instant | no | preview only (sample data), not production; later with the reviewer |
| `screens/categories-screen.tsx` (pnl) | `set_category_excluded_from_pnl`: the category menu's "נספר ברווח" switch | instant | no | later wave: a switch whose toast already offers ביטול |
| `screens/categories-screen.tsx` (create) | `create_category` | busy | no | creates a row with a server id |
| `screens/categories-screen.tsx` (hide) | `set_category_hidden`: hide or un-hide from the confirm sheet | instant | **yes** | the row moves to or from the hidden list at once (0180 point 1) |
| `screens/categories-screen.tsx` (merge) | `merge_category` | busy | no | irreversible merge (0180 point 4) |
| `screens/category-group.tsx` (undo) | `set_category_parent` back to the previous group | instant | no | later wave: ביטול of a group move |
| `screens/category-group.tsx` (save) | `create_category` / `set_category_parent` on save | busy | no | may create a category with a server id |
| `screens/category-manage.ts` (restore) | `restore_category`: ביטול of a delete | instant | no | later wave: reverses a delete the owner just made |
| `screens/category-manage.ts` (remove) | `delete_category` | busy | no | irreversible delete; the server returns the line count shown in the toast |
| `screens/category-manage.ts` (undo move) | `undo_category_move` | busy | no | the server restores lines and returns the count for the toast |
| `screens/category-manage.ts` (move) | `move_category_lines` | busy | no | server returns `move_id` and the line count the toast and ביטול need |
| `screens/category-manage.ts` (rehab) | `set_category_rehab`: the "נספר בשיפוץ" switch | instant | no | later wave: a switch, value known to the app |
| `screens/category-manage.ts` (undo rename) | `rename_category` back to the old name | busy | no | rename sheet (0108), named busy by 0180 point 4 |
| `screens/category-manage.ts` (rename) | `rename_category` | busy | no | rename sheet (0108); the server checks the name is free |
| `screens/change-form.tsx` (save) | `resolve_review` changed: a project and category pick that closes an open review | instant | **yes** | the pick is the check; the card leaves the queue at once; rollback to the previous ids |
| `screens/change-form.tsx` (setSharedCategory) | `set_transaction_category` on a split: category tap | instant | **yes** | the server only sets the category; shares stay |
| `screens/change-form.tsx` (saveField) | `resolve_review` changed with `p_resolve: false`: a field pick from a line | instant | **yes** | the field is the tapped id; rollback to the previous ids |
| `screens/change-form.tsx` (undoShared) | `undo_reassign`: ביטול after a shared pick | instant | no | later wave: ביטול toast |
| `screens/change-form.tsx` (reassignClosed) | `reassign_transaction` on a closed review | instant | **yes** | the transaction takes the picked project and category names |
| `screens/change-form.tsx` (collapseShared) | `collapse_split`: a project tap on a split | busy | no | the server decides a shared-cost refusal and returns the undo id |
| `screens/change-form.tsx` (approveSplit) | `approve_review_item` before the split editor opens | busy | no | server refusals (stale, already closed) decide whether the editor opens |
| `screens/company-basis-sheet.tsx` (undo) | `set_cash_basis` back | busy | no | changes every figure; the server's figures show next |
| `screens/company-basis-sheet.tsx` (save) | `set_cash_basis` | busy | no | server figures across Home and the reports |
| `screens/company-currency-sheet.tsx` (undo) | `set_company_currency` back | busy | no | server figures in every currency total |
| `screens/company-currency-sheet.tsx` (save) | `set_company_currency` | busy | no | server figures in every currency total |
| `screens/company-form.tsx` | `create_company` | busy | no | creates a company with a server id |
| `screens/company-switcher.tsx` | `switch_company` | busy | no | changes the company the whole app reads |
| `screens/connections-screen.tsx` (SUMIT disconnect) | `disconnect_sumit` | busy | no | external service |
| `screens/connections-screen.tsx` (Mercury refresh) | Mercury refresh call | busy | no | external service |
| `screens/connections-screen.tsx` (Mercury disconnect) | `disconnect_connector` | busy | no | external service |
| `screens/invite-actions.ts` (join) | `accept_invite` | busy | no | server grants company access |
| `screens/invite-actions.ts` (reopen) | `reopen_invite` | busy | no | server decides the invite's state |
| `screens/invite-actions.ts` (decline) | `decline_invite` | busy | no | server decides the invite's state |
| `screens/jev-settings.tsx` | `set_company_integration` (Jev connector on or off) | busy | no | external service |
| `screens/jev-undo.ts` | `undo_jev_prefill`: ביטול of Jev's fill on a card | instant | no | later wave: ביטול on a card |
| `screens/loan-match-row.tsx` (save) | `save_loan_split` | busy | no | server computes the loan split figures |
| `screens/loan-match-row.tsx` (rematch) | loan split write that puts the match back | busy | no | server computes the split figures |
| `screens/loan-match-row.tsx` (unmatch) | `clear_loan_split` | busy | no | server figures on the loan |
| `screens/loan-match.tsx` (other) | `save_loan_split` for another payment | busy | no | server computes the split figures |
| `screens/loan-match.tsx` (match) | `save_loan_split` | busy | no | server computes the split figures; focus returns to the loan on failure |
| `screens/loan-setup.tsx` | create a loan | busy | no | creates a row with a server id |
| `screens/loan-split-edit.tsx` | `save_loan_split` | busy | no | server figures |
| `screens/missing-bills-screen.tsx` (dismiss) | `dismiss_recurring_alert` / `undismiss_recurring_alert` | instant | no | later wave: a dismiss the owner can undo |
| `screens/missing-bills-screen.tsx` (answer) | `answer_recurring_match` | busy | no | server writes the match and changes the expected months |
| `screens/project-detail-screen.tsx` (overhead) | `set_after_overhead`: the project's view | busy | no | server figures on the project |
| `screens/project-detail-screen.tsx` (save) | `upsert_project` | busy | no | server id on create; server figures |
| `screens/project-group-sheets.tsx` | `set_project_group` / `upsert_project_group` | busy | no | may create a group with a server id |
| `screens/project-investment.tsx` | `set_project_investment` | busy | no | server figures (investment and return) |
| `screens/projects-screen.tsx` | `upsert_project` | busy | no | creates a project with a server id |
| `screens/rename-company.tsx` (undo) | `rename_company` back | busy | no | rename (0108) |
| `screens/rename-company.tsx` (save) | `rename_company` | busy | no | rename (0108) |
| `screens/review-queue.tsx` (approve) | `approve_review_item` / `approve_split_review`: אישור | instant | **yes** | the card leaves the queue at once; rollback restores it; a stale or already-closed refusal shows its toast |
| `screens/review-queue.tsx` (skip) | `resolve_review` skipped: דלג | instant | no | later wave: the same card leave as אישור |
| `screens/settings-screen.tsx` (overhead) | `set_after_overhead` | busy | no | server figures |
| `screens/settings-screen.tsx` (sign out) | sign out | busy | no | ends the session |
| `screens/team-sheets.tsx` (cancel, sheet) | `cancel_invite` | busy | no | server state of the invite |
| `screens/team-sheets.tsx` (restore) | `invite_member` again | busy | no | server id and sends the invite |
| `screens/team-sheets.tsx` (send) | `invite_member` | busy | no | server id and sends an email |
| `screens/team-sheets.tsx` (undo role) | `set_member_role` back | busy | no | server refuses the last owner's change |
| `screens/team-sheets.tsx` (set role) | `set_member_role` | busy | no | server refuses the last owner's change |
| `screens/team-sheets.tsx` (remove) | `remove_member` | busy | no | removes access |
| `screens/team-sheets.tsx` (change) | `set_member_role` | busy | no | server refuses the last owner's change |
| `screens/team-sheets.tsx` (cancel, row) | `cancel_invite` | busy | no | server state of the invite |
| `screens/transaction-charge-switches.tsx` (cash) | `set_transaction_cash`: נספר בתזרים | instant | **yes** | the switch flips at once; rollback to the previous override |
| `screens/transaction-charge-switches.tsx` (recurring) | `set_payment_recurring`: חיוב קבוע | instant | **yes** | the switch flips at once; rollback to the previous override |
| `screens/transaction-charge-switches.tsx` (pace) | `set_payment_pace` | busy | no | returns the prior and shown pace the sheet displays next |
| `screens/transaction-screen.tsx` (remove) | `delete_transaction` | busy | no | irreversible delete |
| `screens/transaction-screen.tsx` (pnl) | `set_transaction_pnl`: a line's P&L switch | instant | no | later wave: a switch |
| `screens/transaction-screen.tsx` (undo) | `undo_reassign`: ביטול of an assignment | instant | no | later wave: ביטול toast |
| `screens/transaction-screen.tsx` (reassign) | `reassign_transaction`: project and category pick | instant | **yes** | the check, the summary and the row take the pick at once; rollback to the previous pick |
| `screens/transaction-screen.tsx` (setCategory) | `set_transaction_category`: category pick | instant | **yes** | the check, the summary and the row take the pick at once; rollback to the previous pick |
| `screens/unpaid-screen.tsx` | `set_invoice_paid`: סימון כשולם | instant | **yes** | the row takes its mark at once and the sheet closes; rollback restores the row |
| `setup/steps.tsx` (apply) | `apply_starter_categories` | busy | no | creates categories with server ids |
| `setup/steps.tsx` (Jev save) | Jev integration save | busy | no | external service |
| `use-mercury-connect.ts` | connect Mercury | busy | no | external service |
| `use-sumit-connect.ts` | connect SUMIT | busy | no | external service |
| `use-sumit-refresh.ts` | SUMIT refresh | busy | no | external service |
