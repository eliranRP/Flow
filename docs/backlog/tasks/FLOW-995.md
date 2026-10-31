<a id="flow-995"></a>
# FLOW-995 · Reports export: review follow-ups from #887 and #889
- **Type:** BACKLOG NIT · **Status:** in-progress · **Source:** the reviewer of #889 (r1), 2026-10-30. **Decided:** the owner left the call to the agent (2026-10-31): one line, cut at the name's end.
- **Files:** `supabase/functions/flow-mcp/tools_export.ts` and `tools_export_test.ts`; `app/src/ui/css/61-reports.css` (`.ui-rep-share-projects .ui-switch-label`).

- [x] `tools_export.ts`: the project-list guard runs only when `get_dashboard` lists projects. Refuse an unknown id whenever ids are asked, and fix the test fixture whose `get_dashboard` lists none (the RPCs already refuse a foreign id, so nothing leaks).
- [x] The share sheet at 320: a long project name in a project switch was cut at its start. It stays on one line (wrapping pushed the caption under the footer) and keeps its own direction (`unicode-bidi: plaintext`), so a Latin name is cut at its end; a Hebrew one is unchanged.
