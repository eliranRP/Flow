<a id="flow-203"></a>
# FLOW-203 · get_project docs and list_projects basis echo (#66 review)
- **Type:** BACKLOG NIT · **Status:** done (#90) · **Depends on:** —
- [x] TOOLS.md: `get_project` is all-time (matches `list_projects` only without dates); `transactions[]` includes pending lines and shows shared lines at full amount; the Mercury both-bases note; `other_currencies` sub-fields with negative expenses.
- [x] `list_projects` should echo `basis`.
- [x] The `get_project` transaction sort needs an id tiebreaker (equal dates sort non-deterministically).
