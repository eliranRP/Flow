# Rare screens: help goes back where it came from; the terms and privacy draft is for the lawyer only

**Date:** 2026-10-27
**Status:** Accepted (owner, 2026-10-26, FLOW-979)

## Context

FLOW-979 reviewed the rarely used screens (help, terms, privacy, the review card's push question, the reviewer view) against the same UX/UI rule set as the other v2 screens. There were no high findings, so no v2 boards were drawn; the findings note "RARE SCREENS" on the design canvas lists them. Help's חזרה always went to sign-in, even for a signed-in owner who opened help from a failed load, and help gave only an email address. Terms and privacy were one placeholder line each, drawn in the header's subtitle style. The push question's refusal note showed at the bottom, unlike every other toast since 0212.

The owner decided two calls on 2026-10-26: terms and privacy get a draft text for the owner's lawyer (the board drew it marked "draft for legal review"; on review it stays out of the live app, point 3); and the push question stays one question naming both alerts (new transactions and the evening reminder).

## Decision

1. **Back from a page anyone can open.** Help, terms and privacy go back to where they were opened from. Opened fresh (a deep link), a signed-out visitor goes to sign-in and a signed-in owner goes Home (`usePublicBackTarget()`).
2. **Help.** Signed out, two lines above the address answer the sign-in problems people write about: the Google window closed before the end, and the wrong Google account. Signed in, help says "יש שאלה או תקלה? כותבים לנו." without them.
3. **Terms and privacy in the app.** The page's title is the page title (not the header's subtitle), and the body reads at 17px on 1.5 (`--type-reading-line`). The live pages keep the short lines they showed before this change; they never show the draft. The app is in production, and a public page with unreviewed terms and bracketed placeholders is a legal risk. The copy loads with the lazy legal screen, not with Home.
4. **The draft for the lawyer lives only in `docs/legal/`.** `terms-draft.md` and `privacy-draft.md`, marked "טיוטה לעורך דין — לא לפרסום כטקסט סופי", are written from what Flow does today: Google sign-in (name and email only), Supabase, Cloudflare, Mercury and SUMIT only with the owner's key (encrypted, deleted on disconnect), Jev when it is on, Resend for invitations, the push services, an AI assistant only with a key the owner can revoke, deletion with the company, and no sale or advertising use. Anything only the owner or the lawyer can say (the company's name and address, liability, payment, governing law, where the servers are) stays a bracketed [ ] placeholder. No story, dev route or app file holds the draft (Storybook previews are public too); a unit test fails if any file under `app/src` holds a draft line, or if the legal pages render one.
5. **The push question's notes sit under the header** (`useTopToast`, 0212 and 0222): a refused permission, a failed save and the "turned on" note.
6. **The reviewer view** already marks every screen "נתוני דוגמה · Example data" (one bar above every page); a test keeps it so.

## Alternatives rejected

- Showing the draft in the app, even marked "טיוטה לבדיקה משפטית": the owner asked for a draft for the lawyer, not published terms, and unreviewed terms on a live page are a legal risk.
- A Storybook story of the draft: Storybook previews are public links too.
- Help always sending חזרה to sign-in: a signed-in owner then lands on a page that sends them straight back in.

## Consequences

When the lawyer approves a final text, it replaces the short lines in `app/src/legal-copy.ts` (as paragraphs, in the same reading style), the drafts in `docs/legal/` are removed, and the no-draft test is changed to match.
