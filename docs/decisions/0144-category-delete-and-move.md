# Delete a category with lines, and move all its lines

**Date:** 2026-10-08
**Status:** Accepted. Replaces [0008](0008-flat-categories-hide-or-merge.md)'s "delete only when the category has no transactions".

## Context

A new user sets up their own categories, and the seven defaults rarely fit. With [0008](0008-flat-categories-hide-or-merge.md) a category that had lines could only be hidden or merged, so a wrong category stayed in the books for good. The owner asked for delete with lines (the lines go back to review) and for a bulk "move all to another category" ([FLOW-405](../backlog/TASKS.md#flow-405)). The owner chose to build the server and MCP part first; the screen follows in a UI lane.

## Decision

1. **Delete** (`public.delete_category(category)`, owner only). The category goes even when it has lines.
   - Its lines keep their project and lose the category. They are marked as left with no category on purpose (`category_assigned`), so nothing guesses one for them.
   - Each line still on the books (not removed, not void) goes back to לאישור: an open review row with reason `missing_category`, unless it already has an open one.
   - A line split by category with a part in it loses its whole split, since the other parts no longer add up to the line.
   - Suppliers forget it as their remembered category, and earlier review and reassign undo rows stop pointing at it.
   - Refused for a loan category (`loan category is fixed`) and while a loan or a loan payment part uses it (`a loan uses this category`); the owner moves those first.
   - Returns the deletion id, the name and how many lines went back to review, for the confirm and the toast.
2. **Undo of a delete** (`public.restore_category(category)`, and MCP undo kind `category_delete`) puts back the category with the same id, its lines' categories and flags, the splits, the remembered suppliers and the references, and closes the review rows the delete opened that are still open or skipped. It is all or nothing: once one of those lines has a category or a split again, or the name is taken again, it is refused (`category cannot be restored`, MCP `conflict`) and changes nothing.
3. **Move all lines** (`public.move_category_lines(from, into)`, owner only) moves every line, split part, loan payment part, loan part category and remembered supplier category from one category to another of the same kind. Neither is hidden. A moved line counts as the owner's choice (`user_assigned`). Same refusals as merge: the same category, a hidden or missing target, another kind, a split line with parts in both, a loan part the target cannot take.
4. **Undo of a move** (`public.undo_category_move(move)`, and MCP undo kind `category_move`) moves back exactly what that move moved, with each line's old `user_assigned`. It is all or nothing: once any of them was moved or re-tagged since, it is refused (`category move cannot be undone`, MCP `conflict`). A remembered supplier category the owner changed since stays as it is.
5. **Merge** (`merge_category`) is now that move plus hiding the source, so it also moves loan payment parts and remembered supplier categories.
6. **MCP**: `delete_category` and `move_category_lines`, with the idempotency key, the write rate limit and undo.

## Alternatives rejected

- Refusing to delete while lines are tagged: the ask was the opposite.
- Moving a deleted category's lines to `אחר`: it would file costs under a wrong category without anyone choosing it. Untagged lines in review are honest.
- Keeping the parts of a split that are in other categories: the split would no longer add up to the line.
- An undo that restores whatever still fits: a half-restored category is harder to understand than a clear refusal.

## Consequences

Settings → Categories can offer delete with a count ("N lines will go back to review") and a ביטול toast through `restore_category`, and a "העברת כל התנועות" action through `move_category_lines` and `undo_category_move`. What a delete or a move changed is kept in `private.category_deletions` and `private.category_moves`. An older MCP write whose undo would put a deleted category back on a line (a categorize or a split) is refused at undo once that category is gone; restoring the category first makes it undoable again.
