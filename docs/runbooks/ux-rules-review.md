# UX rules review (every 3 days)

A recurring review of the UI code that reached `main` since the last run, against the UX/UI rules in [`.claude/skills/ux-ui-design-review-rules/`](../../.claude/skills/ux-ui-design-review-rules/SKILL.md) (142 rules: hierarchy, forms, tables and mobile, feedback and states, charts, motion, tokens and accessibility). The owner asked for it on 2026-11-01. It runs in the **UI/UX review** lane, in turns with the [mobile UI/UX review cycle](ui-ux-review-cycle.md) (the lane runs one job at a time): that cycle screenshots whole screens; this one reads each change. Unlike that cycle, it also fixes what it finds: the owner asked on 2026-11-01 for each run to build the fixes, get them reviewed, merge and deploy them.

| Run | When (Israel time) | Scope |
| --- | --- | --- |
| Every 3 days | 10:43 | The UI code that reached `main` since the last run |

The scheduled task fires into one long-running cloud session. That session's history holds each run's head sha, the base of the next run.

## Setup (every run)

1. `git fetch origin main && git checkout --detach origin/main`.
2. Read CLAUDE.md, the [backlog guide](../backlog/README.md), [DESIGN-RULES](../design/DESIGN-RULES.md) and the [design checklist](../review/CHECKLIST-design.md) once per session, or again after they change. Read the skill's `SKILL.md` and `rules/00-cheatsheet.md` every run.
3. Read the open PRs and their `Claim` blocks.

## Scope

The base is the `main` sha recorded at the end of the last run. With none, use `git rev-list -1 --before="3 days ago" origin/main`. List the commits in `<base>..origin/main` (`git log --format='%h %s'`; each subject ends with its PR number), and keep the files a user sees: `app/src/**/*.tsx`, `app/src/**/*.css`, `app/src/ui/**`, copy and string files. Skip PRs that change only docs, tests, migrations, edge functions or CI. If nothing is in scope, say so in one line and stop.

## Review

1. Group the in-scope changes by screen. For each screen, state its purpose and its one primary action (SKILL.md "How to run a review").
2. Read the diff and enough of the component around it to see the states: empty, loading, error, offline, long data, keyboard, touch.
3. Shoot the changed screens: build Storybook (`pnpm build-storybook`) and run `node scripts/story-shots.mjs --dir app/storybook-static --out <tmp> <storyId>...` for the stories of the changed components (320 and 393 px, dark and light). Block service workers. Desktop widths are reviewed from the code. If the build fails, review from code and say so.
4. Go through the rule files in the SKILL.md order, skipping those that don't apply. Flag only what the diff or the shots show, with evidence (file:line or shot name). DESIGN-RULES and the owner's decisions win over the skill where they disagree: drop the finding, and note the conflict in the report once.
5. Use subagents for a large scope: one per screen group, on Sonnet 5.5, with "report findings with file:line, rule file § n, severity and a concrete fix; don't change code". Check every finding yourself before you count it.

## Findings become tasks

- Drop a finding that an open task or open PR already covers (grep `docs/backlog/tasks/`).
- One task file per finding, or one per screen when several are small; area ranges as in the [backlog guide](../backlog/README.md#how-to-take-a-task). Polish is `SMALL UI`; a change to a flow is `PLAN FIRST`. Each file says `Source: UX rules review YYYY-MM-DD`, cites the rule (`file § n`), and gives the fix.
- Add the ids under their areas in `tasks/index-source.md`, run `node scripts/backlog-index.mjs`, and open one docs PR, `UX rules review YYYY-MM-DD: <n> tasks`, with a `Claim` block (`Lane: UI/UX review`). Review and merge it through the normal [cycle](../backlog/README.md#the-cycle).
- High severity (blocks a task, loses data, misleads, fails accessibility) is also called out in the report.

## Fix, review, merge, deploy

Every `SMALL UI` task the run filed, and any still open from earlier runs, is fixed in the same run (the owner's ask, 2026-11-01).

1. **Batches by area.** One builder subagent per area batch, each in its own worktree and branch, so no two batches change the same file. The batch's first commit sets each of its tasks to `claimed (UI/UX review, YYYY-MM-DD, <branch>)`, so no UI lane takes them. Skip a task whose files an open PR is changing (read the `Claim` blocks); it waits for that PR and is picked up next run.
2. **Each batch** follows the [cycle](../backlog/README.md#the-cycle): the smallest fix, the stories and tests of each fixed state, a [design log](../design/log/README.md) entry, a changelog fragment, the gates, then a PR with a `Claim` block (`Lane: UI/UX review`); once the PR is open, its tasks go to `in-progress (#PR)`.
3. **Review.** One Haiku 5.5 reviewer per PR with the reviewer charter (code and pixels, the story shots at 320 and 393 px, dark and light), plus "check each fix against the rule its task cites". Its verdict comment names the head's full 40-character sha. One fix round.
4. **Merge** each PR once its reviewer approved the current head and its `pr` check is green (the owner's standing approval), then mark its tasks `done (#PR)`.
5. **Deploy.** After the run's last merge, run the `ci` workflow by hand with branch `main` selected (Actions, ci, Run workflow; on any other branch the deploy job is skipped), which deploys without waiting for the batch of five. Watch it to the end; if it fails, fix `main` first. Then the [deploy check](../backlog/README.md#the-cycle): the last line of `build.txt` on the Pages site is the run's last merge sha, and any migration is recorded.
6. **Not fixed in the run:** `PLAN FIRST` tasks wait for the owner's pick on a card; ask in the report.

## Report

End every run with a short report, sent as a push notification when the tool is available (under 200 characters there; the full report as your reply):

- **Scope:** `<base>..<head>`, the PRs reviewed. Record the head as the next run's base.
- **Findings:** the SKILL.md table (screen, finding, rule, severity, fix), sorted by severity, with the task id of each.
- **Top 3** fixes to do first.
- **The tasks PR** and **each fix PR:** number, merge state, and the deploy run with its result.
