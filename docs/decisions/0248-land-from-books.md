# A property's land from the books

**Date:** 2026-11-02
**Status:** Accepted (owner, 2026-11-02: "Do we have this in the books categories already? If so let's add the number or suggest the user a transaction match to this field")
**Amends:** [0244](0244-property-returns.md)

## Context

The land is what depreciation leaves out: the building is the purchase plus the rehab minus the land. Until now the owner typed it per property. The owner's books already split each purchase into land and building: a closing is booked with a leg on a land asset account (for example "1 Property - land"), the leg's project naming the property, next to the building and land-improvement accounts.

## Decision

- The company names the land account once: `companies.land_account_id`, an asset account of the company (`set_land_account`, owner only; null unlinks; deleting the account unlinks it). MCP `set_land_account`, undo kind `land_account` with the company id, a conflict once it was changed again.
- `get_property_returns` takes the land in this order: the value typed on the property (`inputs.land_source: "typed"`), else the property's postings to the land account in the investment currency (`"books"`: posted, not removed, not draft, by the leg's own project when it names one, else the line's; `private.project_account_balance`). `inputs.land_account` names the account; `inputs.land_typed_minor` keeps the typed figure.
- With no account named, `inputs.land_suggestion` offers the asset account whose name says land (קרקע or land, and not improvements: שיפור, improve) with the largest positive balance on the property. Nothing is used until the owner taps it. The app shows it on the land row as one tap; a land from the books says "מהספרים" and opens the account's lines for the property.
- Nothing is guessed: with no typed value, no account and no suggestion, `land` stays missing as before.

## Consequences

- One tap fills the land of every property whose closing was booked; a property whose land was not booked keeps asking for it, and a typed value still overrides the books.
- The land is no longer only a typed number, so the depreciation and the tax savings follow the books when the owner corrects a closing entry.
