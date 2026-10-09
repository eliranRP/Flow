<a id="flow-133"></a>
# FLOW-133 · Batch undo by write id; split undo keeps percent and rest (#145 review)
- **Type:** BACKLOG NIT · **Status:** done (#155) · **Depends on:** FLOW-312 (#145)
- [x] `undo_batch` undoes a `line_split` (an `assign_expenses` `parts[]` row) or `line_pnl` (`set_lines_pnl`) row through `mcp_undo(kind, transaction_id)`, which picks the newest live write on that line, not the batch's own. A later `split_line` / `set_line_pnl` on the same line is undone instead and the row reads ok. Return the `private.mcp_writes` id from `mcp_split_line` and `mcp_set_line_pnl`, store it in `row_writes`, and make the batch row `conflict` when a newer live write of that kind exists on the line.
- [x] `mcp_undo('line_split')` and `private.line_split_parts` drop `percent` and `is_rest` (added in `20261008140000`), so an undone split comes back without its percent and rest markers.
- [x] An `assign_expenses` `parts[]` row returns no stored parts; consider returning the cents as `split_line` does.
- [x] From the #155 review: no dblink test for `undo_batch` and `undo` on the same line at once (the lock order), and none for a newer `split_line` on the line by another user or token. (`flow_133_undo_race.test.sql`: both orders wait and end in `not_found` without a deadlock; another token's uncommitted split makes `undo_batch` wait, then `conflict`.)
