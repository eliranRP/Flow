<a id="flow-116"></a>
# FLOW-116 · Overhead project follow-ups (#71 review)
- **Type:** BACKLOG NIT · **Status:** done (#116) · **Depends on:** —
- [x] `private.overhead_share` counts the overhead project's own income in the weights, so the overhead project gets a share of overhead. (#116: left out, share 0, the recommended answer; owner asked 2026-10-07 by card. Decision [0117](../../decisions/0117-overhead-project-weights.md).)
- [x] `undo` kind `overhead_project` after the prior overhead project was deleted is `refused` / `project not found`; `conflict` would match the other undo kinds. (#116)
- [ ] Cash-basis expenses count an unpaid supplier invoice by document date. Moved to [FLOW-128](FLOW-128.md).
