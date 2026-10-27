# Rare screens: help goes back where it came from, terms and privacy are a draft for the lawyer

**Date:** 2026-10-27
**Status:** Accepted (owner, 2026-10-26, FLOW-977)

## Context

FLOW-977 reviewed the rarely used screens (help, terms, privacy, the review card's push question, the reviewer view) against the same UX/UI rule set as the other v2 screens. There were no high findings, so no v2 boards were drawn; the findings note "RARE SCREENS" on the design canvas lists them. Help's חזרה always went to sign-in, even for a signed-in owner who opened help from a failed load, and help gave only an email address. Terms and privacy were one placeholder line each, drawn in the header's subtitle style. The push question's refusal note showed at the bottom, unlike every other toast since 0212.

The owner decided two calls on 2026-10-26: terms and privacy get a draft text for the owner's lawyer, shown as a draft for legal review until the lawyer signs off; and the push question stays one question naming both alerts (new transactions and the evening reminder).

## Decision

1. **Back from a page anyone can open.** Help, terms and privacy go back to where they were opened from. Opened fresh (a deep link), a signed-out visitor goes to sign-in and a signed-in owner goes Home (`usePublicBackTarget()`).
2. **Help.** Signed out, two lines above the address answer the sign-in problems people write about: the Google window closed before the end, and the wrong Google account. Signed in, help says "יש שאלה או תקלה? כותבים לנו." without them.
3. **Terms and privacy.** The page's title is the page title (not the header's subtitle), and the body reads at 17px on 1.5 under 20px section heads. The text is a draft written from what Flow does today: Google sign-in (name and email only), Supabase, Cloudflare, Mercury and SUMIT only with the owner's key (encrypted, deleted on disconnect), Jev when it is on, Resend for invitations, the push services, an AI assistant only with a key the owner can revoke, deletion with the company, and no sale or advertising use. Anything only the owner or the lawyer can say (the company's name and address, liability, payment, governing law, where the servers are) stays a bracketed [ ] placeholder. A "טיוטה לבדיקה משפטית" line opens the page while `draft` is true.
4. **The lawyer's copy.** `docs/legal/terms-draft.md` and `privacy-draft.md` hold the same text, marked "טיוטה לעורך דין — לא לפרסום כטקסט סופי". `scripts/legal-docs.mjs` writes them from `app/src/legal-copy.ts`, and a unit test fails when the two differ. The copy loads with the lazy legal screen, not with Home.
5. **The push question's notes sit under the header** (`useTopToast`, 0212 and 0222): a refused permission, a failed save and the "turned on" note.
6. **The reviewer view** already marks every screen "נתוני דוגמה · Example data" (one bar above every page); a test keeps it so.

## Alternatives rejected

- Publishing the draft as the final text: it is a lawyer's call, and some sections are only placeholders.
- Keeping one placeholder line until the lawyer's text arrives: the owner asked for a draft the lawyer can work from.
- Help always sending חזרה to sign-in: a signed-in owner then lands on a page that sends them straight back in.

## Consequences

When the lawyer returns the text, it replaces `TERMS` and `PRIVACY` in `legal-copy.ts`, `draft` goes false (the draft line goes away), and `scripts/legal-docs.mjs` rewrites the docs.
