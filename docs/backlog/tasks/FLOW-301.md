<a id="flow-301"></a>
# FLOW-301 · Income and expense drill-down from Home
- **Type:** PLAN FIRST · **Status:** done (#85, 2026-10-07; option A approved by the owner) · **Depends on:** —
- **What:** Tapping נכנס (income) or יצא (expenses) on Home opens every line of that kind for the selected period across all projects, grouped and totaled by category, project or payer, each line tappable to its detail. Same period selector as Home, amounts shown like the rest of the app, kept-out categories respected. MCP: a tool and RPC returning the aggregated lines (direction, period, group_by).
- **Plan:** [flow-301-drill-down.md](../../review/flow-301-drill-down.md). Owner approved option A (group totals, then a group's lines) on 2026-10-07. Server PR first (RPCs + MCP `get_breakdown`), then the screens.
- **Acceptance:** mockup approved; totals match Home for the same period; MCP test.
