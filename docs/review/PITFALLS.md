# Pitfalls

Read this file at the start of every cycle, then the [code checklist](CHECKLIST-code.md) and the [design checklist](CHECKLIST-design.md).

These notes are the section 7 rules used for the PR #6 review: the 12-point self-check, and the security and CI norms named with it.

## Self-check

1. Open the design sources for every screen you touch. Hints use `t-hint` and are tied with `aria-describedby`. Rows use the same `ListRow` icon pattern as the neighbouring rows.
2. Clip check: at 320, 360, and 390, light and dark, assert the text fits its own box, not only the page. The command is `pnpm build-storybook` then `pnpm clip-check`. An inline element's box is as wide as its text and never clips, so measure the nearest ancestor that is not `display: inline` or `display: contents`, once per container. An inline `<bdi>` is not the box. The ellipsis exemption is `.ui-row-title` and `[data-clip-ok]`. A single-line `.ui-row-hint` is measured. A hint that wraps is still measured. Text hidden from sight is not measured, down to its nested blocks: `.sr-only`, `.visually-hidden`, a zero `clip` rect, a 50% `clip-path` inset, or a box of about 1px. Each block measures only its own text, so a clipped nested block is one line. Every story sees the same frozen date, and a story that does not render gets one more load. A story tagged `clip-no-text` is measured too; only measuring nothing is waived for it. `parameters.clipCheck.noText` is not read. Any other story that measures nothing exits 2. The tint that sticks out of a row is not text. Zero overflow is not evidence for copy, select, or gesture. The full list is `clip-report.json` and `clip-report.txt` at the repo root. Stdout keeps the first 40 clips.
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
- No provider-name literal outside `supabase/functions/_shared/connectors/<provider>/`, the registry module, and migrations. `connectors/types.ts` is not that list. The core calls the registry. It does not branch on the provider name.
- Logs and errors never print a secret, a token, ciphertext, a nonce, an account number, or a routing number. `redact()` runs before any log of a provider payload.

## Design files for a screen

Open these before editing the screen:

- [design/system/implementation-guide.md](../../design/system/implementation-guide.md), including its section 12 checklists. Decision [0025](../decisions/0025-implementation-guide-is-mandatory.md).
- The screen's source under `design/src/`. Settings is `design/src/14-settings-light.html` and `design/src/14-settings-dark.html`. This repo has no `design/screens/14-settings-*.png`.
- [docs/design/DESIGN-RULES.md](../design/DESIGN-RULES.md).
- [docs/qa/CONTROLS.md](../qa/CONTROLS.md). A new control gets a row. The row is marked pass only after the test that exercises it.

## PR #6 lessons

PR #6 is on main. These lessons apply.

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
17. An inline element's box is as wide as its text and never clips. Measure the nearest block ancestor, the one whose `display` is not `inline` or `contents`, once per container. A `<bdi>` inside a hint, mixed text, or a display amount is not the clipping box.
18. Focus and blur hooks need a browser-mode test, because jsdom doesn't fire blur on removal.

19. A contract change lists its consumers. Before changing a payload, list every reader of it (app screens, `packages/shared` schemas, MCP tools, stories, demo data, e2e) and update or test each one in the same pull request.
20. A unit or currency change reaches every sum. Grep every total, header and export that adds the changed field, and test one of each.
21. Two open pull requests that redefine the same SQL function agree the order up front. The later one patches the current definition (`pg_get_functiondef` with counted anchors) instead of copying an old one, and says which pull request it lands after.
22. An idempotency store keeps only final outcomes. A constraint error, a lock timeout or another transient refusal is not stored, so a retry with the same key can succeed.
23. A column that relaxes a security check (an allow flag, a role, a trusted source) is never writable by the owner, through RLS or any owner-callable write. Only a server path with its own check sets it.
24. Every auth path gets a wrong-value test: a wrong token, a wrong company claim, a wrong scope, an expired key. A test that only sends no credential is not enough.
25. Probe a restricted role (viewer, read-only token, another company) against every write path the pull request adds or changes, not just the new tool.
26. An e2e wait waits for a state (a role, a text, a response), never a fixed timeout. A fixed `waitForTimeout` is a flake waiting to happen.
27. A fix comes with a test that fails when the fix is reverted (self-check 6). Show the failing run once.
28. A persisted flag is a hint, not a confirmation. A stored "marked", "synced" or "done" is checked against the source of truth before it gates money or a write.
29. A test does not peek at another feature's query or cache with a second observer. It asserts what its own screen or call returns.
30. Renaming something operations can see (a secret, a cron job, a function name, a bucket, a log key) needs an "Ops changes" section in the pull request with what to update and when.
31. Database tests use the shared fixtures in `supabase/tests/helpers.sql` (`tests.fixture_company`, `fixture_project`, `fixture_category`, `fixture_line`) instead of re-writing the inserts. They encode the traps: an expense is negative, a line inserted with a category loses `category_suggested` unless it is set after the insert, a company comes with its loan-part categories, a viewer needs a demo company, and a Mercury line is USD.

## Order

A fix delta for a pull request that is under review goes before other queued work.

## Tasks

Decided, and not applied in this pull request. The pull request that touches the file does the task.

- [ ] Q-1. The signing spike and the CI runbook read Auth config with `SUPABASE_AUTH_READ_TOKEN`. They do not use `SUPABASE_ACCESS_TOKEN` for that read.
- [ ] Q-2. An unknown `?assistant=` preview value shows the error state.
- [x] Q-3. UI polish. Sheet titles and route-sheet titles opt into `data-clip-ok`, like a row title. Button labels, `.ui-row-hint`, and `.ui-meter-label` wrap instead of truncating. Chip, pill, period, segment, text-link, and switch labels stay one line and opt into `data-clip-ok`. That fixes the `*--long-hebrew` stories. Done in this pull request.
- [x] D1. In decision 0080, fold the N13 row into the Error row and the Connect row, mention the retry button, and drop the N13 row. Done by [0082](../decisions/0082-settings-redesign.md): that record replaces the visible Settings copy, so this is not a separate edit.
- [x] D2. In decision 0080, the leftovers paragraph calls N9 the step-2 button. N9 is the error row's retry button. Done by [0082](../decisions/0082-settings-redesign.md), same as D1.
- [x] UI polish. `screens-routes--unpaid-list` clips only at 320, as two hints. Those hints use `wrapHint`. `screens-routes--add-sheet` hint uses `wrapHint`. Done in this pull request.
- [x] UI polish. `screens-routes--change-project-picker` no longer clips on `ui-pick-label`. The label wraps. Done in this pull request.
- [ ] Backlog. Still measure a `clip-no-text` story, and waive only the zero-measured rule. Not this pull request.
- [ ] Backlog. Revisit the 1×1 visually hidden skip. Not this pull request.
- [ ] Backlog. Unpaid-list date drift. Not this pull request.
- [ ] Backlog. The sheet-panel wait can race the panel opening. Not this pull request.
- [ ] Backlog. The Storybook clip spec repeats the sampler. Not this pull request.
