<a id="flow-851"></a>
# FLOW-851 · The CSV report keeps every formula as text
- **Type:** SMALL CYCLE (infra) · **Status:** in-progress (#1166) · **Source:** the weekly security scan, 2026-11-14.
- **Files:** `supabase/functions/_shared/report_csv.ts` (`cell`), `supabase/functions/_shared/report_files_test.ts`, a changelog fragment.

- [x] A cell that starts with `=`, `+`, `-` or `@` after leading spaces (any Unicode space) gets the `'` prefix too, as a bare one already did.

**Acceptance:** a report name like ` =1+1` opens in a spreadsheet as text, not as a formula.
