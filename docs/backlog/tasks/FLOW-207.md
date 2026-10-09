<a id="flow-207"></a>
# FLOW-207 · sync_bank job follow-ups (#75 review)
- **Type:** BACKLOG NIT · **Status:** done (#156) · **Depends on:** —
- [x] `mcp_sync_bank_finish` accepts any 1–200 character failure message for a known code; allow-list the fixed strings the edge sends, like `mcp_refused`. (Only the fixed pairs `pullBank` sends.)
- [x] `private.mcp_sync_jobs` has no retention; add a cleanup for finished jobs. (`mcp_sync_bank_begin` drops the user's jobs finished over 7 days ago, or running over a day.)
- [x] A handler-level test that `get_sync_status` takes the read rate bucket and that a write-only token can call it through `handle()`.
- [x] Deploy order: between the migration and the edge deploy, a pull's result is lost (the job reads retry after 5 minutes) or `sync_bank` is refused. Note it in the deploy steps.
