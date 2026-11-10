<a id="flow-474"></a>
# FLOW-474 · A property's utility months cover a bounded range
- **Type:** SMALL CYCLE (projects) · **Status:** in-progress (#1113) · **Source:** the daily security scan, 2026-11-10.
- **Files:** a new migration (`list_utility_months`), `supabase/tests/database/flow_1144_utility_months.test.sql`, `supabase/migrations.lock`, `supabase/functions/flow-mcp/tools_utility_refunds.ts` and its test (the MCP read answers validation), `docs/mcp/TOOLS.md`, a changelog fragment.

- [x] `list_utility_months` takes an as-of date up to a year after today, and lists at most the 600 months (50 years) up to it.
- [x] pgTAP: an as-of date more than a year ahead is refused; a property's months stop 600 months back; the owner's own months read as before.

**Acceptance:** the tests pass; a property's real months read the same.
