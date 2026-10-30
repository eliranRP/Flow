<a id="flow-993"></a>
# FLOW-993 · The export sheet: columns by project or period, several projects, and Excel as xlsx
- **Type:** SMALL UI (design approved) · **Status:** claimed (dev lane, 2026-10-30, flow-993-export-sheet) · **Depends on:** [FLOW-991](FLOW-991.md), [FLOW-992](FLOW-992.md) · **Source:** the owner, 2026-10-30, with FLOW-991. **Approved:** the owner, 2026-10-30. Design: [Reports export](https://claude.ai/artifact/Bhc1JVsCQYmdVXFGcb9PuU), section "גיליון הייצוא".
- **Files:** `app/src/report-share.ts`, `app/src/screens/report-share-sheet.tsx` and their tests and story.

- [ ] The sheet adds "עמודות לפי" (סה״כ, פרויקט, חודש, רבעון, שנה) and a projects picker (several projects; "כל הפרויקטים" by default), filled from the screen's choices.
- [ ] "Excel" asks for `format: "xlsx"`; the app no longer asks for CSV.
- [ ] A notice when a PDF would have more than 13 amount columns suggests quarters or Excel.
