<a id="flow-209"></a>
# FLOW-209 · get_project follow-ups (#90 review)
- **Type:** BACKLOG NIT · **Status:** done (#126) · **Depends on:** —
- [x] `transactions[]` rows carry no `line_status`, so a pending row looks the same as a posted one. Add it. (#126)
- [x] `other_currencies` leaves out a shared line whose own `project_id` is this project (`l.project_id is distinct from p.id`), while `by_currency` and `shared_agorot` count it. Check whether any write path stores such rows, then align or document. (#126: no write path stores one, since the app and MCP splits clear `project_id`; aligned anyway.)
