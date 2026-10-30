<a id="flow-996"></a>
# FLOW-996 · The P&L by project as a PDF fails on a real company: out of the edge function's CPU time
- **Type:** BUG (high priority) · **Status:** in-progress · **Source:** the owner, 2026-10-30: the export sheet said "הקובץ לא נוצר" for P&L and balance sheet, all time, columns by project, PDF.
- **Files:** `supabase/functions/_shared/report_pdf.ts` (`runWidth`), `supabase/functions/_shared/report_grid.ts` (`generalLabel`), `supabase/functions/flow-mcp/tools_export.ts`, `supabase/functions/_shared/report_files_test.ts`, a changelog fragment.

Cause: the PDF measured the width of every amount and name with the font engine each time it drew or tried a size, and the grid tries up to six sizes and shortens long names a letter at a time. A real company's by-project P&L (34 rows, 9 columns) took over 2 s of CPU, over the edge function's limit (`WORKER_RESOURCE_LIMIT`).

- [x] Each run of text is measured once per font at size 1 and scaled; the same file in about 0.4 s.
- [x] A company whose overhead project is itself called "כללי" got two columns of that name; the column for lines with no project is then "בלי פרויקט".

**Acceptance:** a test that counts the font measurements for a wide grid (it fails without the fix); `export_report` by project as a PDF on the owner's company, read-only, after the deploy.
