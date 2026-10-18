<a id="flow-925"></a>
# FLOW-925 · First-sync progress page after connecting the bank (board StatesFirstSync)
- **Type:** Feature · **Status:** ready · **Depends on:** — · **Source:** PR #703 board coverage: no screen draws this frame. Owner decision 2026-10-18: a follow-up, not part of #703.
- **Files:** `app/src/setup/`, the sync job's status read, `app/src/ui/progress-bar.tsx` (`variant="job"`), `design/proof/states-map.json`.
- [ ] A full-screen page after the connect step, "מביאים את התנועות": the count bar, the accounts, transactions and projects steps fed by the sync job's counts, and "המשך לבית בינתיים", which leaves for Home while the job goes on.
- [ ] Map StatesFirstSync and prove it under 3% in both themes.
