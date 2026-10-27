<a id="flow-975"></a>
# FLOW-975 · Connections v2: the UX/UI rules review of Mercury, SUMIT and AI
- **Type:** UI (design approved) · **Status:** in-progress · **Depends on:** — · **Source:** a review of the connection pages (/settings/connections, Mercury, SUMIT, חיבור ל־AI) against a UX/UI rule set. The owner approved the designs on 2026-10-26; owner call the same day: disconnecting Mercury or SUMIT happens at once with a 5s ביטול, the key kept for those 5s. Design: [Design canvas](https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD), page "Ready for dev", the Connections sheets on the Settings row and their findings note "CONNECTIONS v2".
- **Files:** `app/src/screens/connection-pages.tsx`, `app/src/screens/mercury-connection-screen.tsx`, `app/src/screens/mercury-connected-view.tsx`, `app/src/screens/mercury-accounts-step.tsx`, `app/src/use-mercury-connect.ts`, `app/src/use-sumit-connect.ts`, a new `app/src/connection-toast.ts`, the connection CSS, their stories and tests, a decision record, a design log entry.

- [ ] A key the provider rejects says so under the field ("Mercury לא קיבל את המפתח…", "SUMIT לא קיבל את המפתח…") and the button reads "חיבור מחדש".
- [ ] "חיבור" is never greyed out; a tap with something missing says what is missing.
- [ ] Disconnecting Mercury or SUMIT happens at once with a 5s ביטול; the key stays on the server for those 5s.
- [ ] The key, company and date fields' edges reach 3:1.
- [ ] The "הצגה" key toggle is 44px.
- [ ] The account picker's save is never greyed out; with nothing checked it says "בחרו לפחות חשבון אחד".
- [ ] The connection pages' toasts sit under the header: ביטול 5s, a note 4s.
- **Acceptance:** stories of the rejected key and the undo; tests for the inline error, the always-enabled buttons and the deferred disconnect and its ביטול; decision record; design log entry.
