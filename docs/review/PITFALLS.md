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

## Findings

Catch these before handoff. The matching lines are in the two checklists.

1. An isolation test has a positive control. Showing that another company gets nothing is not enough. The same test shows that the owner still receives their own row.
2. A fixture includes the nullable fields the schema returns. Skipping a nullable column hides a null that production sends.
3. A script writes the secret name and the scope of that secret. A name is not reused for a different scope.
4. A crash has its own exit code. It does not reuse a criterion's code.
5. `aria-label` and `aria-labelledby` do not name a generic element. The accessible name belongs to the control.
6. A prop that only a story passes is not added to a production component.
7. Fixtures and stories do not contain real personal data. The owner's email is personal data.
8. A test does not depend on today's date. It does not require a day after today, and it does not freeze a calendar day that will fail next month.
9. A live verification records who ran it and how. A conclusion with no person and no method is not a record.
10. A self-check line is evidence: the command, the exit code, or the artifact. A justification is not a line. A cited run has an artifact.
11. Replacing an `<input>` with inline text inside a vaul sheet inherits `user-select: none`. Probe `getSelection()` on a desktop fine pointer, not only on touch.
12. A drag-to-dismiss sheet can read a fast selection drag as a dismiss. Probe a quick diagonal mouse drag over selectable or shown-once content.
13. The clip test is horizontal only. Zero overflow is not evidence for a copy, select, or gesture flow.
14. A `min-block-size` step-jump fix is re-sampled at 320, where the content wraps.
15. A button label uses the action name from `ErrorState` and the toasts ("ניסיון חוזר"), not a sentence.
16. An owner call that is in the code and missing from the decision's state table is spec drift.

## Decided, and not yet applied

The next pull request that touches the file applies these. They are not part of PR #6.

- Q-1. The signing spike and the CI runbook read Auth config with `SUPABASE_AUTH_READ_TOKEN`. They do not use `SUPABASE_ACCESS_TOKEN` for that read.
- Q-2. An unknown `?assistant=` preview value shows the error state.
