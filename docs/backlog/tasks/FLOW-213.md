<a id="flow-213"></a>
# FLOW-213 · match_lines: reconcile an outside ledger export in one read
- **Type:** MCP · **Status:** done (#422) · **Depends on:** —
- **Source:** the Flow MCP agent's request, 2026-10-09. Reconciling an outside ledger export against Flow takes one `search_expenses` call per row today.
- **What:** A read-only MCP tool `match_lines` on a new RPC. It takes `rows` (each a `date`, an `amount_minor` and an optional `ref`), `window_days` (default 5), an optional `direction` and an optional `currency`. For each row it returns the Flow lines of the same amount within the window, matched on either the document date or the payment date, closest first. Each row is paired with at most one line and each line with at most one row, closest dates first. It also returns the rows left unmatched and the Flow lines in the rows' date range that no row claimed. All matching is in SQL (decision 0084). No UI.
