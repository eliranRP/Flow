<a id="flow-412"></a>
# FLOW-412 · Category drill-down on the cash basis
- **Type:** BACKLOG NIT · **Status:** in-progress (#163) · **Depends on:** —
- [x] `list_project_category` has no basis, so on cash its `total_agorot` and rows include unpaid supplier invoices that the `get_project` category row leaves out (0118). Add `p_basis` and the `line_unpaid` filter, as `get_project` does. From the #154 review. (#163: `p_basis`, default invoiced; the app passes its basis.)
