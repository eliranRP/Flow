# Rename a category

**Date:** 2026-10-08
**Status:** Accepted.

## Context

The owner wants every category name in Hebrew. A category could be created, hidden, merged, moved and deleted ([0008](0008-flat-categories-hide-or-merge.md), [0144](0144-category-delete-and-move.md)), but not renamed. Merging into a new Hebrew category would work, but it changes ids, loses flags and the rehab switch, and leaves the old category hidden. The Flow MCP agent asked for a rename with undo.

## Decision

1. **`public.rename_category(category, name)`**, owner only. It uses create_category's name rules: the name is trimmed, 2 to 120 letters, and not another category's of the same kind. The id stays, so lines, split parts, loans, loan payment parts, remembered suppliers, the P&L switch, the rehab switch and the hidden state all stay as they are. It returns `id`, `name`, `before` and `after`.
2. **The loan categories can be renamed.** Everything finds them by `loan_part`, never by name.
3. **MCP `rename_category`** has the idempotency key, the write rate limit and undo kind `category_name`, with the category id. Undo puts the old name back. It is a conflict once the category was renamed again, or while another category of the kind has the old name.
4. **Defaults.** A new company's default categories are already all Hebrew (`private.seed_default_categories`), so nothing changes there.

## Consequences

- The connector import hints a category by name for two defaults: Mercury's own-account transfers go to `העברות`, and cashback to `הכנסה אחרת`. Once one of them is renamed, those lines get no hint and go to review with no category.
- Matching those hints by the default's role instead of its name is a separate change, for if it matters.
- Settings → Categories can offer a rename row. Undo there is the same call with `before`.
