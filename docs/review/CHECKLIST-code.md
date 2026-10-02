# Code checklist

Use this with [PITFALLS.md](PITFALLS.md) at the start of a cycle, and again before handoff.

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
