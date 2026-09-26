# Open questions

These are not decisions. When one is settled, add a numbered decision record, point the question at it, and update the [changelog](changelog.md).

Settled earlier and removed from this list: auto-approve ([0011](decisions/0011-auto-approve-high-confidence.md)), which bank comes first ([0012](decisions/0012-bank-hapoalim-first.md)), roles ([0013](decisions/0013-single-user-owner.md)), and whether budget is required ([0014](decisions/0014-optional-project-budget.md)). The per-screen spec is written; it is no longer an open item.

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
