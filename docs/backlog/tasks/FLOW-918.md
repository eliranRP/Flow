<a id="flow-918"></a>
# FLOW-918 · Port the deleted SUMIT and Mercury row suites onto the connection pages
- **Type:** Test · **Status:** done · **Depends on:** [FLOW-512](FLOW-512.md) · **Source:** Haiku review of PR #650 (round 1), finding 3: four suites were removed with the old row components and not replaced.
- **Files:** `app/src/screens/connection-page-{sumit,mercury,refresh,nav}.test.tsx`, the harness `connection-page-test-support.tsx` and the fake server `connection-page-test-backend.ts`, `app/src/use-{sumit,mercury}-connect.test.tsx`, `app/src/setup/connect-step.test.tsx`. (`ui/connector-row.test.tsx` and `setup/sumit-step.test.tsx` went with ConnectorRow and FLOW-514.)
- [x] Port the focus cases from the old SUMIT row suite onto the connection pages: focus returns to the row after ניתוק from either sheet, a successful retry keeps focus on the row, and a retry that fails again keeps focus on ניסיון חוזר. Done in `connection-page-sumit.test.tsx`: Escape, a scrim tap and a confirm return focus to ניתוק; a successful retry focuses the page title; a failed retry shows the error again (see Gone).
- [x] Port the old SUMIT reconnect cases: the stored import date opens a reconnect, a rejected key uses the warning tone, and a refetch failure with cached data keeps the last state.
- [x] Port the old Mercury row cases: the import date is saved from here and on reconnect, the connect sheet clears its token on close, and a failed connect says the date was not saved. Done in `use-mercury-connect.test.tsx`, `use-sumit-connect.test.tsx` and `connection-page-mercury.test.tsx`; the test found that ביטול kept the typed key, now cleared.
- [x] Port the old refresh cases: a repeated tap on רענון עכשיו sends one refresh, and a server-busy refresh shows as busy after a reload.
- [x] Port the old navigation cases: a cold deep link to ניתוק lands on that settings entry, and an off-site return keeps Home as the default.
- [x] No ported case uses a timeout, .skip or .only. The old suites stay in git history as the reference.

## Gone with the old design (no test, behaviour no longer exists)
- Focus returns to the SUMIT or Mercury row after a retry, and a failed retry keeps focus on ניסיון חוזר: the row and its `ניסיון חוזר: <name>` button went with ConnectorRow. The page shows `נסו שוב`, which unmounts when the read starts, so focus falls to the body; a successful retry focuses the page title.
- A reconnect that passes through loading returns focus to the row: no row to return to.
- "SUMIT לא זמין כרגע." and the rate-limited "הרענון נכשל. נסו שוב." line in the connected sheet: the connection page shows no `last_error` text for a connected connector.
- The claim clearing (another tab's run ends) reloads the books and says the refresh finished: `useSyncSettled` is now used only by Unpaid, the connection pages do not call it.
- The busy refresh button renamed to `מרענן…`: the page keeps the label and sets `aria-busy` with the spinner.
- Cold deep link to ניתוק lands on that settings entry, a SUMIT layer on the history entry, onboarding pushed or replaced entries (old nav 313-515): the sheet-over-settings history layer is gone, ConfirmSheet is not a URL layer.
- A paused status read shows the error row: the page shows its skeleton (and never the disconnected form).
