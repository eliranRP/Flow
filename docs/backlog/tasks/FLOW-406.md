<a id="flow-406"></a>
# FLOW-406 · Sub-categories and project groups
- **Type:** PLAN FIRST · **Status:** ready (owner picked drill-in, 2026-10-09; mockups in the project's mockups/plan-first/flow-406/: cat-b, cat-b-2, proj-b, proj-b-2, picker, setup; real-app shots to Eliran before merge) · **Depends on:** FLOW-405
- **What:** One level of sub-categories with a parent rollup; project groups; starter categories by field in setup. Plan: decision [0164](../../decisions/0164-sub-categories-and-groups.md) (data option A).
- **Acceptance:** each server PR has pgTAP for the one-level, kind and loan-part rules, roll-up = sum of parts, unchanged company totals across the `group_name` backfill, and tenant isolation; the screens match the approved mockups.
- [x] Plan and mockups approved (owner, 2026-10-09: data A, drill-in screens).
- [x] Server 1 (dev lane 2): `categories.parent_id`, the rule trigger, the `group_name` backfill, roll-up reads, category MCP tools.
  - [x] 1a (#354): `parent_id`, the rules, the `group_name` backfill and mirror, `set_category_parent`, refusals on a parent, `list_categories` fields, MCP `set_category_parent` and `parent_id` on the create tools.
  - [x] 1b (#363): roll-up reads: `get_project` `category_rollups*` and `parent_id`, `project_category_months` `parents[]`, `get_breakdown` by parent (MCP `level`), search parent match with `category_exact`.
- [x] Server 2 (#383): `project_groups`, `projects.group_id`, `company_pnl.groups[]`, `get_project_group`, the group RPCs, MCP `list_project_groups`, `get_project_group`, `create_project_group` and `set_project_group` with undo.
- [ ] Server 3 (dev lane 2): starter categories and `apply_starter_categories`.
- [ ] Screens (UI lane 3), after the server PRs.
  - [x] Settings → Categories drill-in (cat-b, cat-b-2), #378 (owner OK on the real-app shots, 2026-10-09).
  - [x] Project page: sub-categories fold under their parent (list_categories' parent_id), #378.
  - [ ] Project groups (proj-b, proj-b-2), the grouped picker and the starter pick, after servers 2 and 3.
