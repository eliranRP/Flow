<a id="flow-839"></a>
# FLOW-839 · A daily and weekly security scan agent
- **Type:** SMALL CYCLE (docs) · **Status:** in-progress (flow-839-security-scan) · **Source:** the owner, 2026-11-01: a daily agent on the new code in the day's diff, a full repo scan once a week, to find security flaws; stage 1 known attacks (a list of them), stage 2 the patterns of past zero-days, and fix what it finds.
- **Files:** `docs/runbooks/security-scan.md` (new), `docs/security/known-attacks.md` (new), `docs/security/zero-day-patterns.md` (new), `docs/backlog/README.md` (the lanes table), a changelog fragment.

- [x] The runbook: the daily and weekly scope, the two stages, triage, the fix cycle, disclosure rules for a public repo, the report.
- [x] Stage 1: the known attacks checklist, written for this stack (RLS and definer functions, edge functions, MCP, headers, CI).
- [x] Stage 2: past zero-days, each boiled down to a pattern, where it could live in Flow, and how to hunt for it.
- [x] Two scheduled tasks that fire into one security session: daily Sunday to Friday 04:37, weekly Saturday 02:23 (Israel time). They live outside the repo.

**Acceptance:** the first daily run reports its scope, both stages, and any fix PRs; nothing about an unfixed flaw reaches the repo.
