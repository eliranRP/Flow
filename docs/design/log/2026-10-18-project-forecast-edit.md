# Project forecast: edit, add and remove rows (ProfitNext*)

- PR: (not opened yet)
- Kind: screen
- Changed: `app/src/screens/project-next-month-screen.tsx` (rows open their edit page, הוספת קטגוריה לצפי, הוסרו מהצפי with החזרה, חזרה לצפי של Flow, the new note), `app/src/screens/project-next-edit-screen.tsx` (new: the edit and add page), `app/src/screens/project-next-category-sheet.tsx` (new: the category sheet), `app/src/ui/forecast-edit-parts.tsx` and `app/src/ui/css/50-forecast-edit.css` (new: the amount field and the history bars), `app/src/ui/css/45-project-profit.css` (the edited hint, the add row, the removed rows), `app/src/screens/project-next-month-card.tsx` (the basis line).
- Rule: A forecast row's edit page is a pill (tint, 8px radius), a 24px title, a 40px amount field with a pencil and an accent underline, a meta line, then surface cards of 60px icon rows; the history is five 6-column bars and a dashed accent bar for the forecast month. A changed or added forecast row writes its hint in the accent text colour.
- Source: board Profit.dc.html, presets next, nextedit, nextadd, nextedited, nextsearch, nextnone and nextpace.
