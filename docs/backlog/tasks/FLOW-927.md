<a id="flow-927"></a>
# FLOW-927 · Danger zone: the owner deletes the company and all of its data
- **Type:** Feature · **Status:** in-progress (#736) · **Depends on:** #735 (decision 0193) · **Source:** Owner request 2026-10-19: "a danger zone in the settings that lets the user remove all his data".
- **Files:** `supabase/migrations/20261019142844_delete_company_data.sql`, `supabase/migrations.lock`, `supabase/tests/database/delete_company.test.sql`, `supabase/tests/database/privilege_guards.test.sql`, `packages/shared/src/database.types.ts`, `app/src/screens/delete-company-sheet.tsx`, `app/src/screens/business-screen.tsx`, `app/src/ui/confirm-sheet.tsx`, `app/src/screens/settings-screen.stories.tsx`, `docs/decisions/0194-delete-company-danger-zone.md`, `docs/mcp/TOOLS.md`.
- [x] `delete_company(p_company_id, p_confirm)`: owner only, the typed name must match, deletes every row of the company and nothing of any other; the user stays (decision 0194).
- [x] pgTAP: refusals (wrong name, editor, viewer, outsider, another owner), a catalog sweep of every table with a `company_id`, the other company untouched, a new company afterwards.
- [x] The business page's owner-only אזור מסוכן section and its confirm sheet, with unit tests and a story.
