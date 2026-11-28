<a id="flow-859"></a>
# FLOW-859 · Undoing a recurring switch puts back the end date it cleared
- **Type:** BUG (low; a correctness gap after FLOW-1266) · **Status:** in-progress · **Source:** a follow-up of FLOW-1266's end date.
- **Files:** `supabase/migrations/20261128003858_flow_859_recurring_undo_end_date.sql` (patches `public.set_payment_recurring`, `public.mcp_set_line_recurring` and the `line_recurring` branch of `public.mcp_undo` in place), `supabase/tests/database/flow_1266_recurring_end_date.test.sql`, `docs/mcp/TOOLS.md` (set_line_end_date), a changelog fragment.

Marking a charge recurring clears an end date that has passed (FLOW-1266), so the charge comes back. The MCP undo of that write (kind `line_recurring`) put back only the switch, so an ended charge came back active with no end date.

- [x] `set_payment_recurring` returns `prior_ends_on`: the end date the write cleared, or null.
- [x] `mcp_set_line_recurring` keeps it in its undo record (`ends_on_before`); its answer is unchanged.
- [x] `mcp_undo` (`line_recurring`) puts the cleared end date back after the switch, unless the charge has an end date again (set after the write: the owner's newer word stays). A record from before the fix undoes as before.
- [x] Access cases for `set_payment_end` and `mcp_set_line_end_date`: a viewer, another company's line and another company's project are refused.

The app's undo (`pace-write.ts`, `transaction-recurring.tsx`) needs no change: it marks the charge recurring only when it shows as not recurring, and its undo writes the switch back to false, so the charge is not expected whatever its end date.

**Acceptance:** a charge with a passed end date, marked recurring through the MCP and undone, is ended again with the same end date; the FLOW-1266 pgTAP file passes.
