<a id="flow-979"></a>
# FLOW-979 · Rare screens v2: help, terms and privacy, the push question, the reviewer view
- **Type:** UI (design approved) · **Status:** in-progress (#840) · **Depends on:** — · **Source:** a light UX/UI rules review of the rare screens (help, terms, privacy, the review card's push question, the reviewer view). The owner approved it on 2026-10-26, with two owner calls: terms and privacy get a draft text for the owner's lawyer (kept out of the live app; decision 0225); the push question is one question naming both alerts. No v2 boards: the findings are in the note "RARE SCREENS" on the [Design canvas](https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD), page "Ready for dev".
- **Files:** `app/src/screens/HelpScreen.tsx`, `app/src/screens/PlaceholderScreen.tsx` (the legal screen), `app/src/legal-copy.ts` (new: the live lines), `app/src/App.tsx` (the two legal routes), `app/src/ui/layout.tsx` (the help parts), `app/src/screens/review-push-prompt.tsx`, a legal CSS file, `docs/legal/terms-draft.md` and `docs/legal/privacy-draft.md` (new), their stories and tests, a decision record, a design log entry.

- [x] Help: חזרה goes back to where it was opened; deep linked, a signed-out visitor goes to sign-in and a signed-in owner to Home.
- [x] Help: two lines on the common sign-in problems above the address (the Google window closed, the wrong account).
- [x] Terms and privacy: the title is the page's title, the body 17px at 1.5; the live lines stay as they were.
- [x] The draft for the lawyer is in `docs/legal/` only, marked "טיוטה לעורך דין — לא לפרסום כטקסט סופי"; a test fails if the app's sources or the legal pages hold any of it.
- [x] The push question's refusal and failure toasts sit under the header (decision 0212).
- [x] The reviewer view's sample mark is on every screen (already so); a test keeps it.
- **Acceptance:** stories of help (signed out and signed in) and both legal pages; unit tests for the back target, the draft staying out of the app and the toast place; decision record; design log entry.
