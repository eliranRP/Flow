<a id="flow-150"></a>
# FLOW-150 · Move a shared line back to one project
- **Type:** MCP + DB · **Status:** claimed (dev lane 2, 2026-10-27, flow-150-unshare-line) · **Depends on:** — · **Source:** the MCP/data agent, 2026-10-27: a property manager's fee was shared 50/50 between two properties; from a date the manager runs one of them only, so that year's payments go 100% to it while last year's stay shared. There is no per-line way: `assign_expense` refuses a shared line, `assign_expense_split` refuses one 100% share, `split_line` refuses a part that takes the whole line, and `reassign_recurring_charge` moves every payment of the charge.
- **Files:** one migration in `supabase/migrations/`, `supabase/migrations.lock`, `supabase/tests/database/unshare_line.test.sql` and the registries other pgTAP files keep, `supabase/functions/flow-mcp/` (the assign schemas, specs and tests), `docs/mcp/TOOLS.md`, an e2e spec, `packages/shared/src/database.types.ts`, a decision.

- [ ] `assign_expense` takes `unshare: true`: a shared line's shares go, and the whole line goes to the one project, under the line's category unless a new one is given. Other lines of the same charge are untouched. Undo (`reassign`) puts the shares back.
- [ ] `assign_expenses` takes `unshare` per row, so several lines move in one call with one `undo_batch`.

**Acceptance:** pgTAP: a 50/50 line moves 100% to one project and the project P&Ls move by half the line each way, another shared line of the same supplier stays shared, the category stays, undo restores the shares; Deno tests for the argument; an e2e on the project profit.
