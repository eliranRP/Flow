<a id="flow-204"></a>
# FLOW-204 · assign_expense_split follow-ups (#68 review)
- **Type:** BACKLOG NIT · **Status:** done (#88) · **Depends on:** —
- [x] Undo turns a suggested category into a confirmed one (the existing undo functions do this too).
- [x] `closed_review` is reported false when the split closes an `unallocated_shared` review.
- [x] No `lock_timeout` in the migration.
- [x] Reordering the shares counts as different arguments for idempotency.
- [x] No SQL cap on the number of shares.
- [x] Hidden categories and finished projects are accepted.
- [x] Zod `int` / `min` / `strict` cases are untested.
- [x] The cross-tenant code is `refused`, not `not_found` (matches `assign_expense`; decide once for all tools).
- [x] The PR description of #68 is stale; fix it for the record.
