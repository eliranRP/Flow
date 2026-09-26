# Open questions

These are not decisions. When one is settled, add a numbered decision record, point the question at it, and update the [changelog](changelog.md).

Settled earlier and removed from this list: auto-approve ([0011](decisions/0011-auto-approve-high-confidence.md)), which bank comes first ([0012](decisions/0012-bank-hapoalim-first.md)), roles ([0013](decisions/0013-single-user-owner.md)), and whether budget is required ([0014](decisions/0014-optional-project-budget.md)). Also settled, with leftovers called out below: the installable phone web app ([0015](decisions/0015-installable-mobile-web-app.md)), Hebrew only ([0016](decisions/0016-hebrew-only.md)), SMS sign-in ([0017](decisions/0017-sms-sign-in.md)), the two notifications ([0018](decisions/0018-two-notifications.md)), Home periods ([0019](decisions/0019-home-periods-and-comparison.md)), and phone capture ([0020](decisions/0020-capture-from-the-phone.md)). The per-screen spec for the eight approved screens is written.

## Settings screen

A proposal is in [settings.md](module-1-project-pnl/settings.md). **Status: Draft. Not approved.**

The draft includes company details, VAT status, a VAT rate, categories, a rules list with edit and delete, an accountant Excel export, Bank Hapoalim account numbers, and an auto-approve toggle.

Open until the draft is accepted or replaced:

- Whether this set of sections is what ships.
- The VAT-status enum (`עוסק מורשה`, `עוסק פטור`, `חברה`) and the 18% default rate.
- Whether Home's `☰` opens this screen.
- The auto-approve toggle. [0011](decisions/0011-auto-approve-high-confidence.md) auto-approves by default and rejected an opt-in switch. The draft draws the toggle and says not to build it unless a new decision supersedes 0011.

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

[0017](decisions/0017-sms-sign-in.md) makes the mobile number the account. Signing in on a new phone with the same number is specified. Replacing that number is not.

Open: what the owner does when the phone number changes.

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

The first-run onboarding wireframe will include a step where Flow proposes projects from recurring clients and the owner confirms them. No rule defines "recurring," and no decision says what confirming a proposal creates.

Open: what counts as a recurring client, and what confirming a proposal writes.
