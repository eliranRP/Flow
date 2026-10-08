# Project costs by category, month by month, and category groups

**Date:** 2026-10-08
**Status:** Accepted.

## Context

FLOW-401 asks for a project view by category that shows what each category usually costs and whether this month looks off. `get_project` already lists a project's costs by category for any period ([0129](0129-profit-by-month.md), [0141](0141-period-bar.md)), and Jev phase 1 finds recurring suppliers and missing bills company-wide ([0131](0131-jev-patterns.md)). Nothing compares a project's category with its own past months. Categories are flat ([0008](0008-flat-categories-hide-or-merge.md)), so small ones such as electricity, water and gas can't be folded together. The owner chose expected amounts, flags and groups.

## Decision

1. **`public.project_category_months(project, months = 6, today)`**, for the owner or a viewer. For each expense category and currency of the project it returns this month so far, each of the last 3 to 12 complete months, `months_seen`, `expected_minor` and a `flag`.
   - It counts what `get_project` counts: approved lines, split parts and the project's share of shared lines, in the P&L only.
   - A month follows the document date (the invoiced basis, as the missing bills do), in Israel time.
   - `expected_minor` is the median of the complete months that have a cost. It is set only when at least 3 of them have one.
   - `flag` is `high` (above 1.5 × expected and at least ₪200, or 50 in another currency, above it), `new` (a cost now after none, of at least ₪500 or 150) or `missing` (expected is set, today is past the category's median day and nothing came yet).
   - The thresholds live in one function, `private.category_flag`, so changing one is a one-line migration.
   - The numbers and flags come from plain SQL; Jev only words them.
2. **`categories.group_name`**, an optional group (trimmed, 1 to 40 letters). The owner sets it with `public.set_category_group`; null or blank clears it. A screen folds a group's categories into one row. The P&L, reports and every total stay per category. `list_categories` and `project_category_months` return it.
3. **MCP:**
   - `get_project_categories(id, months)` is a read tool.
   - `set_category_group` has the idempotency key, the write rate limit and undo kind `category_group`. Undo is a conflict once the group was changed again.

## Consequences

- The project screen (a UI lane, from a mockup) can list categories with their lines, folded by group, with a flag chip on a row that looks off.
- FLOW-403 (expected future months for a project) can build on the same function.
- The flags use the invoiced basis, so a bill counts in the month of its document even when it is paid later.
