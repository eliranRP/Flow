# Open questions

These are not decisions. When one is settled, add a numbered decision record, point the question at it, and update the [changelog](changelog.md).

Settled earlier and removed from this list: auto-approve ([0011](decisions/0011-auto-approve-high-confidence.md)), which bank comes first ([0012](decisions/0012-bank-hapoalim-first.md)), roles ([0013](decisions/0013-single-user-owner.md)), and whether budget is required ([0014](decisions/0014-optional-project-budget.md)). Also settled, with leftovers called out below: the installable phone web app ([0015](decisions/0015-installable-mobile-web-app.md)), Hebrew only ([0016](decisions/0016-hebrew-only.md)), Google account sign-in ([0033](decisions/0033-google-sign-in.md), which supersedes [0017](decisions/0017-sms-sign-in.md)), the two notifications ([0018](decisions/0018-two-notifications.md)), Home periods ([0019](decisions/0019-home-periods-and-comparison.md)), phone capture ([0020](decisions/0020-capture-from-the-phone.md)), the after-overhead switch starting off ([0022](decisions/0022-after-overhead-starts-off.md)), Home's big number staying company net profit when that switch is on ([0032](decisions/0032-home-hero-stays-company-net-profit.md)), and not writing project tags back to SUMIT ([0036](decisions/0036-sumit-read-only.md)). Amounts before VAT, with a missing split flagged "VAT unknown", are [0041](decisions/0041-amounts-before-vat.md). SUMIT as the primary source for income and expenses, with Hapoalim as a complement, is [0042](decisions/0042-sumit-primary-income-and-expenses.md). The per-screen spec for the eight approved screens is written.

## Settings screen

A proposal is in [settings.md](module-1-project-pnl/settings.md). **Status: Draft. Not approved.**

A wireframe is now drawn: [14-settings](module-1-project-pnl/screens.md#14-settings), pending owner approval. It shows company details, phone sign-in, the Hapoalim connection, links to Categories and Projects, recurring split rules, the two notifications as toggles, an auto-approve toggle, the after-overhead default (off), Excel and CSV export, log out, and a version line. Every figure on it is example data. The after-overhead default is decided ([0022](decisions/0022-after-overhead-starts-off.md)). The rest of this screen is not.

Open until the draft is accepted or replaced:

- Whether this set of sections is what ships.
- The VAT-status enum (`עוסק מורשה`, `עוסק פטור`, `חברה`) and the 18% default rate. Onboarding, pending approval, draws only `חברה בע״מ` and `עוסק מורשה`.
- Whether Home's `☰` opens this screen. The unpaid-invoices wireframe, also pending approval, lists `☰` as a way into that list.
- The auto-approve toggle. [0011](decisions/0011-auto-approve-high-confidence.md) auto-approves by default and rejected an opt-in switch. The wireframe draws the toggle and says not to build the off position unless a new decision supersedes 0011, or this screen is approved as that decision.
- The two notification toggles. [0018](decisions/0018-two-notifications.md) defines the two sends and did not add a settings screen for turning one off. The wireframe draws both on. That does not change 0018 until the screen is approved.
- The after-overhead display option is not part of this open list. Its default is off ([0022](decisions/0022-after-overhead-starts-off.md)). Adding it does not approve the rest of this draft.

## Pricing

Pricing has not been discussed. Who uses Flow in the proof of concept is decided: one user, the owner ([0013](decisions/0013-single-user-owner.md)).

Open: pricing.

## Credit-card statement support timing

[0012](decisions/0012-bank-hapoalim-first.md) keeps credit-card company files out of the proof of concept. Bank Hapoalim (`בנק הפועלים`) is the statement format Flow imports.

Open: when, after the proof of concept, credit-card statement import starts.

## Hapoalim file shape

Flow's behavior for a recognized file, a duplicate file, and an unrecognized file is specified. The column map is not. Overlapping imports treat a row as the same row when the saved account, value date, signed amount in agorot, and normalized memo all match. That identity is a working rule.

Open: confirm the columns and the row identity against a real Bank Hapoalim sample before the parser is built.

## Confirming an invoice photo

A complete extraction (supplier, net, and date) is stored as an unpaid document without a review card. An incomplete extraction asks the owner to fill the gaps.

Open: should the owner confirm every photo, including a complete one?

## Export after a transaction moves

The Settings draft exports the current project and category only. Flow does not keep the previous assignment.

Open: does the accountant's Excel file also need the project the row had before the owner moved it?

## Two phones offline

The proof of concept assumes one phone. Project codes are assigned on the device. Two phones creating a project while offline could pick the same `P-` code.

Open: is more than one phone in scope for the proof of concept, and if it is, how do codes merge?

## Changing the phone number

No longer applies. [0033](decisions/0033-google-sign-in.md) supersedes [0017](decisions/0017-sms-sign-in.md). The account is a Google account, not a phone number.

## SUMIT and the Hapoalim upload

Resolved by [0042](decisions/0042-sumit-primary-income-and-expenses.md). SUMIT, the expense module and the documents, is the primary source for income and expenses. The Hapoalim statement upload stays as a complement for cash matching and for anything not in SUMIT. It does not replace SUMIT, and SUMIT does not replace it.

## Expenses recorded in SUMIT

Resolved by [0042](decisions/0042-sumit-primary-income-and-expenses.md). Contractors record expenses in SUMIT. That is why the expense module and the documents are the primary source, not a book kept only outside SUMIT.

## Write project tags back to SUMIT

Resolved by [0036](decisions/0036-sumit-read-only.md). Flow does not write project or budget-section tags back to the customer's SUMIT in the proof of concept, even where that write would cost no quota. Tags chosen in Flow stay in Flow. Revisit after the proof of concept. See [SUMIT API research](tech/sumit-api-research.md).

## VAT split on SUMIT website or OCR expenses

Expenses created through the SUMIT API have no VAT split ([research](tech/sumit-api-research.md)). Expenses entered on the SUMIT website, or by OCR, were not checked.

Open: what VAT split do those website and OCR expenses carry? If a document has no split, [0041](decisions/0041-amounts-before-vat.md) shows the gross amount flagged "VAT unknown".

## Stability of the undocumented CRM field names

The CRM documents call uses field names that are not in SUMIT's documented contract ([research](tech/sumit-api-research.md)). `documents/list` is the documented fallback.

Open: how stable are those undocumented CRM field names?

## How SUMIT API calls are metered

Reads did not consume the customer's action quota on the test plan ([research](tech/sumit-api-research.md)). The API-call counter itself was not visible.

Open: how are API calls metered?

## Which project alert is the weekly one

The Sunday 08:00 notification includes last week's profit and one project alert ([0018](decisions/0018-two-notifications.md)). The examples are a project over budget, or a project losing money. The ranking when more than one project qualifies is not specified.

Open: which single project is named when several lost money last week and several are over budget.

## Estimated minutes on the daily nudge

The 18:00 notification includes the waiting count and an estimated number of minutes ([0018](decisions/0018-two-notifications.md)). No formula was set.

Open: how those minutes are estimated.

## Year-to-date comparison

This month compares with the previous calendar month. Last month compares with the month before that ([0019](decisions/0019-home-periods-and-comparison.md)). A year-to-date sum and one month are different lengths, so "versus the previous month" does not name a baseline. Until that is decided, year-to-date tiles show no arrow. See [calculations](module-1-project-pnl/calculations.md#comparison-arrow).

Open: the year-to-date baseline. Candidates mentioned only so the question is concrete: the previous calendar month, the same span of last year, or no arrow on that period.

## Forwarding address

After the proof of concept, a WhatsApp or email address the owner can forward invoices and statements to ([0020](decisions/0020-capture-from-the-phone.md)). It is not in this phase. Until then, capture is several photos, a file already on the phone, and, on Android only, the system share sheet.

Open, as backlog: the forwarding address.

## Projects proposed at onboarding

[09-onboarding](module-1-project-pnl/screens.md#09-onboarding), pending owner approval, proposes a project for each repeated incoming payer on the Hapoalim file. Rows start checked. The owner can rename, uncheck, or add one. Confirm creates the checked projects. The example rows have 6, 4, 3, and 2 incoming payments. Those counts are the sample, not a threshold.

Open: how many incoming payments, over what period, make a payer "recurring."

## Category on each split line

[11-split](module-1-project-pnl/screens.md#11-split), pending owner approval, draws a category on each line and the annotation says it can differ from the invoice. [Splits](module-1-project-pnl/calculations.md#splits) still copy one category onto every line. A hand-built split does not turn on the one-project remember toggle. A recurring split rule is a separate control ([0021](decisions/0021-shared-costs-and-overhead.md)).

Open, until that sheet is approved: may two lines of one payment use two categories?

## Delete on transaction detail

[10-transaction-detail](module-1-project-pnl/screens.md#10-transaction-detail), pending owner approval, has `מחק`. The first tap asks for confirmation. The image does not say what a confirmed delete removes.

Open: after confirm, is the bank row, the invoice, or both removed, and does the shekel leave the P&L?

## Owner's given name

Home greets `שלום, {first name}`. The example is `יוסי`. Onboarding as drawn asks for a phone number and company details, not a person's name.

Open: where that given name is captured.

## Home's big number when after-overhead is on

Resolved by [0032](decisions/0032-home-hero-stays-company-net-profit.md). With the switch on, Home's hero number stays company net profit. The band's small figures show profit before overhead and the overhead amount. Each project row shows profit after its share. The project screen shows before, share, then after. Evidence: [18 light](../design/screens/18-home-overhead-on-light.png), [18 dark](../design/screens/18-home-overhead-on-dark.png), [19 light](../design/screens/19-project-overhead-on-light.png), [19 dark](../design/screens/19-project-overhead-on-dark.png).

## Technical plan

From [tech-plan.md](tech/tech-plan.md) §10.2. Three of these are decided. The rest are still open.

## When to move to Supabase Pro

Resolved by [0037](decisions/0037-supabase-pilot.md) and [0039](decisions/0039-pilot-defaults.md). Move at the first paying customer or the first technical limit, whichever comes first.

## SUMIT triggers in this phase

[0036](decisions/0036-sumit-read-only.md) forbids writing to the customer's SUMIT. Registering a trigger is a write. The plan asks to confirm that SUMIT triggers are skipped in this phase.

Open: are SUMIT triggers skipped for Module 1?

## Invoice photo storage

Resolved by [0039](decisions/0039-pilot-defaults.md). Invoice photos are stored in Supabase Storage for the pilot.

## Custom domain on the Google sign-in screen

Resolved by [0039](decisions/0039-pilot-defaults.md). The pilot accepts the `supabase.co` address. The $10 a month custom domain is not bought for now.

## App domain

Open: use a `workers.dev` address for the pilot, or buy a domain before inviting customers?

## VAT on bank-only income

Resolved by [0041](decisions/0041-amounts-before-vat.md). Where the source has no VAT split, show the gross amount flagged "VAT unknown". Do not derive a split at the standard rate.

## Unknown-VAT expenses

Resolved by [0041](decisions/0041-amounts-before-vat.md). Show the gross amount flagged "VAT unknown". Do not hold the row for a review question instead of that flag.

## Cheque date

Open: count a cheque on the receipt date, or on the cheque due date?

## Auto-approve thresholds

[0011](decisions/0011-auto-approve-high-confidence.md) auto-approves a unique invoice match or a supplier rule. The plan asks for numbers on top of that.

Open: is 90% the threshold, with a ₪5,000 limit on a new supplier, and is auto-approve off in the first week?

## Nudge days

[0018](decisions/0018-two-notifications.md) sets a Sunday summary and an 18:00 review nudge.

Open: does the nudge skip Saturdays and Jewish holidays?

## File and backup retention

Open: are invoice photos and bank files kept for 7 years, or until the owner deletes them? Is backup retention of 30 days, and 12 monthly copies, acceptable?

## SUMIT history to backfill

Open: backfill the current tax year and the previous one, or the current year only?

## Accountant export shape

Open: does the accountant's export need a specific import format, or is generic Excel or CSV enough?

## More than one user

Already decided. [0013](decisions/0013-single-user-owner.md) is a single owner for this phase. The plan's question does not reopen that.
