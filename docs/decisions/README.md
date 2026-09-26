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
| [0007](0007-bank-statement-is-primary-input.md) | 2026-09-26 | Accepted | The bank statement is the primary input; unpaid invoices stay out of P&L |
| [0008](0008-flat-categories-hide-or-merge.md) | 2026-09-26 | Accepted | Seven default categories, flat list, hide or merge when used |
| [0009](0009-scalable-pickers.md) | 2026-09-26 | Accepted | Pickers and Home stay usable with many projects |
| [0010](0010-docs-are-the-source-of-truth.md) | 2026-09-26 | Accepted | These docs, including decision records, are the source of truth |
| [0011](0011-auto-approve-high-confidence.md) | 2026-09-26 | Accepted | Auto-approve high-confidence items; they skip the review queue |
| [0012](0012-bank-hapoalim-first.md) | 2026-09-26 | Accepted | Proof of concept imports Bank Hapoalim statements only |
| [0013](0013-single-user-owner.md) | 2026-09-26 | Accepted | Single user: the business owner; no roles yet |
| [0014](0014-optional-project-budget.md) | 2026-09-26 | Accepted | Project budget stays optional |
| [0015](0015-installable-mobile-web-app.md) | 2026-09-26 | Accepted | Installable mobile web app; no desktop and no native app in this phase |
| [0016](0016-hebrew-only.md) | 2026-09-26 | Accepted | Hebrew only |
| [0017](0017-sms-sign-in.md) | 2026-09-26 | Accepted | Sign in with phone number and an SMS code |
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
