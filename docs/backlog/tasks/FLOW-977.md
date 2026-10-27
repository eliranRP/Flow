<a id="flow-977"></a>
# FLOW-977 · Rare screens v2: help, terms and privacy, the push question, the reviewer view
- **Type:** UI (design approved) · **Status:** in-progress · **Depends on:** — · **Source:** a light UX/UI rules review of the rare screens (help, terms, privacy, the review card's push question, the reviewer view). The owner approved it on 2026-10-26, with two owner calls: terms and privacy get a draft text for the owner's lawyer, shown as a draft for legal review until the lawyer signs off; the push question is one question naming both alerts. No v2 boards: the findings are in the note "RARE SCREENS" on the [Design canvas](https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD), page "Ready for dev".
- **Files:** `app/src/screens/HelpScreen.tsx`, `app/src/screens/PlaceholderScreen.tsx` (the legal screen), `app/src/legal-copy.ts` (new), `app/src/App.tsx` (the two legal routes), `app/src/ui/layout.tsx` (the help parts), `app/src/screens/review-push-prompt.tsx`, a legal CSS file, `docs/legal/terms-draft.md` and `docs/legal/privacy-draft.md` (new), their stories and tests, a decision record, a design log entry.

- [ ] Help: חזרה goes back to where it was opened; deep linked, a signed-out visitor goes to sign-in and a signed-in owner to Home.
- [ ] Help: two lines on the common sign-in problems above the address (the Google window closed, the wrong account).
- [ ] Terms and privacy: the draft text for the lawyer, with a "טיוטה לבדיקה משפטית" line at the top; the title is the page's title, the body 17px at 1.5.
- [ ] The draft text is also in `docs/legal/`, marked "טיוטה לעורך דין — לא לפרסום כטקסט סופי", and a test keeps the app's headings and the docs' headings the same.
- [ ] The push question's refusal and failure toasts sit under the header (decision 0212).
- [ ] The reviewer view's sample mark is on every screen (already so); a test keeps it.
- **Acceptance:** stories of help (signed out and signed in) and both legal pages; unit tests for the back target, the draft line, the docs' sync and the toast place; decision record; design log entry.
