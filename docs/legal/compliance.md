# Legal compliance: what Flow needs as an Israeli app

Decision [0252](../decisions/0252-legal-pages-live.md). Reviewed 2026-11-04 against what Flow does in code. This file is the internal register; the public texts are in `app/src/legal-copy.ts` and live at `/terms`, `/privacy`, `/cookies` and `/accessibility`. Not legal advice: it was written without a lawyer, at the owner's request.

## What similar services publish

Israeli business-finance services publish the same set. Morning (Green Invoice) has terms of use, a privacy policy, a data processing annex (DPA) for business customers, and an accessibility statement with a contact. Its privacy contact is a named privacy officer. SUMIT, iCount and Riseup publish terms, privacy and an accessibility statement. Flow now has terms, privacy, an accessibility statement, and a cookies and storage page. A DPA is item 6 below.

## The laws and what each asks of Flow

| Law | What it asks | Where Flow covers it |
| --- | --- | --- |
| Privacy Protection Law 1981, section 11, as amended by Amendment 13 (in force 14 Aug 2025) | When collecting data: who the controller is and how to reach them, the purposes, who receives it and why, whether giving it is a legal duty, and what happens without it | `/privacy`: "מי אחראי למידע", "האם חובה למסור מידע", "למה", "עם מי המידע משותף" |
| Same law, sections 13 and 14 | The right to review data, and to ask to correct or delete it | `/privacy`: "הזכויות שלכם", an answer within 30 days, and a complaint to the Privacy Protection Authority |
| Amendment 13: data of special sensitivity | Financial data is sensitive; it needs a matching security level | `/privacy` says so; security below |
| Amendment 13: database registration and a privacy officer (DPO) | Registration only for data brokers and public bodies; a DPO only for public bodies, data brokers, and large-scale monitoring or sensitive data as a core activity | Not required for Flow today. Check again as Flow grows, and if processing other businesses' financial data at scale becomes its core activity |
| Privacy Protection (Data Security) Regulations 2017 | A database definition document, a security procedure, access control, access logs, outsourcing terms with processors (regulation 15), reporting a severe incident to the Authority | Checklist below |
| Transfer of Data Abroad Regulations 2001 | Abroad only to a country with equal protection (the EU), or with the recipient's commitment, or with consent | `/privacy`: "העברת מידע אל מחוץ לישראל". Supabase is in Frankfurt (EU). Resend, Mercury and TypeSafe may process in the US |
| Communications Law, section 30A (anti-spam) | Advertising by email, SMS or push needs prior opt-in consent | Flow sends no advertising. Invitations and alerts are service messages. Marketing would need an opt-in first |
| Equal Rights for Persons with Disabilities, Service Accessibility Regulations 2013, regulation 35 | Websites and apps that serve the public meet IS 5568 (WCAG AA) and publish an accessibility statement with a contact. Exemptions by turnover exist, and an exempt business still publishes the statement | `/accessibility` |
| Standard Contracts Law 1982 | A one-sided term in standard terms (a total exclusion of liability, unlimited one-sided changes, a far-away court) can be voided | `/terms` caps liability without excluding intent or gross negligence, gives 14 days' notice of changes, Israeli law and a Tel Aviv court |
| Consumer Protection Law 1981 (distance selling, cancelling a subscription) | Applies when a consumer pays | Flow is free and for businesses. Before charging: price, cancellation terms, and a way to cancel in the app |
| Cookies | No Israeli cookie statute. The Authority recommends consent for tracking and third-party cookies | `/cookies`: Flow sets no cookies; browser storage is essential only |

## Open duties that are not pages

1. **Database definition document** (Data Security Regulations, regulation 2): a short document of what the database holds, why, where, and who can reach it. `/privacy` and this file hold most of it. Write it as `docs/legal/database-definition.md` before Flow serves other businesses.
2. **Security procedure and access review** (regulations 4 and 8): who has access to Supabase, Cloudflare and GitHub, with two-factor sign-in, reviewed once a year.
3. **Processor terms** (regulation 15): accept each provider's DPA. Supabase, Cloudflare, Google and Resend publish one. TypeSafe: confirm in writing what it keeps and for how long, and that it does not train on Flow's data.
4. **Incident reporting:** a severe security incident is reported to the Privacy Protection Authority right away, and the affected users when the Authority says so. `docs/runbooks/` has no runbook yet.
5. **Personal account deletion** is by email today (`/privacy` and `/terms` promise 30 days). An in-app deletion would close this.
6. **A data processing annex (DPA)** for business customers, like Morning's, once Flow serves businesses other than the owner's.
7. **Operator:** Idan Hazan, a private person (`OPERATOR_NAME` in `app/src/config.ts`), reached at flowsupport@gmail.com (`HELP_EMAIL`). No company is needed; before charging, register as an עוסק and add the number to the pages.
8. **Accessibility check:** once a year, or after a large UI change, check the main screens with VoiceOver and TalkBack and update `/accessibility`.

## When the texts must change

A PR that adds a service that receives data, stores something new on the device, collects a new kind of data, adds a cookie, or starts charging updates `app/src/legal-copy.ts` and `LEGAL_UPDATED` in the same PR (decision 0252, point 7).
