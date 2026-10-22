<a id="flow-949"></a>
# FLOW-949 · A normal cost and its gross-up contra credit on the same category and project
- **Type:** BUG · **Status:** in-progress (fix/gross-up-same-category, 2026-10-22) · **Source:** Owner report 2026-10-22: a payment line that needs a normal cost and a gross-up contra credit on the same category and project (decision [0207](../../decisions/0207-gross-up-contra-effect.md)'s own example) was refused, and `split_line` answered a bare `validation`. Follows FLOW-947.
- **Files:** `supabase/migrations/20261022130841_gross_up_same_category.sql` (new), `supabase/migrations.lock`, `supabase/tests/database/gross_up_same_category.test.sql` (new); `supabase/functions/flow-mcp/tools_split_schemas.ts` (new, split_line's part schemas moved out of `tools_schemas.ts`), `tools_schemas.ts`, `tools_args.ts`, `tools_write.ts`, `tools_gross_up_test.ts`; `app/src/line-split.ts`, `line-split-preview.ts`, `line-split.test.ts`, `app/src/screens/line-split-editor.tsx`; `docs/decisions/0207-gross-up-contra-effect.md`, `docs/decisions/README.md`, `docs/mcp/TOOLS.md`, `docs/changelog.d/2026-10-22-gross-up-same-category.md` (new).

**Server (one migration)**
- [x] `public.line_splits`: the unique key `(transaction_id, category_id, project_id)` becomes `(transaction_id, category_id, project_id, gross_up)`, nulls not distinct.
- [x] `save_line_split`: the duplicate pair key includes `gross_up`; a real duplicate is still `same category and project twice`.
- [x] `private.category_move` (merge and move): a line with a part in each category on one project is refused only when the two parts have the same `gross_up`.
- [x] `projects_cash_month`: a shared line's parts are grouped, and their cents settled, per part (category, project and signed amount), so two parts of one category no longer absorb each other's shares.

**MCP**
- [x] `split_line` (and `assign_expenses` parts rows) take one normal and one gross-up part per category and project; a refusal keeps `code`/`message` `validation` and adds `detail`, the rule that failed.

**App**
- [x] The parts editor's pair check (`pairKey`, `checkParts`, the picker notes, the sample preview) includes `grossUp`, so the editor can build the split.

**Acceptance:** pgTAP `gross_up_same_category` (the same-pair split saves, Taxes nets to a 601.29 credit, the P&L total equals the two-sided booking, cash equals invoiced, the projects' cash sums to the bank line, undo restores both ways, two normal or two gross-up parts on one pair are refused, the table refuses the duplicate row, merge keeps the two parts apart, a shared line's project cash sums to the line); the line_split, mcp_split, gross_up, merge, cash, breakdown and pinned speed pgTAP, `cross_company_sweep` and `privilege_guards` unchanged; Deno (same-pair accepted, `detail` on each refusal); app vitest (editor and sample preview accept the same pair, refuse two of one kind).
