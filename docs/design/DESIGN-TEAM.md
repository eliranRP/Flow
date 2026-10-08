# How the design team works

Flow has two UI build lanes and one design lead. This file says who decides what, where the design system lives, how a design change is recorded, and how the two lanes split work so they never fight over the same files. The owner asked for it on 2026-10-08. It adds to [How the team works](../backlog/README.md#how-the-team-works); where they differ, this file wins for UI work.

## Roles

| Role | Who | Owns | Never |
| --- | --- | --- | --- |
| Owner | Eliran | `PLAN FIRST` approvals and any change to a flow or feature, on a choice card | Is asked about pixels, spacing or wording a rule already covers |
| Design lead | The UI/UX review cycle thread | The design system: [DESIGN-RULES](DESIGN-RULES.md), the [design log](log/README.md), design sessions for both lanes, the review cycle after each deploy | Builds UI or opens a UI PR |
| UI lane 1 | The "Mercury-style UI and UX review" thread | Its queue in [Lanes now](../backlog/TASKS.md#lanes-now) | Changes a file or function lane 2 has claimed |
| UI lane 2 | The second UI lane thread | Its queue in [Lanes now](../backlog/TASKS.md#lanes-now) | Changes a file or function lane 1 has claimed |
| Design reviewer | A fresh reviewer per PR, same [charter](../backlog/README.md#design-reviewer) in both lanes | The design gate on one PR | Approves without 320px shots, light and dark |

Both UI lanes have their own slots. Neither counts against the 2 dev task lanes.

## Where the design system lives

One source per question. When two disagree, the higher row wins, and the lower one is fixed in the same PR.

| Question | Source of truth |
| --- | --- |
| Why the product looks or behaves a certain way | [Decision records](../decisions/README.md), for example [0120](../decisions/0120-income-green-type-scale.md) (option C, "full Mercury") |
| The rules a reviewer checks | [DESIGN-RULES.md](DESIGN-RULES.md), with the [design checklist](../review/CHECKLIST-design.md) and [CONTROLS.md](../qa/CONTROLS.md) |
| Colours, type, spacing, radii, motion | The tokens: [design/system](../../design/system/) and their CSS variables in `app/src/ui/ui.css`. Never a raw value in a screen |
| What a control looks like and which states it has | The shared component in `app/src/ui` and its Storybook story. Storybook is the living catalogue |
| What a screen looks like | The approved mockup: `design/screens/`, or the plan's mockup under the project's `plans/` folder once the owner approved it |
| What changed and when | The [design log](log/README.md) |

A screen only composes shared components. If a control is missing, the lane adds it to `app/src/ui` with a story ([component library](../runbooks/component-library.md)).

## Recording a design change

Every UI PR that changes how something looks or behaves adds **one design log entry**: `docs/design/log/YYYY-MM-DD-flow-<id>.md`. One file per PR means two lanes never conflict on the log. The entry has:

```markdown
# FLOW-<id>: <short title>

- PR: #<n>
- Kind: token | component | pattern | screen | copy
- Changed: <components, tokens, or screens, by file name>
- Rule: <the new or changed rule, one or two lines, or "none">
- Source: <decision record, owner pick on a card (date), or design session>
```

- **Token or component change** (a new token, a new variant, a changed default, a new shared component): the same PR updates DESIGN-RULES §2 and the component's story.
- **New pattern** (a way of doing something the next screen should copy, such as where a sticky action bar sits): the same PR adds the rule to DESIGN-RULES §3 or §5.
- **Big or lasting choice** (it changes the look across screens, or the owner picked it on a card): a decision record too, as today.
- **Pure fix to match an existing rule**: the log entry says `Rule: none`.

After each deploy batch the design lead reads the new log entries since the last cycle, checks that DESIGN-RULES says the same thing, and fixes any gap in the cycle's backlog PR. That is how both lanes stay on one design guide.

## Splitting work between the two UI lanes

1. **By area.** Each lane owns whole areas, not single tasks, so related polish lands in one PR ([batching](../backlog/README.md#batching-by-area)). The areas and each lane's queue are in [Lanes now](../backlog/TASKS.md#lanes-now). The coordinator assigns a new UI task to the lane that owns its area.
2. **Claims name functions in hotspots.** `app/src/screens/flow-screens.tsx` and `app/src/ui/ui.css` are shared by almost every screen. Both lanes may have an open PR on them at once only if the `Files` line of each `Claim` names the functions or CSS blocks it changes (for example `flow-screens.tsx: ReviewQueue, TransactionScreen`; `ui.css: .ui-review-card block`) and the two sets don't overlap. Every other file stays whole-file: one open PR at a time.
3. **Shared components are claimed whole.** If lane 1 has `list-row.tsx` in an open PR, lane 2 waits for the merge before changing it, or asks lane 1 through the coordinator to add what it needs.
4. **One PR per lane at a time.** Each lane works its queue one PR at a time, so at most two UI PRs are open.
5. **Whoever merges second** merges `main` into the branch, re-runs the gates, and re-shoots any screen the other PR changed.

## Keeping the two lanes in sync

- **Before a batch:** read the design log entries since your last batch, the open UI PR of the other lane, and the stories of every component you'll touch.
- **Design session:** run it with the design lead's rules (DESIGN-RULES, the mockups, the log). Build the option the design reviewer recommends. `PLAN FIRST` waits for the owner, as today.
- **A rule is missing or unclear:** don't invent it in a screen. Ask the design lead through the coordinator. The design lead answers with a rule and adds it to DESIGN-RULES in its next backlog PR. Only an owner-visible change goes to the owner on a card.
- **Same gate in both lanes:** a design review per PR, shots at 320, 390 and 480px in light and dark, `pnpm build-storybook && pnpm clip-check`, and the Storybook tests.
- **After the merge:** tell the other UI lane and the design lead (through the coordinator) which shared components changed, in one line.

## Owner approvals

Unchanged. The owner approves `PLAN FIRST` tasks and changes to a feature or a flow, on a choice card with a recommended option. Pixel and consistency fixes that follow DESIGN-RULES ship on the design reviewer's approval.
