# FLOW-406: sub-categories in Settings → Categories

- PR: #378
- Kind: new screen (plan-first, owner's drill-in mockups cat-b and cat-b-2)
- Changed: `categories-screen.tsx`: the list holds only top-level categories; a parent says "N תת-קטגוריות" with a chevron and opens `/settings/categories/:id`, which lists its sub-categories under the parent's name with its lines (its own and its sub-categories') as the subtitle, the same ⋯ sheet, and "הוספת תת-קטגוריה". A sub-category whose parent is hidden stays in the top list. Refusals on a parent (delete, merge, putting it in a group) have their own words. Stories: Categories "With parent" and "Parent page".
- Rule: One level of nesting, opened by drilling in, never by expanding rows in place. The parent row carries a count and a chevron; leaves keep their line count and ⋯.
- Source: FLOW-406, decision 0164 (owner picked drill-in, 2026-10-09)
