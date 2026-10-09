# Sub-categories, project groups and starter categories

**Date:** 2026-10-09
**Status:** Accepted (plan). Nothing is built yet; the build follows in small server PRs, then the screens.

## Context

FLOW-406 asks for one level of sub-categories that roll up into a parent, project groups (for example a building holding its units), and starter categories by field in setup. Categories are flat ([0008](0008-flat-categories-hide-or-merge.md)); [0149](0149-project-category-months.md) added `categories.group_name`, a display-only fold whose totals stay per category. Projects have no group.

The owner chose (2026-10-09, one card with the design lead's mockups):

- **Data A, real parents and groups.** A sub-category points at a parent category, which can still take its own lines; today's group labels become parents; groups are their own table with a page to drill into. Option B (labels only) was not picked.
- **Screens: drill-in.** Settings → Categories, where a parent row opens its sub-categories (mockups cat-b, cat-b-2); the Projects tab, where a group is one summary row that opens its projects (proj-b, proj-b-2); the project picker grouped (picker); and the starter pick in setup (setup). The mockups are in the project's mockups/plan-first/flow-406/. Real-app screenshots go to the owner before the screens merge.

The nouns, agreed with the design lead: **תת-קטגוריה** under a plain **קטגוריה**, **קבוצה** for a project group, and **קטגוריות לפתיחה** for the starter pick.

## Decision

### Today

- Categories are flat (decision 0008). Decision 0149 added `categories.group_name`, a text label. Screens fold a group into one row, but every total stays per category, and nothing in the P&L knows about groups.
- Projects have no group or type. `company_pnl` returns `projects[]` and the MCP `list_projects` reads it.
- A new company gets one fixed list of categories from `private.seed_default_categories` (7 expense, 2 income, plus loan and transfer rows). Setup only links to Settings → Categories.

### Rules

1. **One level of sub-categories.** A sub-category has a parent, and a parent has no parent. A parent can still take its own lines.
   - A parent's figure is its own lines plus its sub-categories' lines.
   - The parent and its subs are the same kind (expense or income).
   - Off-P&L, rehab and loan-part flags stay per category. A sub-category can't be off-P&L under an on-P&L parent, or the other way round. Its flag follows the parent.
2. **Groups for projects, one level.** A project is in at most one group, and groups don't nest. A group's figure is the sum of its projects. A group has a name only, with no type field.
3. **Starter categories are seeded in setup only.** The owner picks one field from a short list, such as השכרת נכסים, שיפוצים ופליפים or כללי. The pick seeds editable categories and sub-categories, and nothing is seeded after setup.

### Schema

- `categories.parent_id uuid null`, a foreign key on (company_id, parent_id) → categories (company_id, id) with `on delete restrict`. Check `parent_id <> id`.
- A trigger enforces the rest:
  - the parent has no parent of its own;
  - a category that has children cannot get a parent;
  - the parent is the same kind;
  - the child follows the parent's off-P&L flag.
- Uniqueness stays (company_id, kind, name). Two sub-categories called "חשמל" under two parents is out of scope, and the screen says the name is taken.
- `project_groups (id, company_id, name, sort_order, created_at, updated_at)`, unique (company_id, name). Name rules match category names. RLS follows `projects`: the owner writes, viewers read.
- `projects.group_id uuid null` → project_groups (company_id, id), `on delete set null`.
- Starter sets live in one SQL function, `private.starter_categories(p_set text)`. It returns the rows (name, kind, parent name, off-P&L). `packages/shared/src/categories.ts` mirrors only the set keys and Hebrew labels for the setup screen, with a test that the two lists match.

#### What happens to `group_name`

`group_name` becomes the parent. The migration backfills each company:

- For each distinct group_name within a kind, it uses the category with that exact name if one exists, or creates a parent category with that name.
- It then sets `parent_id` on the group's members.

After that, `set_category_group` sets the parent, and MCP `set_category_group` keeps working as an alias. `group_name` stays one release for older app builds, is kept in step by the trigger, and is dropped in a later migration.

This is the one change existing data sees. A group label that becomes a real category shows up in the category picker. Before the backfill, a count of affected companies runs on production, read-only, and the number goes in the PR.

### How roll-ups read

- **company_pnl:** totals don't change, because every line is still counted once by its own category. It adds `groups[]` alongside `projects[]`: each group's id, name, income, direct, shared, profit and by_currency, summed from its projects' rows in the same query. A project row carries `group_id`. Projects with no group appear as today.
- **get_project:** the `categories` rows gain `parent_id`, plus one row per parent with `rollup: true` holding own lines plus children. Its children are listed under it, and a parent that has its own lines also gets an `own: true` row for them, which the parent page shows as "בלי תת-קטגוריה". Off-P&L parents and children stay in `excluded_categories_by_currency` the same way.
- **get_breakdown** `group_by=category` gains `level: 'parent' | 'category'` (default `'category'`, so nothing changes for today's callers). Home can ask for parents.
- **project_category_months:** the flags stay per category (a sub-category's expected cost is the useful one). A parent row with the summed months is added for folding.
- **list_categories:** returns `parent_id`, `children_count`, and the parent's summed `lines`. Hidden children are still listed with `hidden: true`.
- **search_transactions(p_category):** a parent id matches its own lines and its children's lines. A new `p_category_exact` keeps the old behaviour.
- **Line assignment:** a line can take a parent or a sub-category. Jev suggestions stay on the most specific category it saw.
- **New group RPCs:**
  - `get_project_group(id, basis, from, to)`: the group's totals and its projects, for the drill-in.
  - `upsert_project_group`, `delete_project_group` (its projects keep their lines and lose the group), and `set_project_group(project, group)`.
- **Starter set:** `apply_starter_categories(p_set)` runs only while the company has no transactions and no category beyond the default seed; otherwise it fails with `starter_locked`. It replaces the default seed with the set. Setup state (decision 0163) records the pick.

### MCP tools

- **Changed:**
  - `list_categories` returns `parent_id` and `children_count`.
  - `create_category` and `create_categories` take an optional `parent_id`.
  - `set_category_group` becomes `set_category_parent(category_id, parent_id | null)`. The old name stays as an alias for one release.
  - `get_breakdown` takes `level`.
  - `list_projects` and `get_totals` return `groups[]` and each project's `group_id`.
  - `get_project` returns the roll-up rows.
- **New:**
  - `list_project_groups`
  - `create_project_group(name)`
  - `set_project_group(project_id, group_id | null)`
  - `get_project_group(id, basis, from, to)`
  - All writes get the idempotency key, the write rate limit and undo kinds `category_parent` and `project_group`.
- **What the Flow MCP agent needs first:**
  1. `set_category_parent` and `create_categories` with `parent_id`, to tidy NRO Momentum's categories once the owner says how.
  2. `create_project_group` with `set_project_group`, to group the properties.
  3. The roll-up reads.
  - Starter sets are app-only.

### Order of PRs

1. Server: schema, trigger, backfill of `group_name`, roll-up reads, category MCP tools.
2. Server: project groups, `company_pnl.groups[]`, `get_project_group`, group MCP tools.
3. Server: starter sets and `apply_starter_categories`.
4. UI lanes: the screens from the approved mockups.

Each server PR gets pgTAP tests:

- one level only, and the kind and off-P&L rules;
- roll-up equals the sum of its parts;
- company totals unchanged before and after the backfill;
- tenant isolation on every new RPC.


A parent's own lines show on its page as a "בלי תת-קטגוריה" row, last in the list.

## Consequences

- 0008's flat list is amended: one level of sub-categories is allowed. Its reason, that a tree slows every review, is met by keeping the line picker flat with sub-categories under their parent and search across both.
- 0149's `group_name` is replaced by `parent_id` after one release.
- Company totals never change. Every line still counts once, by its own category and project. Roll-ups and groups are sums of those rows, computed in SQL (decision [0084](0084-jev-auto-prefill.md): every number comes from SQL).
