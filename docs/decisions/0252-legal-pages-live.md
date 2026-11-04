# The legal pages go live: terms, privacy, cookies and storage, accessibility

**Date:** 2026-11-04
**Status:** Accepted (owner, 2026-11-04, FLOW-1028: "No need lawyer, fill all gaps and make sure it is ready to go live")
**Supersedes:** points 3 and 4 of [0225](0225-rare-screens-v2.md)

## Context

Under 0225 the live `/terms` and `/privacy` pages showed one line each, and the full texts were drafts for a lawyer in `docs/legal/`, with [ ] placeholders. Flow had no cookies policy and no accessibility statement. Settings had no link to any legal page. Sign-in linked terms and privacy without saying that signing in accepts them.

The owner asked for every legal text an Israeli app needs, complete and live, without a lawyer's review. The review of the law and of similar Israeli services (Morning/Green Invoice, SUMIT, iCount, Riseup) is in [docs/legal/compliance.md](../legal/compliance.md).

## Decision

1. **Four live pages, full text, no placeholders.** `/terms`, `/privacy`, `/cookies` (new) and `/accessibility` (new) render the texts in `app/src/legal-copy.ts`: a title, "עודכן לאחרונה" with `LEGAL_UPDATED`, an introduction, then sections with level-2 headings, in the 17px reading style.
2. **What they say.** They follow what the code does, checked on 2026-11-04. The privacy policy covers each item of section 11 of the Privacy Protection Law as amended by Amendment 13: the controller and how to reach them, that giving data is voluntary and what happens without it, the purposes, every recipient and why, transfers abroad, retention, security, the rights to review and correct (sections 13 and 14), and a complaint to the Privacy Protection Authority. The cookies page says Flow sets no cookies and lists what it keeps in browser storage. The accessibility statement follows regulation 35 of the 2013 service accessibility regulations: the standard (IS 5568, WCAG AA), what was done, the known gaps, and a contact with a 14-day answer.
3. **Who runs Flow.** `OPERATOR_NAME` in `app/src/config.ts` is the name the pages give: Idan Hazan, a private person (owner, 2026-11-04; no company and no business number). The contact for help, privacy, deletion and accessibility is `HELP_EMAIL`, now flowsupport@gmail.com (was ops@nromomentum.com), with no phone or postal address. Empty, the name falls back to "מפעיל Flow".
4. **Acceptance at sign-in.** Under the Google button: "בכניסה אתם מסכימים לתנאי השימוש ולמדיניות הפרטיות.", then the four links.
5. **Settings links.** Under התנתקות, a `מידע משפטי` navigation with the four links, each a 44px target. `LegalLinks` (`app/src/screens/legal-links.tsx`) is shared by sign-in and Settings.
6. **The drafts are gone.** `docs/legal/terms-draft.md` and `privacy-draft.md` are deleted. The no-draft test is replaced by tests that every page renders every section, has no placeholder or draft mark, gives the contact address, and that the privacy policy names every service the server sends data to.
7. **Keeping them true.** A PR that changes what Flow collects, stores on the device, or sends to a service changes these texts in the same PR and moves `LEGAL_UPDATED`. The operational duties that are not pages (security procedures, the processor register, incident reporting) are tracked in `docs/legal/compliance.md`.

## Alternatives rejected

- Waiting for a lawyer (0225): the owner decided the texts go live now.
- A cookie consent banner: Flow sets no cookies and keeps only what it needs to work in browser storage. Israeli law and the Privacy Protection Authority's guidance ask for consent to tracking and third-party cookies, which Flow does not use. The cookies page promises consent before any such tool is added.
- Recording each user's acceptance (version and time) in the database: a migration for a pilot with one owner. Acceptance is the sign-in line. A follow-up can store it if Flow opens to more businesses.

## Consequences

The pages are live with the next deploy. A new service, cookie or stored item updates the texts.
