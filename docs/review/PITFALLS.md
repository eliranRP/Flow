# Pitfalls

Read this file at the start of every cycle, then the [code checklist](CHECKLIST-code.md) and the [design checklist](CHECKLIST-design.md).

`/workspace/flow-tech/velocity-plan.md` is not in this repository. These notes are the section 7 rules that were used for the PR #6 review: the 12-point self-check, and the security and CI norms named with it.

## Self-check

1. Open the design sources for every screen you touch. Hints use `t-hint` and are tied with `aria-describedby`. Rows use the same `ListRow` icon pattern as the neighbouring rows.
2. Clip check: at 320, 360, and 390, light and dark, assert the text fits its own box, not only the page. The command is `pnpm build-storybook` then `pnpm clip-check`. A single-line ellipsis is the designed truncation for a title. A hint that wraps is still measured. The tint that sticks out of a row is not text.
3. Walk a changed row together with the states it sits beside. Never show a state you do not know. A failed load is an error with a retry, not an empty or disconnected row with an active action.
4. Run the repo gate before handoff: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `deno test --allow-env supabase/functions/flow-mcp`, `node --test scripts/*.test.mjs`, the database tests, and `pnpm db:types:check`. Hand off only when CI is green on the pushed head.
5. A script that reports several outcomes has one exit code per outcome, plus one code for incomplete. Run it once per code against the real response shape. Paste the codes.
6. For each new test, show it fail once with the fix reverted.
7. Every tool, argument value, and branch has a test. A write-only scope is refused. A cross-company read or write is refused. Shared mocks reset in `afterEach`.
8. An unavailable feature is not advertised. Errors from `flow-mcp` are JSON-RPC results with `isError`, not an HTTP 503 that hides the reason.
9. Put the exit-code table in the pull request and in the runbook.
10. Search `app/src/ui` and the existing edge helper before adding another. Do not copy a helper that already exists.
11. Docs do not contain token prefixes or token creation times.
12. List anything ambiguous as "Decisions needed" instead of guessing.

## Security and CI

- Fail closed. A missing secret, a failed rate-limit write, a bad token, and an unknown state stop the action. They do not fall through to success. Decision [0077](../decisions/0077-deploy-after-ci.md).
- CI before deploy. The deploy job needs `lint`, `check`, and `e2e` on that commit, and it does not migrate before the hosted bundle check. Those three job names stay stable.
- The deploy job pins its actions to a full commit SHA. Checkout does not persist credentials. A missing production secret exits 1 before the build.
- A read or write that takes an id has a cross-tenant test: another company gets nothing, and the call is refused.

## Design files for a screen

Open these before editing the screen:

- [design/system/implementation-guide.md](../../design/system/implementation-guide.md), including its section 12 checklists. Decision [0025](../decisions/0025-implementation-guide-is-mandatory.md).
- The screen's source under `design/src/`. Settings is `design/src/14-settings-light.html` and `design/src/14-settings-dark.html`. This repo has no `design/screens/14-settings-*.png`.
- [docs/design/DESIGN-RULES.md](../design/DESIGN-RULES.md).
- [docs/qa/CONTROLS.md](../qa/CONTROLS.md). A new control gets a row. The row is marked pass only after the test that exercises it.

## Traps already paid for

- An argument such as `scope` on `search_expenses` is not identity. Identity is `user_id`, `p_user`, `company_id`, `sub`, and `mcp_tid`.
- Reads need the signing key. Without it, `tools/list` is empty and `tools/call` is a tool error. Do not advertise the tools.
- A parse failure never prints any part of a key. A read error does not say the write was refused.
- Token shape is a warning. An empty token still fails the deploy.
- The signing spike reads the project ref from the environment. It does not embed one.
- A date test must not require a day after today.
