# Kept-out toggle on the categories screen

**Date:** 2026-10-07
**Status:** Accepted

## Context

[0099](0099-categories-outside-pnl.md) added `categories.excluded_from_pnl`, the owner-only `set_category_excluded_from_pnl`, and MCP `set_category_pnl`, and it deferred the screen. Owners could not see or change the flag in the app. FLOW-113 was plan-first. The owner reviewed three options on 2026-10-07 and chose option A.

## Decision

- **Mark.** A kept-out category shows a ⊘ icon right after its name, in `--color-text-muted`, with `role="img"` and the label "מחוץ לרווח והפסד". The name keeps `--color-text`, so a kept-out row is not confused with a hidden (muted) one. The mark shows in the hidden list too, and to viewers. A legend line under the list explains ⊘ when the current segment has a kept-out row.
- **Action.** The row's עוד sheet gets a third secondary button after הסתרה and מיזוג: "מחוץ לרווח והפסד", or "החזרה לרווח והפסד" on a kept-out category. A hint line under it says what happens.
- **Save on tap.** There is no confirm sheet. [0030](0030-confirmation-sheets.md) asks for one only on delete, archive, hide and merge, and this change is undone with one tap. On success the sheet closes, focus returns to the row's עוד, and the toast "<name> · מחוץ לרווח והפסד" (or "· ברווח והפסד") offers ביטול for 5s. ביטול sends the opposite value.
- **Loan categories.** ריבית משכנתא, מסים וביטוח and תשלומי הלוואה get a locked line instead of the button, because the server refuses them. Until FLOW-112 moves the loan categories to a stable key, the screen matches them by the same Hebrew names as the server.

## Alternatives rejected

- A separate collapsible "מחוץ לרווח והפסד" group. It adds a second group next to מוסתרות, has no clear home for a category that is both hidden and kept out, and rows jump on toggle.
- A switch on every row. It is crowded at 320px, nine switches add noise for a setting that rarely changes, and a stray tap changes every total.

## Consequences

`CategoryLine` passes the opener to `onMenu`, and the row sheet uses it as `returnFocusRef`. No migration and no MCP change.
