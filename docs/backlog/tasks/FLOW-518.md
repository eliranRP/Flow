<a id="flow-518"></a>
# FLOW-518 · Mercury: a new account was found, ask on Home, at the transfer and in Settings
- **Type:** UI (design approved) · **Status:** on-hold (the owner's approval of the checkbox change of 2026-10-29) · **Depends on:** [FLOW-938](FLOW-938.md) (done: the new-account state, `answer_bank_account`) · **Source:** the owner on 2026-10-29: three concepts were drawn, then approved together and reworked against the UX review rules. Board: the "Mercury · a new account was found · for approval" row on the "In design · for approval" page, dark with the light twins under it (prototype `MercuryNewAcct`, presets `home`, `sheet`, `added`, `failed`, `review`, `reviewdone`, `settings`, `accounts`), with the purple spec note and the blue MOTION note beside it. It replaces FLOW-938's tinted card on the connected page ("ב־Mercury נפתח חשבון חדש … כן, לסנכרן / לא"), which the board no longer has.
- **Files:** `app/src/screens/HomeScreen.tsx` and `home-parts.tsx` (the row under דורש טיפול, the avatar dot), a new new-account sheet in `app/src/ui/`, the Review card for a transfer to an unsynced account, `app/src/screens/mercury-connected-view.tsx` (the card goes; "1 חדש" on the Settings row; the new account on top of the accounts list, off; the auto-add checkbox), `app/src/mercury-connections.ts`, `app/src/use-mercury-accounts.ts`, a migration for the snooze date and the auto-add flag, `supabase/functions/mercury-sync` (auto-add), `supabase/functions/flow-mcp/tools_bank.ts`, the stories and tests, `docs/mcp/TOOLS.md`.

A transfer to an account Flow doesn't sync counts as money out, so the ask leads with that money.

**Where it shows** (one state; acting in one place clears the others)
- [ ] Home › דורש טיפול: a row under the לאישור button, "חשבון חדש ב־Mercury" with "Savings ••4421 · העברה של $X נספרת כ״יצא״"; the avatar gets a dot and its label says why. Tapping opens the sheet.
- [ ] The sheet: the account card (name, type, opened date, balance), one line on why, "לייבא תנועות" מהפתיחה · N תנועות / מהיום והלאה, primary "להוסיף ל־Flow", text buttons "אחר כך" (asks again in 7 days) and "לא לסנכרן אותו".
- [ ] לאישור: only when a queue item is a transfer to an unsynced Mercury account. The card explains it; primary "לסנכרן את החשבון", text button "זו באמת הוצאה". After syncing, the line reads "העברה בין החשבונות שלך", the amount is grey and struck through, and it is not counted.
- [ ] Settings: the Mercury row shows "1 חדש"; the accounts page is a list of 24 px checkbox rows (as when connecting), with the new account on top in its own group, unchecked and its balance grey; checking it adds it. A checkbox row "חשבון חדש נכנס לבד" adds future accounts from the opening date, with a notification and undo.
- [ ] A new Treasury account is suggested as "לא לסנכרן אותו" (same rule as connecting).

**Behaviour**
- [ ] Adding is optimistic: the sheet closes, the row collapses, Home's numbers update at once; a spinner shows in the button only after 300 ms. Success toast at the top, 4 s, with ביטול. Failure rolls everything back, and an error toast stays until it is closed, with לנסות שוב.
- [ ] "לא לסנכרן אותו" and "זו באמת הוצאה" are undoable from the toast; "never" can be undone in Settings › Mercury. No confirm dialogs.
- [ ] Offline: the row stays; the add button is off and the grey line says why.
- [ ] Motion as in the board's MOTION note (250 ms in, 150 ms out, the sheet's flick and 80 px close, reduced motion = 150 ms fades).

**MCP (0095)**
- [ ] `list_bank_connections` also returns each new account's snooze date and the auto-add flag; `answer_bank_account` takes `later` (snooze 7 days) besides yes and no; a new `set_bank_auto_add` (on or off). Owner only, idempotency key, the write rate limit, undo.

**Acceptance:** screen tests and stories for the eight presets, dark and light; a unit test that acting in one place clears the other two; pgTAP for the snooze and the auto-add flag; a connector test that auto-add imports a new account from its opening date; Deno tests for the tool changes; an e2e for add, undo and the failure rollback.
