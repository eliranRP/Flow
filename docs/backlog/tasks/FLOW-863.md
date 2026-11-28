<a id="flow-863"></a>
# FLOW-863 · The closed-books lock covers a category's rehab flag
- **Type:** SMALL CYCLE (infra) · **Status:** in-progress · **Source:** the weekly security scan, 2026-11-28; the owner's choice the same day.
- **Files:** `supabase/migrations/20261128101500_flow_863_rehab_books_closed.sql` (`private.books_closed_setting_guard`, the trigger `categories_lock_closed_month`), `supabase/migrations.lock`, `supabase/tests/database/books_closed_rehab.test.sql`, `supabase/functions/flow-mcp/tools_specs.ts` (the `set_category_rehab` description), `supabase/functions/flow-mcp/tools_books_closed_settings_test.ts`, `docs/mcp/TOOLS.md`, `docs/tech/state-machines.md`, a changelog fragment.

- [x] A person's change of `categories.rehab` that turns the rehab of a closed line's part, as `private.project_investment` counts it (a posted, paid expense part on a project or shared to one by an allocation), is refused with the other settings' words: `the books are closed through YYYY-MM-DD: this setting changes them`.
- [x] `mcp_set_category_rehab` and the `category_rehab` undo answer `refused` with the same words; the service role and a company with no closed date pass.
- [x] `categories_lock_closed_month` also fires on `rehab`, under the same name and timing.

**Acceptance:** `books_closed_rehab.test.sql` passes: allowed with no closed date, when no line the change reaches is closed, and when no closed line's rehab turns; refused with the exact message when one does, through the app and flow-mcp, the undo too; the service role allowed; company A's date never affects company B.
