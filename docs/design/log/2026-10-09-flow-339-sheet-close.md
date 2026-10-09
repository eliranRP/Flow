# FLOW-339: the + sheet closes with ✕ only, and ✕ sits on the title's line

- PR: #292
- Kind: component
- Changed: the shared sheet head (`.ui-sheet-head`, app/src/ui/css/08-tabbar-empty.css) centers its items, so the 44px ✕ button lines up with the title's line instead of sitting about 7px under it. This applies to every sheet. The + tab's sheet (`AddForm`) drops its ghost "ביטול" button, so ✕, Escape and Back close it. The ReviewCard "Jev filled" stories (light, dark, 320) now check that בטל's hit area never reaches the category row above it. That cycle 6 finding did not reproduce: the area grows down only.
- Rule: A sheet that only lists actions closes with ✕, the way every sheet does. "ביטול" belongs on confirm sheets, where it answers the question.
- Source: FLOW-339 (UI/UX review cycle 6, C6-3 and the + sheet)
