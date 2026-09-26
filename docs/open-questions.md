# Open questions

These are not decisions. When one is settled, add a numbered decision record, point the question at it, and update the [changelog](changelog.md).

Settled on 2026-09-26 and removed from this list: auto-approve ([0011](decisions/0011-auto-approve-high-confidence.md)), which bank comes first ([0012](decisions/0012-bank-hapoalim-first.md)), roles ([0013](decisions/0013-single-user-owner.md)), and whether budget is required ([0014](decisions/0014-optional-project-budget.md)).

## Settings screen

`הגדרות` is in the bottom navigation, and Categories is reached from Settings. The Settings screen itself is not wireframed.

Open: what else lives on Settings (company profile, VAT status, export, connected files)? Auto-approve is not a setting. It is the default, per [0011](decisions/0011-auto-approve-high-confidence.md).

## Per-screen specification

[screens.md](module-1-project-pnl/screens.md) describes each wireframe. It does not yet specify fields, validation, empty states, loading and error states, or edge cases. Each screen has a `Detailed spec: TODO` subsection for that pass. The auto-approve summary from [0011](decisions/0011-auto-approve-high-confidence.md) has no wireframe yet and belongs in that pass.

Open: write that pass. It is the next documentation step.

## Pricing

Pricing has not been discussed. Who uses the product in the proof of concept is decided: one user, the owner ([0013](decisions/0013-single-user-owner.md)).

Open: pricing.

## Credit-card statement support timing

[0012](decisions/0012-bank-hapoalim-first.md) keeps credit-card company files out of the proof of concept. Bank Hapoalim (`בנק הפועלים`) is the statement format the proof of concept imports.

Open: when, after the proof of concept, credit-card statement import starts.
