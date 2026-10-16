<a id="flow-915"></a>
# FLOW-918 · Port the deleted SUMIT and Mercury row suites onto the connection pages
- **Type:** Test · **Status:** ready · **Depends on:** [FLOW-512](FLOW-512.md) · **Source:** Haiku review of PR #650 (round 1), finding 3: four suites were removed with the old row components and not replaced.
- **Files:** `app/src/screens/connection-page.test.tsx`, `app/src/ui/connector-row.test.tsx`, `app/src/setup/sumit-step.test.tsx` (the FLOW-505 setup cases stay here), new tests next to the connection pages.
- [ ] Port the focus cases from the old SUMIT row suite onto the connection pages: focus returns to the row after ניתוק from either sheet, a successful retry keeps focus on the row, and a retry that fails again keeps focus on ניסיון חוזר.
- [ ] Port the old SUMIT reconnect cases: the stored import date opens a reconnect, a rejected key uses the warning tone, and a refetch failure with cached data keeps the last state.
- [ ] Port the old Mercury row cases: the import date is saved from here and on reconnect, the connect sheet clears its token on close, and a failed connect says the date was not saved.
- [ ] Port the old refresh cases: a repeated tap on רענון עכשיו sends one refresh, and a server-busy refresh shows as busy after a reload.
- [ ] Port the old navigation cases: a cold deep link to ניתוק lands on that settings entry, and an off-site return keeps Home as the default.
- [ ] No ported case uses a timeout, .skip or .only. The old suites stay in git history as the reference.
