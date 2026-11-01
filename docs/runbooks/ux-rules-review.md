# UX rules review (every 3 days)

A recurring review of the UI code that reached `main` since the last run, against the UX/UI rules in [`.claude/skills/ux-ui-design-review-rules/`](../../.claude/skills/ux-ui-design-review-rules/SKILL.md) (142 rules: hierarchy, forms, tables and mobile, feedback and states, charts, motion, tokens and accessibility). The owner asked for it on 2026-11-01. It runs in the **UI/UX review** lane, in turns with the [mobile UI/UX review cycle](ui-ux-review-cycle.md) (the lane runs one job at a time): that cycle screenshots whole screens; this one reads each change. Like that cycle, it never builds fixes; it files them as tasks for the UI lanes.

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

## Report

End every run with a short report, sent as a push notification when the tool is available (under 200 characters there; the full report as your reply):

- **Scope:** `<base>..<head>`, the PRs reviewed. Record the head as the next run's base.
- **Findings:** the SKILL.md table (screen, finding, rule, severity, fix), sorted by severity, with the task id of each.
- **Top 3** fixes to do first.
- **The tasks PR:** number and merge state.
