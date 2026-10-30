<a id="flow-993"></a>
# FLOW-993 · The export sheet: columns by project or period, several projects, and Excel as xlsx
- **Type:** SMALL UI (design approved) · **Status:** done (#889) · **Depends on:** [FLOW-991](FLOW-991.md), [FLOW-992](FLOW-992.md) · **Source:** the owner, 2026-10-30, with FLOW-991. **Approved:** the owner, 2026-10-30. Design: [Reports export](https://claude.ai/artifact/Bhc1JVsCQYmdVXFGcb9PuU), section "גיליון הייצוא".
- **Files:** `app/src/report-share.ts`, `app/src/screens/report-share-sheet.tsx`, `app/src/screens/reports-screen.tsx` (passes the projects), `app/src/ui/css/61-reports.css` (`.ui-rep-share-projects`), their tests and story, `supabase/functions/flow-mcp/handler.ts` (the workbook as octet-stream) and `tools_export_test.ts`.

- [x] The sheet adds "עמודות לפי" (סה״כ, פרויקט, חודש, רבעון, שנה) and a projects picker (several projects; "כל הפרויקטים" by default), filled from the screen's choices.
- [x] "Excel" asks for `format: "xlsx"`; the app no longer asks for CSV.
- [x] A notice when a PDF would have more than 13 amount columns suggests quarters or Excel.
