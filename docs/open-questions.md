# Open questions

These are not decisions. When one is settled, add a numbered decision record, point the question at it, and update the [changelog](changelog.md).

## Auto-approve high-confidence items

A matched invoice or a learned supplier rule is high confidence. Those items are pre-approved and can be cleared together with "Approve all". An auto-approve setting would let them count without that tap.

Open: is auto-approve on by default, or off until the owner opts in?

## Which Israeli bank statements come first

Statement upload accepts Excel and CSV. The upload wireframe uses a Leumi file name as example data only.

Open: which banks' export formats does the proof of concept parse first?

## Settings screen

`הגדרות` is in the bottom navigation, and Categories is reached from Settings. The Settings screen itself is not wireframed.

Open: what else lives on Settings (company profile, VAT status, export, the auto-approve switch, connected files)?

## Per-screen specification

[screens.md](module-1-project-pnl/screens.md) describes each wireframe. It does not yet specify fields, validation, empty states, loading and error states, or edge cases. Each screen has a `Detailed spec: TODO` subsection for that pass.

Open: write that pass. It is the next documentation step.

## Budget versus actual

A project may have a budget. The create sheet labels it optional, and the project screen shows expenses against budget only when a budget exists.

Open: does the proof of concept require budget versus actual, or does budget stay optional?

## Pricing and roles

The person in the wireframes is the owner. An office manager who reviews the queue during the day has not been defined, and neither has pricing.

Open: pricing, and whether owner and office manager are different roles.
