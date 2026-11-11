# Security scan agent

One agent looks for security flaws in Flow and fixes them. It runs in the **security lane**, which has its own slot like the bug-fix lane and doesn't count against the two dev task lanes.

| Run | When (Israel time) | Scope |
| --- | --- | --- |
| Daily | 04:37, Sunday to Friday | The code that reached `main` since the last run |
| Weekly | 02:23, Saturday | The whole repo, plus that day's diff |

Each run has two stages:

1. **Stage 1, known attacks:** every item in [known-attacks.md](../security/known-attacks.md).
2. **Stage 2, creative hunt:** apply the patterns behind past zero-days, from [zero-day-patterns.md](../security/zero-day-patterns.md), to the code in scope.

Then it fixes what it confirmed, through the normal [cycle](../backlog/README.md#the-cycle), and reports.

Both runs fire into one long-running cloud session, the same setup the perf steward uses. That session's history is the private record of open findings (see [Disclosure](#disclosure-the-repo-is-public)).

## Setup (every run)

1. `git fetch origin main && git checkout --detach origin/main`. If an earlier run left local changes, check whether they were pushed; report any that weren't, and don't throw them away.
2. Load the GitHub MCP tools with ToolSearch (`list_pull_requests`, `pull_request_read`, `create_pull_request`, `update_pull_request`, `add_issue_comment`, `merge_pull_request`, `run_secret_scanning` if available).
3. Read CLAUDE.md, the [backlog guide](../backlog/README.md), [CONTRIBUTING](../../CONTRIBUTING.md), the [code checklist](../review/CHECKLIST-code.md) and [PITFALLS](../review/PITFALLS.md) once per session, or again after they change.
4. Run `bash scripts/cloud-agent-install.sh` before the first push of the session.
5. Read the open PRs and their `Claim` blocks. Don't fix files another open PR is changing. Tell that PR's lane instead, through the lane manager, without the exploit details.

## Scope

**Daily.** The base is the `main` sha recorded at the end of the last run. With none, use `git rev-list -1 --before="26 hours ago" origin/main`. Review `git diff <base>..origin/main`, and for each changed file read enough around it to follow the data: the callers of a changed function, and the policies and grants of a changed table. A change to a migration, an edge function, `flow-mcp`, `_headers`, `_redirects`, `config.toml`, `.github/workflows/`, `package.json`, the lockfile or a `deno.json` always gets the full Stage 1 sections that apply to it. If the diff is empty, run the Stage 2 pattern that was tried least recently on one area of the repo instead, and say so in the report.

**Weekly.** Everything: all of Stage 1 across the repo, then at least six Stage 2 patterns (those tried least recently first), the advisory reading (step 4 of [zero-day-patterns.md](../security/zero-day-patterns.md)), `pnpm audit`, the red-team research step (below), and a read-only `curl -sI` of the live Pages site to compare its headers with `_headers` as the build fills it (the policy `scripts/security-headers.mjs` builds). Use subagents for the sweep: one per Stage 1 section, on a cheaper model (Sonnet 5.5 for B and D, Haiku 5.5 for the rest). Give each one its section, the paths and the rule "report candidates with file:line and the data path, don't fix". Then check every candidate yourself before you count it.

## Stage 1: known attacks

Go through [known-attacks.md](../security/known-attacks.md) section by section. For each item in scope, follow the hint, read the code it finds, and write down one of:
- **clear:** checked, nothing found (one line per section is enough);
- **candidate:** a possible flaw, with `file:line`, the input, the sink, and why the guard is missing;
- **regression:** a protection marked "Keep" that the diff weakens.

## Stage 2: creative hunt

1. For each pattern chosen (see Scope), write one hypothesis about Flow: "if an attacker does X at Y, then Z".
2. Try to prove it wrong. Read the code first. If the code doesn't settle it, write a local test: pgTAP in `supabase/tests/database/`, a Deno test beside the function, or a vitest test. Never test against production.
3. A hypothesis that survives becomes a candidate. One that fails gets one line in the report ("P8 on invite accept: unique constraint holds").
4. When a hunt teaches something new, add a row to known-attacks.md or an entry to zero-day-patterns.md, in the fix PR or in a docs PR of its own, in general terms only.

### Red-team research (weekly)

On the weekly scan, two research agents (Fable 5.2) add fresh ideas to the hunt. Each one:

1. Reads three to five recent articles on security, cybersecurity or offensive security (write-ups, advisories, conference talks, new CVEs), preferring the stack in step 4 of [zero-day-patterns.md](../security/zero-day-patterns.md).
2. Turns what it read into three attack cases against Flow, each as a hypothesis in the Stage 2 shape, with the article it came from.
3. Tries each case locally only: reading the code, a local test, or a local build in a local browser. Never production, never GitHub write actions, never a secret's value.

Together, once duplicates are merged, the two agents bring five or six cases. The scan agent checks every case itself before it counts as a candidate, and lists each case in the report with its source and outcome. The case text stays in this session and the report, never in the repo (see Disclosure); only a general pattern goes in, into zero-day-patterns.md as in Stage 2 step 4 above.

## Triage

A candidate is **confirmed** only when a test fails because of it, or a precise trace shows the path from an input an attacker controls to the harm, with every guard on the way accounted for. Rate it with the severity guide at the top of known-attacks.md. Anything else is either "not a flaw" (record why in the session, so later runs don't repeat it) or "unsure" (report it to the owner as a question, without exploit steps).

## Fixing

Fix every confirmed finding, Critical and High first, in the same run when you can.

1. **A task id.** Use the next free number in the area's range ([New ids](../backlog/README.md#how-to-take-a-task)): P&L and loans 1xx, MCP 2xx, transactions 3xx, projects 4xx, onboarding and connectors 5xx, multi-company 6xx, Jev 7xx, infra 8xx, data hygiene 9xx. The task file and the PR title say what is hardened, in neutral words: "FLOW-<id>: invite accept checks the invited email", not "account takeover through invites".
2. **The test first.** Write the test that shows the flaw, show it failing, then fix the cause. Don't add code whose only purpose is to quiet a scanner. Batch findings in the same area into one PR, as the backlog guide says; keep unrelated ones apart.
3. **Gates.** Run lint, typecheck and the touched tests, then push (the pre-push hook runs the quick check; never `--no-verify`). Open the PR with the `Claim` block (`Lane: security`) and the changelog fragment.
4. **Review.** Start one Haiku 5.5 reviewer per PR with the reviewer charter from the backlog guide, and add: "Break the new guard once and confirm the test fails." The reviewer posts its own verdict comment.
5. **Merge.** Squash-merge once the reviewer approved the current head and the `pr` check is green on it (the owner's standing approval). Then run the `ci` workflow by hand on `main` for a Critical or High fix, so it deploys without waiting for the batch of five.
6. **What waits for the owner.** Don't merge, and ask the owner on a card, when a fix: changes what users see or can do (signing in, invites, roles); needs a secret rotated (only the owner can rotate one: name the secret and where it's used, never its value); or rewrites or deletes stored data. Migrations that only add a check, a constraint, a grant change or a policy are normal fixes.

## Disclosure: the repo is public

Everything in this repo, its PRs, comments and task files is public. A flaw is safe to describe only once its fix is live.

- **Before the fix is live,** no exploit steps, payloads or "how to reach it" go into the repo, a PR body, a commit message, a comment or a task file. The PR says what the change hardens, and the test shows it. That is enough for the reviewer.
- **Open findings** (not fixed yet, waiting for the owner, or unsure) stay in this session's history and in the report to the owner, never in the repo. At the start of each run, list the findings still open from earlier runs and re-check them first.
- **A leaked secret** is reported by file and type only, never by value. Tell the owner to rotate it at once; removing it from the repo doesn't make it safe.
- **Production is read-only.** Never send attack traffic to the live app, the live database or the MCP endpoint. The only production call allowed is the weekly `curl -sI` of the Pages site's headers.
- **No real data.** Test fixtures use invented names, round amounts and example.com addresses, as everywhere else.

## Report

End every run with a short report, sent as a push notification when the tool is available (under 200 characters there; the full report as your reply):

- **Scope:** daily `<base>..<head>` (n files) or weekly full, and the head sha. Record the head as the next run's base.
- **Stage 1:** sections checked, and each candidate's outcome.
- **Stage 2:** patterns tried, each hypothesis, and its outcome.
- **Fixed:** PR number, severity, one neutral line, merge sha, and whether it's deployed.
- **Open:** each finding still open, with severity and what it waits for. This list stays out of the repo.
- **Needs the owner:** decisions, secrets to rotate, behavior changes.

If nothing was found, say so in one line, along with what was checked.
