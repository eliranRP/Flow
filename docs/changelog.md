# Changelog

## 2026-09-26

Decisions [0037](decisions/0037-supabase-pilot.md), [0038](decisions/0038-stack.md), and [0039](decisions/0039-pilot-defaults.md), all Accepted. The current technical plan is [tech-plan.md](tech/tech-plan.md). The Cloudflare version is [tech-plan.v1-cloudflare.md](tech/tech-plan.v1-cloudflare.md), superseded.

- **0037.** The pilot runs on Supabase Free in Frankfurt: Postgres with row-level security, Auth with Google, Storage, Edge Functions, `pg_cron`, and a `pgmq` queue. Move to Supabase Pro ($25 a month) at the first paying customer or the first technical limit (database 300 MB, storage 750 MB, egress 3 GB a month, a nightly dump of about 100 MB, or about 15–20 active companies), whichever comes first. PWA static files are free on Cloudflare. Nightly encrypted backups go to Cloudflare R2, with a monthly restore test, because Free has no backups. This supersedes the Cloudflare D1 recommendation. It refines [0034](decisions/0034-cost-and-load-limits.md): the $5 a month cap holds for the pilot; Pro is about $27 a month once growing.
- **0038.** Front end: TypeScript, React and Vite with route code-splitting, React Router, TanStack Query with an IndexedDB cache, supabase-js, vite-plugin-pwa, plain CSS on the design tokens, self-hosted Rubik, Vaul, date-fns `he`, `Intl` for shekels, lazy SheetJS, browser-image-compression, and Zod. Back end: Deno Edge Functions, envelope encryption for SUMIT keys, `@google/genai` (Gemini Flash-Lite, paid tier), and `web-push` (still to verify in Deno). Tests: Vitest, Playwright, and pgTAP.
- **0039.** Pilot defaults, revisitable: the Google screen may show `supabase.co` (no $10 a month custom domain for now); invoice photos stay in Supabase Storage; the Pro trigger is the one in 0037.
- Still open from the plan: skipping SUMIT triggers in this phase, an app domain, VAT on bank-only income, unknown-VAT expenses, cheque date, auto-approve thresholds, nudge days, file retention, and backfill history. The accountant's export shape is also open. A single owner is already [0013](decisions/0013-single-user-owner.md). The Pro trigger, photo storage, and the Auth domain are decided.

## 2026-09-26

Decision [0036](decisions/0036-sumit-read-only.md), Accepted. SUMIT integration is read-only for the proof of concept. Flow never writes to the customer's SUMIT, including project tags, even where a write would cost no quota. Project tags chosen in Flow stay in Flow. Revisit after the proof of concept. The open question on writing project tags back is resolved.

Verified SUMIT API research is in [sumit-api-research.md](tech/sumit-api-research.md).

- One CRM documents call returns all income and expense documents, with the before-VAT amount, VAT rate, customer or supplier, creation time, and the linked source document.
- Expenses created via the API have no VAT split.
- SUMIT budget sections map to projects, but they need SUMIT's Advanced plan. Otherwise Flow does its own project tagging.
- Triggers need the Growth plan. They are only a re-sync signal, alongside a daily poll.
- Reads do not consume the customer's action quota.
- Open: VAT split on expenses entered via the SUMIT website or OCR; stability of the undocumented CRM field names; how API calls are metered.

## 2026-09-26

Decisions [0033](decisions/0033-google-sign-in.md), [0034](decisions/0034-cost-and-load-limits.md), and [0035](decisions/0035-sumit-api-first.md), all Accepted. [0017](decisions/0017-sms-sign-in.md) is Superseded by 0033.

- **0033.** Sign-in is a Google account (Gmail). SMS is out because each code had a cost. The onboarding SMS step and the wrong-code and expired-code states (`er-03`, `er-04`) are obsolete. A Google sign-in screen and a Google sign-in error state will replace them later. Those files are not in this change.
- **0034.** The whole system costs at most $5 per month to run. Home is usable within 2 seconds on a mid-range phone on 4G.
- **0035.** The first data integration is the SUMIT API (sumit.co.il). Flow pulls from SUMIT. Endpoints, sync, and the relation to the Hapoalim upload are still for the tech plan. Open: does SUMIT replace that upload in the proof of concept, or sit alongside it?

## 2026-09-26

Decision [0032](decisions/0032-home-hero-stays-company-net-profit.md), Accepted. With the after-overhead switch on, Home's hero number stays company net profit. The band's small figures show profit before overhead and the overhead amount, and each project row shows profit after its share. The project screen shows before, share, then after. Evidence: [18](../design/screens/18-home-overhead-on-light.png) and [19](../design/screens/19-project-overhead-on-light.png). The open question is resolved.

## 2026-09-26

The approved design package and the logo are in [design](../design/README.md), byte for byte, with [MANIFEST.txt](../design/MANIFEST.txt). Decisions [0024](decisions/0024-design-system-approved.md) through [0031](decisions/0031-logo.md), all Accepted.

- **0024.** Light and dark, the same violet top band `#7B3FE4`, tokens in [design-tokens.json](../design/system/design-tokens.json) and [implementation-tokens.css](../design/system/implementation-tokens.css), Rubik 400/500/600/700 (700 for the wordmark only), spacing and radius scales, and WCAG AA text. Boards [ds-1](../design/system/ds-1-colours-light.png) through [ds-8](../design/system/ds-8-pickers-sheets-light.png).
- **0025.** [implementation-guide.md](../design/system/implementation-guide.md) is mandatory for every screen and every PR review, including the [definition of done](../design/system/implementation-guide.md#12-checklists).
- **0026.** Empty, loading, and error states are required on every screen, light and dark (`design/states/es-*`, `ld-*`, `er-*`, board [ds-7](../design/system/ds-7-empty-loading-light.png)).
- **0027.** Date picker: week starts Sunday, dates are dd/mm/yyyy, single and range pickers with shortcuts ([15a](../design/screens/15a-date-field-light.png)–[15c](../design/screens/15c-date-range-light.png)).
- **0028.** Period sheet from the band pill: this month, last month, year to date, plus a custom range ([16](../design/screens/16-period-sheet-light.png)). This supersedes only 0019's "no custom date range" clause. The three named periods stay.
- **0029.** PWA install prompt after the first successful report, never inside the installed app. Android uses `beforeinstallprompt` ([17a](../design/screens/17a-install-android-light.png)). iPhone is three Safari steps ([17b](../design/screens/17b-install-iphone-light.png)). Onboarding's install step in 0015 stays.
- **0030.** Confirmation sheets for delete, archive, hide category, and a two-step merge. Soft bad-tint button, then an undo toast ([20](../design/screens/20-confirm-delete-light.png)–[23](../design/screens/23-confirm-hide-light.png)).
- **0031.** Logo: Flow wordmark in Rubik 700, letter-spacing −0.01em, `#7B3FE4` on light, `#B894FF` on dark, white on the band. The in-app wordmark uses the `logo` token, not `accent-text`. App icon S1. Cursive and calligraphic explorations were rejected. See [LOGO.md](../design/logo/LOGO.md).
- Open, not decided: with the after-overhead switch on, should Home's big number stay company net profit? The current design keeps it ([18 light](../design/screens/18-home-overhead-on-light.png), [18 dark](../design/screens/18-home-overhead-on-dark.png)).

## 2026-09-26

Decision [0023](decisions/0023-violet-coloured-top-band.md), Accepted. Visual direction: violet with a coloured top band.

- Light-mode accent `#7B3FE4`. Home has a solid violet band with rounded bottom corners: wordmark, greeting, hero profit, and the income and expense line. Text on the band is white, with a light-lilac secondary. The page below is `#FFFFFF`.
- The accent is also on the `+` button, the active tab, the tinted pending card, and the period pill. The profit delta is a small white pill, red `▼` or green `▲`.
- Font is Rubik: hero and titles 600, body 500, hints 400, wordmark 700.
- Rejected: styles A, B, and C; Mercury-like P1 Graphite, P2 Cobalt, and P3 Petrol (too busy, IBM Plex too stiff); D1–D3 (Periwinkle too Mercury-like, Assistant and Varela Round too thin); muted palettes Clay, Navy & Sand, Ocean, Indigo, Ink & Lime, and Honey; bright palettes Azure, Coral, Fuchsia, Aqua, Tangerine, and Emerald; faint off-white tinted backgrounds.
- The P1, P2, and P3 boards in [design](module-1-project-pnl/design/README.md) are superseded. The files stay. A light and dark design system, and hi-fi screens, are not in the repo yet.

## 2026-09-26

The UI direction moves to a Mercury-inspired Home. Styles A, B, and C are superseded. Their files stay. The palette is still pending. Every number is example data.

- [ui-mercury-p1.png](module-1-project-pnl/design/ui-mercury-p1.png), [ui-mercury-p2.png](module-1-project-pnl/design/ui-mercury-p2.png), and [ui-mercury-p3.png](module-1-project-pnl/design/ui-mercury-p3.png) are Graphite, Cobalt, and Petrol. [ui-mercury-overview.png](module-1-project-pnl/design/ui-mercury-overview.png) shows all three. [ui-refs.png](module-1-project-pnl/design/ui-refs.png) records the reference fonts.
- Font: IBM Plex Sans Hebrew, plus IBM Plex Sans for tabular numerals and the shekel sign. Alternative: Assistant.
- Type 12/13/15/17/20/40. Spacing 4/8/12/16/20/24/32/40. Radius 4/8/12/16/full, with cards at 12 and buttons at 8.
- Text colors meet WCAG AA on each background and on white.
- Reference fonts from live CSS: Mercury uses Arcadia, Morning uses Ploni and Ping (Assistant as fallback), RiseUp uses Simpler Pro. Flow does not ship those faces.
- Rules from Design Motion's public patterns: no decorative gradients, no emoji, no identical stat cards, one accent about twice per screen, hairline borders, an arrow or sign with the color, positive profit in ink with green only on a good delta, and a takeaway above the list.
- `wireframes/source/hifi.py`, `palettes.py`, and `render.sh` produce this set.

## 2026-09-26

Settings wireframe and the first UI directions. The owner's style choice is pending. Every number is example data.

- [14-settings.png](module-1-project-pnl/wireframes/14-settings.png) is pending owner approval. Company details, phone sign-in, Bank Hapoalim with the last statement date and upload, links to Categories and Projects, recurring split rules with edit and delete, the two notifications as toggles, an auto-approve toggle, the after-overhead default (off, [0022](decisions/0022-after-overhead-starts-off.md)), Excel and CSV export, log out, and a version line.
- The auto-approve toggle and the notification toggles are on the image. They do not change [0011](decisions/0011-auto-approve-high-confidence.md) or [0018](decisions/0018-two-notifications.md) unless the owner approves this screen.
- UI phase, in [design](module-1-project-pnl/design/README.md). Three Homes, choice pending: A calm fintech (IBM Plex Sans Hebrew), B bold dark (Heebo), C warm practical (Rubik). [style-overview.png](module-1-project-pnl/design/style-overview.png) shows all three. The after-overhead switch is off, so the numbers match the default.
- `wireframes/source/gen.py` adds `14-settings`. `hifi.py` writes the style HTML. `render.sh` screenshots both batches.

## 2026-09-26

Decision [0022](decisions/0022-after-overhead-starts-off.md), Accepted. The after-overhead switch starts off.

- Home and the project screen open on stored project profit, so the default numbers match the bank and the accountant. The owner turns `רווח אחרי חלק מהתקורה` on when they want the overhead view.
- Home, Project, and a display option on the Settings draft are one preference. The Settings option starts off. The rest of Settings stays a draft.
- [01-home-v4](module-1-project-pnl/screens.md#01-home-v4) and [02-project-v2](module-1-project-pnl/screens.md#02-project-v2) still draw the switch on. That is the on state under review, not the default. Both images stay pending owner approval.
- The open question "should the after-overhead toggle be on by default?" is closed.

## 2026-09-26

Wireframes for shared costs and the after-overhead view. All pending owner approval. Every number is example data.

- [11-split-v2.png](module-1-project-pnl/wireframes/11-split-v2.png) supersedes `11-split`. Method control: equal, by income (drawn selected), or manual percent or amount. One tap for every active project. The remainder must reach ₪0 and 100%. `פצל ככה כל חודש` is the recurring split rule.
- [01-home-v4.png](module-1-project-pnl/wireframes/01-home-v4.png) supersedes `01-home-v3`. The after-overhead switch is on. Each project row shows profit after its share, plus a before · share subline, and the bars are hidden. The overhead row is grey and struck through as allocated in this view. Company tiles stay ₪1,310,000 / ₪1,110,000 / ₪200,000.
- [02-project-v2.png](module-1-project-pnl/wireframes/02-project-v2.png) supersedes `02-project`. The same switch, plus a before / share / after card. The share is company overhead times this project's share of company income since the project started. The ₪40,000 share is an example for that window, not the September Home share.
- [overview-6.png](module-1-project-pnl/wireframes/overview-6.png) shows those three phones.
- Overhead shares round to ₪100. The rounding difference goes to one project so the shares add up exactly to overhead. In the September example that ₪100 sits on `שיפוץ דירה ת"א`.
- `wireframes/source/gen.py` and `render.sh` include this batch. Older PNGs are kept.

## 2026-09-26

Decision [0021](decisions/0021-shared-costs-and-overhead.md), Accepted. Shared project costs are split. True overhead stays overhead.

- The split sheet can target every active project: equal, by that period's income share, or manual percent or shekels. The owner can save "split like this every month". The next payment from that payee arrives already split. Income-share rules recalculate each month. Equal uses whoever is active when the payment arrives.
- Office rent, the accountant, insurance, and the rest are not split into transactions. Home and the project screen get a view-only toggle, profit after overhead share, by each project's income share in the selected period. Stored lines and company totals stay as they are.
- Shares use largest remainder so they sum exactly. A project with no income gets none. If every project has no income, the allocation is unavailable and the after-overhead view is not shown.
- The Rule entity now includes a split rule, one per payee, replacing a one-project rule and replaced by one.
- Wireframes `11-split-v2`, `01-home-v4`, and `02-project-v2` are marked coming. They have no image.
- Open: should the after-overhead toggle be on by default?

## 2026-09-26

Wireframes for onboarding, transaction detail, split, unpaid invoices, notifications, and Home v3. All of these are **pending owner approval**.

- [01-home-v3.png](module-1-project-pnl/wireframes/01-home-v3.png) supersedes `01-home-v2`. Three periods (`החודש`, `חודש קודם`, `מתחילת השנה`). Comparison arrows where color means good or bad, not the arrow direction. A quiet unpaid line under the review banner (`3 חשבוניות לא שולמו · ₪23,400`).
- [09-onboarding.png](module-1-project-pnl/wireframes/09-onboarding.png): SMS sign-in, then company details (1/4), Hapoalim export and upload (2/4), proposed projects (3/4), install and the two notifications (4/4).
- [10-transaction-detail.png](module-1-project-pnl/wireframes/10-transaction-detail.png), [11-split.png](module-1-project-pnl/wireframes/11-split.png), [12-unpaid.png](module-1-project-pnl/wireframes/12-unpaid.png), [13-notifications.png](module-1-project-pnl/wireframes/13-notifications.png).
- [overview-5.png](module-1-project-pnl/wireframes/overview-5.png) shows detail, split, unpaid, and Home v3.
- `wireframes/source/gen.py` is the generator for this set. `render.sh` also renders the new names, and still writes PNGs into `wireframes/`.
- [screens.md](module-1-project-pnl/screens.md) replaces the placeholders with purpose, elements, interactions, states, edge cases, and acceptance criteria taken from these images. Differences that are not yet decisions: a category on each split line, what `מחק` removes, what Home's `☰` opens, and the business-type list on onboarding (two options on the image, three in the Settings draft).

## 2026-09-26

Decisions [0015](decisions/0015-installable-mobile-web-app.md) through [0020](decisions/0020-capture-from-the-phone.md), all Accepted.

- **0015.** This phase is an installable mobile web app. No desktop version, and no native iOS or Android app. Onboarding explains the Hapoalim export onto the phone and includes an install step, which is what makes iPhone notifications possible.
- **0016.** Hebrew only. No second language at launch.
- **0017.** Sign-in is a mobile number plus an SMS code. Email and password are rejected.
- **0018.** Two notifications: Sunday 08:00 Israel time (last week's profit and one project alert, opens Home) and 18:00 only when review is waiting (count and estimated minutes, opens Review). No per-transaction notification.
- **0019.** Home periods are this month, last month, and year to date. This month and last month show an up or down percent versus the previous month. The project screen stays project to date. No custom range. The year-to-date arrow is not shown until its baseline is decided. [01-home-v2](module-1-project-pnl/wireframes/01-home-v2.png) still draws two segments and is not superseded.
- **0020.** Capture is several photos in a row, or a PDF or image from files on the phone. Android share-to-app works. iPhone share-to-app does not. A WhatsApp or email forwarding address is after the proof of concept.
- [spec.md](module-1-project-pnl/spec.md), [calculations.md](module-1-project-pnl/calculations.md), [Home](module-1-project-pnl/screens/01-home.md), and [Add](module-1-project-pnl/screens/04-add.md) follow these. [screens.md](module-1-project-pnl/screens.md) has placeholder sections for onboarding, transaction detail, the split sheet, unpaid invoices, and notifications. Those five have no image and no field spec.
- Still open, including the leftovers from these six records: Settings contents, pricing, credit-card timing, the Hapoalim column map, confirming every invoice photo, export of a previous project, two phones offline, changing the phone number, which weekly alert wins, the minute estimate, the year-to-date baseline, the forwarding address, and how onboarding proposes projects.

Review and upload wireframes updated to match auto-approve and Bank Hapoalim.

- [03-review-v2.png](module-1-project-pnl/wireframes/03-review-v2.png) supersedes `03-review`. The card has no `אשר הכל` button. A strip at the top reads `12 אושרו אוטומטית`.
- [08-upload-results-v2.png](module-1-project-pnl/wireframes/08-upload-results-v2.png) supersedes `08-upload-results`. The sample file is `הפועלים_ספטמבר.xlsx`. The 33 invoice and rule matches are one collapsed `אושרו אוטומטית` group. The secondary approve button is gone.
- [overview-4.png](module-1-project-pnl/wireframes/overview-4.png) shows those two phones together.
- `wireframes/source/gen.py` is the generator for this set. `render.sh` also renders `03-review-v2`, `08-upload-results-v2`, and `overview-4`, and still writes PNGs into `wireframes/`.

## 2026-09-26

The product is named Flow. Detailed specs replace every `Detailed spec: TODO`.

- [README](../README.md) and [spec.md](module-1-project-pnl/spec.md) titles use Flow.
- [calculations.md](module-1-project-pnl/calculations.md) defines income, expenses, profit, margin, the three period filters, what counts (approved and paid, cash basis, net of VAT), overhead, and rounding in agorot.
- Per-screen specs for the eight product screens: [Home](module-1-project-pnl/screens/01-home.md), [Project](module-1-project-pnl/screens/02-project.md), [Review](module-1-project-pnl/screens/03-review.md), [Add](module-1-project-pnl/screens/04-add.md), [Projects](module-1-project-pnl/screens/05-projects.md), [Change sheet](module-1-project-pnl/screens/06-change-sheet.md), [Categories](module-1-project-pnl/screens/07-categories.md), [Upload results](module-1-project-pnl/screens/08-upload-results.md). Superseded wireframes and overview boards point at those specs and are not built.
- [settings.md](module-1-project-pnl/settings.md) is a Draft proposal (company, VAT, categories, rules, Excel export, Hapoalim account, auto-approve toggle). Settings contents stay open. The toggle is not approved, because [0011](decisions/0011-auto-approve-high-confidence.md) rejected opt-in auto-approve.
- New open items that the spec refused to guess: Hapoalim column map, confirming every invoice photo, export of a previous project after a move, and two phones offline.

## 2026-09-26

Owner answers, recorded as [0011](decisions/0011-auto-approve-high-confidence.md) through [0014](decisions/0014-optional-project-budget.md). All four are Accepted.

- **0011.** High-confidence rows (bank row matched to an existing invoice, or an existing supplier rule) auto-approve, skip the review queue, and show up in a short summary the owner can reopen.
- **0012.** Statement import in the proof of concept is Bank Hapoalim (`בנק הפועלים`) only. Other banks and credit-card companies come later.
- **0013.** Single user: the business owner. No roles or permissions. An office manager is a later option.
- **0014.** Project budget stays optional. Budget versus actual appears on the project screen only when a budget is set.
- [spec.md](module-1-project-pnl/spec.md) follows these four. The one-pager and the screen notes that still described the questions as open now point at the records. [0006](decisions/0006-confirm-not-type.md) and [0007](decisions/0007-bank-statement-is-primary-input.md) stay Accepted and cross-link 0011 and 0012.
- Removed the answered items from [open questions](open-questions.md). Still open: Settings screen contents, the per-screen detailed spec, pricing, and when credit-card statement support starts.

## 2026-09-26

Initial product documentation for Module 1, Project P&L.

- Product one-pager and documentation index in `README.md`.
- Module spec: cash-basis company and project P&L, intake, review and rules, categories, scale, data model, export, out of scope, and success metrics.
- Screen notes for every wireframe, each with a `Detailed spec: TODO` subsection. Approved set: `01-home-v2`, `02-project`, `03-review`, `04-add`, `05-projects`, `06-change-sheet-v2`, `07-categories`, `08-upload-results`, plus the three overview boards. `01-home` and `06-change-sheet` are kept and marked superseded.
- Wireframe PNGs and the HTML generator (`wireframes/source/gen.py`, `wireframes/source/render.sh`). `render.sh` writes PNGs into `wireframes/`. The uploaded script wrote them into `/workspace/wireframes-pnl`.
- Decision records [0001](decisions/0001-management-tool-alongside-accounting.md) through [0010](decisions/0010-docs-are-the-source-of-truth.md), all accepted on this date.
- Open questions and the documentation contributing guide.
