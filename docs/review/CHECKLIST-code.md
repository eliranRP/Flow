# Code checklist

Use this with [PITFALLS.md](PITFALLS.md) at the start of a cycle, and again before handoff.

- [ ] MCP-first ([0095](../decisions/0095-mcp-first.md)): every new feature or user action has a `flow-mcp` tool in this PR (writes: idempotency key, write rate limit, `undo`), listed in `docs/mcp/TOOLS.md`, plus an API where it can have one. Missing MCP support is Blocking.
- [ ] Tests were written first. Each new test failed once with the fix reverted.
- [ ] Every tool, argument value, and branch has a test. Write-only scope is refused. Cross-company access is refused. Shared mocks reset in `afterEach`.
- [ ] An unavailable feature is not listed. `flow-mcp` errors are JSON-RPC results with `isError`.
- [ ] Each script outcome has its own exit code, plus one code for incomplete. The table is in the pull request and the runbook. The script was run once per code, and the codes are pasted.
- [ ] No new helper duplicates `app/src/ui` or the existing edge caller.
- [ ] Docs have no token prefix and no token creation time. Logs and errors print no key material.
- [ ] Fail closed: a missing secret, a failed limit write, and an unknown state do not succeed.
- [ ] Deploy still needs green `lint`, `check`, and `e2e` on that commit, and the deploy job's actions stay pinned to a commit SHA.
- [ ] The gate was run on the whole repo: lint, typecheck, unit tests, Deno tests, `node --test scripts/*.test.mjs`, database tests, and the database types check.
- [ ] Handoff waited for green CI on the pushed head.
- [ ] Ambiguities are listed as "Decisions needed".
- [ ] An isolation test has a positive control. The owner still receives their own row.
- [ ] A fixture includes every nullable column the schema returns, including when the value is null. Omitting the column hides a null that production sends.
- [ ] Each script names the secret it reads and that secret's scope. A secret name is not reused for a different scope.
- [ ] A crash exit code is not a criterion exit code.
- [ ] Fixtures contain no real personal data, including the owner's email.
- [ ] A test does not depend on today's date and does not require a later day.
- [ ] A live verification names who ran it and how.
- [ ] Each self-check line cites a command, an exit code, or an artifact. A justification is not a line. A cited run has an artifact.
- [ ] A payload change lists every consumer (app, shared schemas, MCP, stories, demo data, e2e), and each one is updated or tested.
- [ ] A unit or currency change reaches every sum, header and export that adds the field.
- [ ] A SQL function another open pull request also redefines is patched from its current definition, and the landing order is agreed.
- [ ] The idempotency store keeps final outcomes only; a constraint, lock or transient refusal is not cached.
- [ ] No column that relaxes a security check is writable by the owner.
- [ ] Every auth path has a wrong-value test, and a restricted role is probed against every write path touched.
- [ ] E2e waits wait for a state, never a fixed timeout.
- [ ] A persisted flag is checked against the source of truth before it gates money or a write.
- [ ] Tests assert their own call or screen, not another feature's query.
- [ ] Renamed ops-visible objects are listed under "Ops changes" in the pull request.
- [ ] Database tests use the fixtures in `supabase/tests/helpers.sql` where they fit.
