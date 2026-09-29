# Decisions

Product decisions are numbered records in this folder. The record is the source of truth for why the product works the way it does. The [Module 1 spec](../module-1-project-pnl/spec.md) describes the behavior that follows from these records.

## Format

One file per decision: `NNNN-short-kebab-title.md`. Numbers are four digits and are never reused.

```markdown
# Title

**Date:** YYYY-MM-DD
**Status:** Accepted

## Context

## Decision

## Alternatives rejected

## Consequences
```

`Status` is `Accepted` or `Superseded`. A superseded record keeps its original text and gains a `Superseded by` line that links to the newer record. The newer record links back. How to add and supersede records is in [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Index

| Record | Date | Status | Decision |
| --- | --- | --- | --- |
| [0001](0001-management-tool-alongside-accounting.md) | 2026-09-26 | Accepted | Management tool alongside the accountant's books, not a replacement |
| [0002](0002-poc-targets-construction-contractors.md) | 2026-09-26 | Accepted | Proof of concept targets construction contractors; the model stays generic |
| [0003](0003-no-invoicing-in-the-poc.md) | 2026-09-26 | Accepted | No invoicing in the proof of concept; Morning comes later |
| [0004](0004-cash-basis-for-v1.md) | 2026-09-26 | Accepted | Cash basis for v1 |
| [0005](0005-mobile-first.md) | 2026-09-26 | Accepted | Mobile first |
| [0006](0006-confirm-not-type.md) | 2026-09-26 | Accepted | Confirm, don't type; corrections become supplier rules |
| [0007](0007-bank-statement-is-primary-input.md) | 2026-09-26 | Accepted | Cash basis: a payment counts and an unpaid invoice stays out of P&L. [0065](0065-review-round5.md) drops the file import |
| [0008](0008-flat-categories-hide-or-merge.md) | 2026-09-26 | Accepted | Seven default categories, flat list, hide or merge when used |
| [0009](0009-scalable-pickers.md) | 2026-09-26 | Accepted | Pickers and Home stay usable with many projects |
| [0010](0010-docs-are-the-source-of-truth.md) | 2026-09-26 | Accepted | These docs, including decision records, are the source of truth |
| [0011](0011-auto-approve-high-confidence.md) | 2026-09-26 | Accepted | Auto-approve high-confidence items; they skip the review queue |
| [0012](0012-bank-hapoalim-first.md) | 2026-09-26 | Superseded | Proof of concept imports Bank Hapoalim statements only. Superseded by [0065](0065-review-round5.md): bank lines come from SUMIT |
| [0013](0013-single-user-owner.md) | 2026-09-26 | Accepted | Single user: the business owner; no roles yet |
| [0014](0014-optional-project-budget.md) | 2026-09-26 | Accepted | Project budget stays optional |
| [0015](0015-installable-mobile-web-app.md) | 2026-09-26 | Accepted | Installable mobile web app; no desktop and no native app in this phase |
| [0016](0016-hebrew-only.md) | 2026-09-26 | Accepted | Hebrew only |
| [0017](0017-sms-sign-in.md) | 2026-09-26 | Superseded | Sign in with phone number and an SMS code. Superseded by 0033 |
| [0018](0018-two-notifications.md) | 2026-09-26 | Accepted | Two notifications: Sunday summary, and an 18:00 review nudge |
| [0019](0019-home-periods-and-comparison.md) | 2026-09-26 | Accepted | Home: this month, last month, year to date, with a month comparison |
| [0020](0020-capture-from-the-phone.md) | 2026-09-26 | Accepted | Multi-photo and files on the phone; Android share target only |
| [0021](0021-shared-costs-and-overhead.md) | 2026-09-26 | Accepted | Shared project costs are split; true overhead stays overhead, with a view-only share |
| [0022](0022-after-overhead-starts-off.md) | 2026-09-26 | Accepted | The after-overhead switch starts off, so the default numbers match the bank |
| [0023](0023-violet-coloured-top-band.md) | 2026-09-26 | Accepted | Visual direction: violet with a coloured top band |
| [0024](0024-design-system-approved.md) | 2026-09-26 | Accepted | Design system approved: light and dark, one violet band, Rubik, WCAG AA text |
| [0025](0025-implementation-guide-is-mandatory.md) | 2026-09-26 | Accepted | The implementation guide, including its definition of done, is mandatory |
| [0026](0026-empty-loading-error-states.md) | 2026-09-26 | Accepted | Every screen has empty, loading, and error states, in light and dark |
| [0027](0027-date-picker.md) | 2026-09-26 | Accepted | Week starts Sunday; dates are dd/mm/yyyy; single and range pickers |
| [0028](0028-period-sheet-with-custom-range.md) | 2026-09-26 | Accepted | Period sheet from the band pill, including a custom range |
| [0029](0029-pwa-install-prompt.md) | 2026-09-26 | Accepted | PWA install prompt after the first successful report; Android and iPhone variants |
| [0030](0030-confirmation-sheets.md) | 2026-09-26 | Accepted | Confirmation sheets for delete, archive, hide, and a two-step merge |
| [0031](0031-logo.md) | 2026-09-26 | Accepted | Flow wordmark and the S1 app icon |
| [0032](0032-home-hero-stays-company-net-profit.md) | 2026-09-26 | Accepted | With the after-overhead switch on, Home's big number stays company net profit |
| [0033](0033-google-sign-in.md) | 2026-09-26 | Accepted | Sign in with a Google account (Gmail). Supersedes 0017 |
| [0034](0034-cost-and-load-limits.md) | 2026-09-26 | Accepted | Running cost at most $5 a month; Home usable within 2 seconds |
| [0035](0035-sumit-api-first.md) | 2026-09-26 | Accepted | The first data integration is the SUMIT API |
| [0036](0036-sumit-read-only.md) | 2026-09-26 | Accepted | SUMIT integration is read-only. [0065](0065-review-round5.md) closes the Hapoalim question: the pull replaces the upload |
| [0037](0037-supabase-pilot.md) | 2026-09-26 | Accepted | Pilot on Supabase Free in Frankfurt; Pro at the first customer or limit. Supersedes the D1 plan |
| [0038](0038-stack.md) | 2026-09-26 | Accepted | TypeScript, React, Vite, and Supabase Edge Functions. [0065](0065-review-round5.md) drops SheetJS |
| [0039](0039-pilot-defaults.md) | 2026-09-26 | Accepted | Pilot defaults: supabase.co on the Google screen, photos in Storage, Pro trigger as in 0037 |
| [0040](0040-tailwind-v4.md) | 2026-09-26 | Accepted | Styling is Tailwind CSS v4, mapped from the design tokens. Replaces the plain-CSS line in 0038 |
| [0041](0041-amounts-before-vat.md) | 2026-09-26 | Accepted | P&L amounts are before VAT. 0043 amends the missing-split rule for expenses |
| [0042](0042-sumit-primary-income-and-expenses.md) | 2026-09-26 | Accepted | SUMIT is the primary source for income and expenses. [0065](0065-review-round5.md) drops the Hapoalim complement |
| [0043](0043-assumed-vat-on-expenses.md) | 2026-09-27 | Accepted | Expenses with no VAT split assume 18%, unless the supplier is VAT-exempt |
| [0044](0044-phase-0-shell-calls.md) | 2026-09-27 | Accepted | Phase 0 shell: preview banner, es-01 copy, type scale, placeholders, review states |
| [0045](0045-phase-0-design-gaps.md) | 2026-09-28 | Accepted | Phase 0 design gaps: help, load errors, greeting, period pill, Add hint, tab-bar floor |
| [0046](0046-public-anon-key.md) | 2026-09-28 | Accepted | The public anon key is committed in app/.env.production. The service role is never in the client or the repo |
| [0047](0047-onboarding-and-period.md) | 2026-09-28 | Accepted | First Google sign-in creates one company. The period sheet is in this slice. 0060 keeps the invoiced basis only |
| [0048](0048-sumit-key-envelope.md) | 2026-09-28 | Accepted | The SUMIT key is AES-GCM sealed. The client never receives it |
| [0049](0049-sumit-refresh.md) | 2026-09-28 | Accepted | SUMIT refresh is a button plus a daily cron row. Read-only allowlist |
| [0050](0050-demo-splits-and-review.md) | 2026-09-28 | Accepted | Demo site-worker days are a split rule. SUMIT rows stay in the P&L while queued |
| [0057](0057-component-library.md) | 2026-09-28 | Accepted | Screens are assembled from `app/src/ui`. The gallery route is replaced by 0058. 0051–0056 stay on the remainder branch |
| [0058](0058-storybook.md) | 2026-09-28 | Accepted | Storybook 8 replaces `/dev/components`. Dev dependency only. The library rule in 0057 stays |
| [0059](0059-live-sumit-only.md) | 2026-09-28 | Accepted | Signed-in books come from the live SUMIT import. The golden JSON is the test answer key only |
| [0060](0060-library-review-calls.md) | 2026-09-28 | Accepted | Avatar and Card go. Invoiced basis only. Over-budget is the danger bar plus a text line |
| [0061](0061-review-undo.md) | 2026-09-28 | Accepted | Undo puts a review item back on the queue. 0063 restores the previous assignment and brings Toggle back |
| [0062](0062-audit-layout-calls.md) | 2026-09-28 | Accepted | Fixed-height controls ellipsize. Empty states use the small pill. A 0% change stays visible |
| [0063](0063-owner-ledger.md) | 2026-09-28 | Accepted | Sync writes only SUMIT fields. The design review restores Toggle, the tab bar on pushed screens, and "טרם נגבה" |
| [0064](0064-review-round4.md) | 2026-09-28 | Accepted | Library-only screens, a saved overhead switch with a zero share, income stays out of Review |
| [0065](0065-review-round5.md) | 2026-09-28 | Accepted | Real reassignment and categories, income-share overhead, a cron drain that requires a secret, a summary-then-picker change sheet, install screens, and no Hapoalim import |
| [0066](0066-review-round7.md) | 2026-09-28 | Accepted | Library Split and Onboarding, a re-runnable drain, shared costs stay on Split, SUMIT backoff, and no bank row |
| [0067](0067-review-round8.md) | 2026-09-28 | Accepted | A split keeps its category, SUMIT auth waits for a reconnect, and refresh respects the backoff |
| [0068](0068-review-round9.md) | 2026-09-28 | Accepted | Shared labels match the split, a category save closes only a missing category, and a new SUMIT company retires the old ledger. Addendum: the retry clock stays readable, and the project loading band matches the loaded band. Further addendum: disconnect remembers the SUMIT company id, a category save on an unsplit shared cost opens the split item, and the live check is read-only by default. A rejected key explains itself on the refresh row, and backoff says SUMIT is unavailable now. r16: an unsplit shared cost saves without claiming approval, the owner cannot write the remembered SUMIT id, and the auth screen says reconnect once. r17: `reassign_undo` enables row level security with no policies, a sheet panel draws no ring, and the overhead hint wording stays |
| [0069](0069-back-and-one-tap-review.md) | 2026-09-29 | Accepted | Back pops the real previous screen, and אישור accepts the project and category on the card. A toast sits under the header and leaves on its own. The Home hero is a label, the number, and one explanation. Split v2: presets first, no ₪ typing, manual % behind חלוקה ידנית |
