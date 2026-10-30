<a id="flow-994"></a>
# FLOW-994 · Reports export: review follow-ups from #887 and #889
- **Type:** BACKLOG NIT · **Status:** ready · **Source:** the reviewer of #889 (r1), 2026-10-30.
- **Files:** `supabase/functions/flow-mcp/tools_export.ts` and `tools_export_test.ts`; `app/src/screens/report-share-sheet.tsx`.

- [ ] `tools_export.ts`: the project-list guard runs only when `get_dashboard` lists projects. Refuse an unknown id whenever ids are asked, and fix the test fixture whose `get_dashboard` lists none (the RPCs already refuse a foreign id, so nothing leaks).
- [ ] The share sheet at 320: a long project name in a project switch is cut to one line at its start. Owner's call: wrap it (the caption then needs room above the footer) or keep one line.
