<a id="flow-508"></a>
# FLOW-508 · Settings and connect sheet follow-ups
- **Type:** BACKLOG NIT · **Status:** ready · **Depends on:** —
- [x] Token and key fields render RTL; add `dir="ltr"` (Mercury and SUMIT). (Already in both sheets.)
- [x] An empty token goes to the server and comes back as a toast; add an inline client check with a reserved message line (both connectors). ("חסר מפתח.", "חסר מספר חברה."; focus moves to the first empty field.)
- [x] The busy refresh row shows no spinner; keep the token field read-only while connect is busy. (The row already has `busy`; the key fields are read-only while connecting.)
- [x] A reloaded tab gets no message when a run fails; show the stored last error in the sheet. (Already: the status sheet shows the stored `last_error`.)
- [x] Refresh completion is announced only by the toast; add a status text update. (The sheet's "מחובר · עודכן …" line updates from `last_sync_at` after the refetch; the toast is `role="status"`.)
- [ ] Share one Settings block for Mercury and SUMIT; the Mercury status schema duplicates the DB type.
- [x] Back off status polling on error (3s doubling to a minute, `syncPollInterval`); a run releases only its own claim (mercury-sync, sumit-sync).
- [x] Consider a shorter claim expiry (15 minutes in the edge functions, `sumit_status` and `claim_connector_refreshes`). (10 minutes: an edge function stops at 400 seconds at most, so no live run outlives it. `CLAIM_MS`, the status view, `sumit_status` and both claim overloads, `20261013020100_sync_claim_window.sql`.)
- [x] Settings copy: the "עודכן" phrase should stay on one line at 320; the rate-limit copy without a retry time; the last-use date format; a dangling separator at 320. (The sync time now has its own line in the SUMIT and Mercury sheets, so no line starts with "·"; checked at 320. The retry time shows under רענון עכשיו while held; the last use and the sync time share the today / yesterday / D.M rules.)
- [x] Onboarding header back control goes to sign-in and drops `preview=1`; the onboarding round trip leaves no-op Back steps. (Back goes to `return` with preview kept, and a save replaces the entry. Also: Mercury's "פרטי העסק" link came back to the SUMIT sheet; it now returns to Mercury's.)
