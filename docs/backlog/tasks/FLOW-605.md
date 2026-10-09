<a id="flow-605"></a>
# FLOW-605 · Shared-device follow-ups (#79 review)
- **Type:** BACKLOG NIT · **Status:** done (#131) · **Depends on:** —
- [x] Unsaved split drafts (the `flow-split:` sessionStorage keys) survive a sign-out in the same tab. Drop them when the user changes, with a test. (`app/src/split-drafts.ts`: the tab records the drafts' user and drops them on any other user, a reload included.)
- [x] `ToastProvider` wraps `AuthProvider`, so the last user's toast and its retry or undo action outlive a user switch. Swap the providers and add a test. (`SessionProviders`, used by the app and the stories.)
