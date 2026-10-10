# How the design team works

Flow has two UI build lanes and one design lead. This file says who decides what, where the design system lives, how a design change is recorded, and how the two lanes split work so they never fight over the same files. The owner asked for it on 2026-10-08. It adds to [How the team works](../backlog/README.md#how-the-team-works); where they differ, this file wins for UI work.

## Roles

| Role | Who | Owns | Never |
| --- | --- | --- | --- |
| Owner | Eliran | `PLAN FIRST` approvals and any change to a flow or feature, on a choice card | Is asked about small UI (the design lead signs it off) |
| Design lead | The UI/UX review cycle thread | The design system: [DESIGN-RULES](DESIGN-RULES.md), the [design log](log/README.md), answers to rule gaps from any lane, the review cycle after each deploy, and the [sign-off on small UI](#owner-approvals) | Builds UI or opens a UI PR |
| UI lane 1 | The "Mercury-style UI and UX review" thread | Its queue in [Lanes now](../backlog/TASKS.md#lanes-now) | Changes a file or function lane 2 has claimed |
| UI lane 2 | The second UI lane thread | Its queue in [Lanes now](../backlog/TASKS.md#lanes-now) | Changes a file or function lane 1 has claimed |
| Design reviewer | A fresh reviewer per PR, same [charter](../backlog/README.md#design-reviewer) in both lanes | The design gate on one PR | Approves without 320px and 375x667 shots, light and dark |

Both UI lanes have their own slots. Neither counts against the 2 dev task lanes.

## Where the design system lives

One source per question. When two disagree, the higher row wins, and the lower one is fixed in the same PR.

| Question | Source of truth |
| --- | --- |
| Why the product looks or behaves a certain way | [Decision records](../decisions/README.md), for example [0120](../decisions/0120-income-green-type-scale.md) (option C, "full Mercury") |
| The rules a reviewer checks | [DESIGN-RULES.md](DESIGN-RULES.md), with the [design checklist](../review/CHECKLIST-design.md) and [CONTROLS.md](../qa/CONTROLS.md) |
| Colours, type, spacing, radii, motion | The tokens: [design/system](../../design/system/) and their CSS variables in `design/system/implementation-tokens.css`. Never a raw value in a screen |
| What a control looks like and which states it has | The shared component in `app/src/ui` and its Storybook story. Storybook is the living catalogue |
| What a screen looks like | The approved mockup: `design/screens/`, or the plan's mockup under the project's `plans/` folder once the owner approved it |
| What changed and when | The [design log](log/README.md) |

A screen only composes shared components. If a control is missing, the lane adds it to `app/src/ui` with a story ([component library](../runbooks/component-library.md)).

## Recording a design change

Every UI PR that changes how something looks or behaves adds **one design log entry**: `docs/design/log/YYYY-MM-DD-flow-<id>.md`. Use the first id in the PR title; a PR with no id uses a short slug, as in [changelog.d](../changelog.d/README.md). One file per PR means two lanes never conflict on the log. The entry has:

```markdown
# FLOW-<id>: <short title>

- PR: #<n>
- Kind: token | component | pattern | screen | copy
- Changed: <components, tokens, or screens, by file name>
- Rule: <the new or changed rule, one or two lines, or "none">
- Source: <decision record, owner pick on a card (date), or design session>
```

- **Token or component change** (a new token, a new variant, a changed default, a new shared component): the same PR updates the component's story and writes the new rule in the entry's `Rule:` line.
- **New pattern** (a way of doing something the next screen should copy, such as where a sticky action bar sits): the rule goes in the entry's `Rule:` line.
- **Lanes don't edit DESIGN-RULES.** The design lead copies each `Rule:` line into DESIGN-RULES (§2 tokens and components, §3 implementation, §5 do and don't) in the cycle's backlog PR. If a rule must land with the PR itself, DESIGN-RULES becomes a whole-file claim for that PR.
- **Big or lasting choice** (it changes the look across screens, or the owner picked a change to behaviour or data on a card): a decision record too, as today. An owner pick of copy or a visual option inside one screen needs no record: the log entry's `Source:` line and the task's status line in its file under `docs/backlog/tasks/` carry it.
- **Pure fix to match an existing rule**: the log entry says `Rule: none`.

After each deploy batch the design lead reads the new log entries since the last cycle, checks that DESIGN-RULES says the same thing, and fixes any gap in the cycle's backlog PR. That is how both lanes stay on one design guide.

## Splitting work between the two UI lanes

1. **By area.** Each lane owns whole areas, not single tasks, so related polish lands in one PR ([batching](../backlog/README.md#batching-by-area)). The areas and each lane's queue are in [Lanes now](../backlog/TASKS.md#lanes-now). The coordinator assigns a new UI task to the lane that owns its area.
2. **Claims name blocks in the CSS hotspots.** The CSS files are shared by many screens. Since [FLOW-807](../backlog/TASKS.md#flow-807), every screen has its own `app/src/screens/<name>-screen.tsx` and its own `.stories.tsx`, claimed as whole files; the review area is `review-screen.tsx` (ReviewScreen, ReviewAllList, ProjectWaitingList), `review-queue.tsx`, `change-form.tsx` (ChangeForm, AddForm) and `review-shared.tsx`, with stories in `review-screen`, `review-queue`, `change-form` and `jev-review` `.stories.tsx`; `flow-screens.tsx` only re-exports for older imports, and a few app-wide stories (sign-in, help, add, install) stay in `app/src/ui/screens.stories.tsx`. Shared story fixtures live in `app/src/ui/screen-stories-support.tsx`. The shared CSS is `app/src/ui/ui.css`, a list of `@import`s of `app/src/ui/css/NN-<area>.css` in cascade order: never reorder the imports; add a new area as a new file at the end. Both lanes may have an open PR on one CSS file at once only if the `Files` line of each `Claim` names the CSS blocks it changes (for example `css/06-review-card.css: .ui-review-card block`) and the two sets don't overlap. `app/src/ui/index.ts` and the import list in `ui.css` are append-only: each PR adds its own lines and the second to merge resolves the conflict. The import block at the top of a hotspot file is never claimed; the second to merge resolves it. In `css/01-base.css`, the leading `:root` blocks count as one block, `tokens`. Every other file stays whole-file: one open PR at a time.
3. **Shared components are claimed whole.** If lane 1 has `list-row.tsx` in an open PR, lane 2 waits for the merge before changing it, or asks lane 1 through the coordinator to add what it needs.
4. **One PR per lane at a time.** Each lane works its queue one PR at a time, so at most two UI PRs are open.
5. **Whoever merges second** merges `main` into the branch, re-runs the gates, and re-shoots any screen the other PR changed. This is an exception to the coordinator's "merge main only to fix a conflict" rule. It holds for UI PRs even when git shows no conflict, because two disjoint `ui.css` blocks can still change each other's look.

## Keeping the two lanes in sync

- **Before a batch:** read the design log entries since your last batch, the open UI PR of the other lane, and the stories of every component you'll touch.
- **Design session:** each lane runs its own, with the [design reviewer charter](../backlog/README.md#design-reviewer), against DESIGN-RULES, the mockups and the log. Build the option the design reviewer recommends. `PLAN FIRST` waits for the owner, as today.
- **A rule is missing or unclear:** don't invent it in a screen. Ask the design lead through the coordinator. The design lead answers with a rule and adds it to DESIGN-RULES in its next backlog PR. Only a change to a flow or feature (`PLAN FIRST`) goes to the owner on a card.
- **Same gate in both lanes:** a design review per PR, shots at 320, 390 and 480px wide (the [design reviewer charter](../backlog/README.md#design-reviewer)) plus 375x667 for sticky bars (iPhone SE height, where they meet the tab bar), in light and dark, `pnpm build-storybook && pnpm clip-check`, and the Storybook tests.
- **After the merge:** tell the other UI lane and the design lead (through the coordinator) which shared components changed, in one line.

## Owner approvals

The owner chose "Small UI only" on 2026-10-08 and confirmed it with no timeout on plan-first cards. The design lead signs off small UI so a lane doesn't wait for the owner, and the owner keeps `PLAN FIRST`.

**Small UI: the design lead signs off.** This covers a `SMALL UI` task, polish, consistency, wording, and a choice a rule doesn't settle yet inside an existing screen, as long as it changes no flow or feature (that is `PLAN FIRST`).
- **Ask.** The lane sends its question or its shots to the design lead through the coordinator, with the task id and the options.
- **Check.** The design lead checks it against [DESIGN-RULES](DESIGN-RULES.md), the decision records and the mockups already approved for that area. It looks at shots at 320, 390 and 480px wide, and 375x667 for sticky bars, in light and dark.
- **Answer.** The answer is "Approved", or "Changes needed" with a numbered list.
- **Record.** The answer goes into the task's file under `docs/backlog/tasks/` as "approved by the design lead (date)". A new rule goes into DESIGN-RULES in the next cycle's backlog PR.

Pixel and consistency fixes that already follow DESIGN-RULES still ship on the PR's design review alone, with no ask.

**`PLAN FIRST` UI: the owner approves the layout only (2026-10-10).** He picks a big layout change on a choice card with a recommended option, and nothing is built until he answers. After that the team runs it: the design lead checks the built screens against the picked mockup and DESIGN-RULES and signs off, and the lane merges once its gates pass. There is no "ship as built" card, no screenshot card and no merge ask. A build that drifts from the picked layout in a way he would notice (a different flow, a new screen) is a new layout question and goes back to him on a card.

**Mockups for the owner are phone-sized.** He reviews on his phone, and a wide page with several frames side by side is unreadable there (2026-10-08).
- Every mockup sent with a card is drawn at 390px wide: one option per frame, stacked, with no desktop layout around it.
- Each option is also attached as a PNG screenshot at 390px wide, next to any HTML link, so he can choose without opening the page.
- The card's options name the frames ("A", "B") as the PNGs do.

**Night hours.** Between 00:00 and 09:00 Israel time, no `PLAN FIRST` UI work starts. Small UI sign-offs go on as usual.
