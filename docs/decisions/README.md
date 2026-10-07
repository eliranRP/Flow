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
| [0008](0008-flat-categories-hide-or-merge.md) | 2026-09-26 | Accepted | Seven default categories, flat list, hide or merge when used. [0086](0086-mercury.md) adds תשלומי הלוואה and העברות (expense and income), excluded from P&L. [0088](0088-loans.md) adds ריבית משכנתא and מסים וביטוח, in the P&L |
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
| [0069](0069-back-and-one-tap-review.md) | 2026-09-29 | Accepted | Back pops the real previous screen, and אישור accepts the project and category on the card. A toast sits under the header and leaves on its own. The Home hero is a label, the number, and one explanation. Split v2: presets first, no ₪ typing, manual % behind חלוקה ידנית. צפייה opens today's auto-assigned list. A tap anywhere in a field focuses it, and 9,999,999.99 stays visible |
| [0070](0070-split-remainder-and-undo-log.md) | 2026-09-29 | Accepted | The saved split matches the screen. `reassign_undo` is revoked from the owner again. Income is filed without a queue, and an unconfirmed category stays out of the project breakdown |
| [0071](0071-shared-cost-copy.md) | 2026-09-29 | Accepted | An unallocated shared cost says approval opens the split. A waiting line keeps the project category list honest |
| [0072](0072-design-review-rulings.md) | 2026-09-29 | Accepted | Invalid split rows show their own percent. Preview notices are info. Unequal even parts name the whole amount. A filtered queue returns to its project |
| [0073](0073-review-handoff.md) | 2026-09-29 | Accepted | From r23, a handoff includes a self-check. `/reviewer` is sample data on the dev server or a reviewers-only build with no hosted key. Only Blocking and Should items block a merge |
| [0074](0074-toast-and-remembered-supplier.md) | 2026-09-29 | Accepted | A plain confirmation stays 4s and an action stays 5s. The supplier name wraps. A toast over a sheet sits above it |
| [0075](0075-save-on-tap-and-on-leave.md) | 2026-09-29 | Accepted | A change-sheet tap saves immediately, and leaving saves anything still pending. The summary save button is gone. The new-project name keeps שמירה |
| [0076](0076-collapse-split-to-one-project.md) | 2026-09-29 | Accepted | A split can return to one project. The choice is לפרויקט אחד, the note says the split will go, and ביטול restores it |
| [0077](0077-deploy-after-ci.md) | 2026-09-30 | Accepted | Production deploy is a CI job on a push to main, after lint, check, and e2e. The hosted build is checked before the migration |
| [0078](0078-schema-v1-rename.md) | 2026-09-30 | Accepted | Renaming schema_v1 to 20260928080538 is a one-time exception. The lock stores a sha256, and applied SQL stays byte-identical |
| [0079](0079-automatic-deploy-owner-risk.md) | 2026-09-30 | Accepted | Deploys stay automatic after the reviewer bots and green CI. No required production reviewer, and 0 required PR approvals. CODEOWNERS notifies only |
| [0080](0080-mcp-connector.md) | 2026-09-30 | Accepted | First MCP release, 18 hours: read, assign one expense, Settings עוזר, typed undo. Bulk, splits, and the marker wait |
| [0081](0081-review-queue-list.md) | 2026-10-02 | Accepted | הצג הכול lists every pending item at `/review/all`. Card lines open the picker, and the notes say הקישו לבחירה |
| [0082](0082-settings-redesign.md) | 2026-10-03 | Accepted | Settings is the account row, חיבורים, תצוגה, and עוד. No company is `company_id` null. This amends the Settings section of 0080. §1 superseded by 0116 |
| [0083](0083-jev-connector.md) | 2026-10-03 | Accepted | Jev is an optional connector, off by default. The API key stays in Vault and is read only by the service role |
| [0084](0084-jev-auto-prefill.md) | 2026-10-03 | Accepted | Jev auto pre-fills a project and category and still waits in לאישור. It never approves |
| [0085](0085-connector-engine.md) | 2026-10-03 | Accepted | One connector engine. SUMIT moves onto it. `sumit_*` tables are dropped in that stack. The contract names the port |
| [0086](0086-mercury.md) | 2026-10-03 | Accepted | Mercury is a pasted read-only token. GET only. Pending is tagged and excluded from totals. No VAT, no dedup |
| [0087](0087-multi-currency.md) | 2026-10-03 | Accepted | Display currency is ₪ or $ per company. A dollar line stays USD. Conversion is at display time, from fx_rates |
| [0088](0088-loans.md) | 2026-10-04 | Accepted | A loan is set up once. Each payment splits into interest, escrow, and principal. The currency stays on the loan |
| [0089](0089-setup-runner.md) | 2026-10-04 | Accepted | First-run setup is five counted steps plus an uncounted company step. Done is derived. Skips live in localStorage for v1 |
| [0090](0090-mcp-cycle4.md) | 2026-10-06 | Accepted | MCP cycle 4: create_project, create_category, sync_bank via internal mercury-sync; undo deletes only when unreferenced |
| [0091](0091-income-in-review.md) | 2026-10-06 | Accepted | Posted connector income without a project enters review. Approval needs a project unless the category is off-P&L. USD review cards omit VAT copy |
| [0092](0092-mcp-loans.md) | 2026-10-06 | Accepted | MCP cycle 5: loan list, schedule, add, update, attach payment, and undo |
| [0093](0093-mcp-batch.md) | 2026-10-06 | Accepted | MCP cycle 6: assign_expenses and undo_batch; one tools/call per write rate hit, partial success, batch undo |
| [0094](0094-usd-totals.md) | 2026-10-06 | Accepted | `company_pnl` and MCP totals expose `by_currency` per line currency; ILS agorot fields unchanged |
| [0095](0095-mcp-first.md) | 2026-10-06 | Accepted | MCP-first: every new feature or user action ships with a flow-mcp tool (and an API where possible) in the same PR |
| [0096](0096-currency-display.md) | 2026-10-07 | Accepted | Per-currency display in the app; one formatter; expenses always signed |
| [0097](0097-mercury-income-invoice-receipt.md) | 2026-10-07 | Accepted | Mercury deposits and treasury income import as `invoice_receipt`, so they count on the invoiced basis; stored rows are relabeled |
| [0099](0099-categories-outside-pnl.md) | 2026-10-07 | Accepted | `excluded_from_pnl` defaults, `private.pnl_lines`, separate excluded totals, API + MCP `set_category_pnl`; UI deferred |
| [0100](0100-loan-split-pnl.md) | 2026-10-07 | Accepted | Loan payments count by split part in every P&L read: interest and escrow in, principal kept out; flagged or VAT lines fall back and are counted in `loan_split_fallback_count` |
| [0101](0101-unassigned-and-overhead-project.md) | 2026-10-07 | Accepted | `unassigned` bucket in `company_pnl` and MCP totals so the buckets add up; one overhead project per company (`set_overhead_project`, API + MCP); unpaid expenses count by document date on both bases, pending lines on neither |
| [0102](0102-sync-bank-jobs.md) | 2026-10-07 | Accepted | `sync_bank` starts a job and returns `job_id` at once; `get_sync_status` reads it; the finish step validates the shape and signs a fresh JWT |
| [0103](0103-reversals-across-directions.md) | 2026-10-07 | Accepted | The category kind decides the P&L side: an outflow under an income category is negative income, an inflow under an expense category is negative expense; reversal income counts on both bases |
| [0104](0104-line-split-by-category.md) | 2026-10-07 | Accepted | `line_splits`: one bank line in parts with their own category, optional project and exact minor-unit amount; `private.pnl_lines` counts by part; `save_line_split` RPC and MCP `split_line` with undo `line_split` |
| [0105](0105-loan-project.md) | 2026-10-07 | Accepted | A loan may belong to one project (optional, same company by foreign key); its attached payments file an unassigned line under that project as a direct cost, so interest and escrow count there |
| [0106](0106-kept-out-toggle.md) | 2026-10-07 | Accepted | The categories screen marks kept-out categories with ⊘ and toggles the flag from the row sheet on tap, with a ביטול toast; loan categories stay fixed |
| [0107](0107-loan-split-on-the-transaction.md) | 2026-10-07 | Accepted | Loan split on the transaction: parts with icons, minus and a total, "מחוץ לרווח" on a kept-out part, "נספר ברווח" when the line counts by parts; list rows say "3 חלקים"; `get_loan_split` feeds the app and MCP `get_expense` |
| [0108](0108-rename-company-row.md) | 2026-10-07 | Accepted | The business name is its own Settings row (amends 0082 §2); owners tap it to rename the company in a one-field sheet with an undo toast; viewers see it static |
| [0110](0110-home-breakdown.md) | 2026-10-07 | Accepted | Home income and expense breakdown: `get_breakdown` (groups by category, project, or payer; totals equal `company_pnl`) and `get_breakdown_lines`, MCP `get_breakdown` |
| [0111](0111-setup-card-close.md) | 2026-10-07 | Accepted | The Home setup card closes with a ✕ "סגירת ההגדרה"; closing also stops the one automatic resume; the toast says it is for good and points to Settings |
| [0112](0112-line-out-of-pnl.md) | 2026-10-07 | Accepted | One line in or out of the P&L: `transactions.in_pnl_override` wins over the category flag; the transaction card's עוד sheet toggles it with a ⊘ pill and a ביטול toast; MCP `set_line_pnl` and `set_lines_pnl` with undo; loan lines stay fixed |
| [0113](0113-bank-details-per-line.md) | 2026-10-07 | Accepted | Bank details per line: the connector keeps method, card last 4, memo and account id through one allowlist; `get_line_meta` and MCP `meta` return them with nothing beyond a last 4; the review card and transaction screen show them (option A) |
| [0114](0114-income-green-type-scale.md) | 2026-10-07 | Accepted | Income amounts are green (`income`, no plus, never on the band, never with a minus); option C type: page titles 34, `heading` 20, row titles 17/400, list amounts 400, secondary lines 15/400, project name 32 on the band; cents in transaction rows; no row hairlines |
| [0116](0116-settings-connections-and-loans-pages.md) | 2026-10-07 | Accepted | Settings opens two pages: חיבורים (`/settings/connections`, SUMIT, Mercury, Jev, עוזר AI) and הלוואות (`/settings/loans`), from one quiet group with hints; old `/settings?sheet=` links redirect; viewers read loans. Supersedes 0082 §1 |
