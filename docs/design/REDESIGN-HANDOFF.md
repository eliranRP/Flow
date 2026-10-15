# Redesign handoff (2026-10-15)

Where the approved-redesign build stopped and what is left. The work stopped on 2026-10-12 at about 11:20 UTC, when the account hit its weekly model limit (it resets 2026-10-15 18:00 UTC). Read [REDESIGN-PLAN](REDESIGN-PLAN.md) first: it is the plan this file reports against.

## Where the work is

| Part | State | PR |
| --- | --- | --- |
| Plan, priority queue, owner's answers | Merged | #589 |
| FLOW-363 (1): tokens, motion, raw-value check, decision 0181 | Merged | #590 |
| FLOW-363 (2a): Button and IconButton | Merged | #591 |
| FLOW-363 (2b): Card, StatusDot, ChangePill, ProgressBar | Merged | #592 |
| FLOW-363 (2c): Amount, "+" on income, list cents | Merged | #593 |
| **FLOW-363 (2d): ListRow and List layouts, list-row stories 61 → 21** | **Open, in review.** Head f1bf5c9 passed local CI. Motion review APPROVED. Code and pixel reviews were cut off by the limit and must be re-run. One fix is already decided (see below). | #594 |
| **FLOW-363 (3a): ScreenHeader and the shared CompactBar** | **Not pushed.** The builder stopped mid-way. Its unfinished work is saved as [handoff/flow-363-3a-wip.patch](handoff/flow-363-3a-wip.patch) (applies on f1bf5c9) with its brief, [handoff/brief-363-3a.md](handoff/brief-363-3a.md) | — |
| FLOW-363 (3b), (3c), (4) | Not started | — |
| FLOW-371, FLOW-372, the screens (R4–R11) | Not started; they wait for FLOW-363 | — |

The open branch is `claude/nice-cerf-um5fkw` (#594). This lane pushes every FLOW-363 part to that one branch: after each merge, the branch restarts from `main`.

## Next steps, in order

1. **Finish #594 (2d).**
   - Add the decided fix: tappable rows get the approved press, `m-press` without `m-press-scale` (opacity .72, 120ms, no scale), on the button, danger, selectable, link and project-button branches of `app/src/ui/list-row.tsx`, with a test. Also reword the comment at `app/src/ui/css/41-rows.css:33` to "selected and focus tint".
   - Re-run the code review and the pixel review (both were cut off; the briefs are in the backlog README and REDESIGN-PLAN §6). The pixel review should also check that the default row, now about 3px taller (row title on the body role, line-height 1.45), breaks no screen.
   - Merge once code, pixel and motion approve the same head.
2. **Finish 3a.** Restart the branch from `main`, then `git apply docs/design/handoff/flow-363-3a-wip.patch`. Finish against [handoff/brief-363-3a.md](handoff/brief-363-3a.md):
   - Its first line names base f1bf5c9; use the new `main` instead.
   - Its "do not push" and worktree lines were for a sub-agent builder.
   - The patch was not checked or tested; run the brief's whole gate, `pnpm clip-check` included.

   Delete the `handoff/` folder and this file in the PR that merges the last of them (CONTRIBUTING: remove what your change leaves unused).
3. **3b: sheets, ChoiceSheet and controls.** In scope:
   - Sheet title on the sheet role (20/600), and the scrim token.
   - `radio-sheet` becomes `choice-sheet`. The currency, basis and pace sheets become ChoiceSheet calls; first move their exported copy constants to a small `ui/company-choices.ts`.
   - Chips:
     - 36px tall, 1.5px `--color-tint-strong` border, transparent fill. The selected chip is a tint fill with an accent border; the text stays `--color-text`.
     - `chip-scroller` becomes `organize-chips`. Its only user is the search filter chips, which the board does not want; leave that to FLOW-368.
   - Segment: track `--color-surface`, radius 14. The button is radius 10 at 15/500, and the selected one is `--color-tint-strong`.
   - Toggle: 46×28 with a 22px knob. The knob moves with a `transform`, not an `inset` jump, so it can animate.
   - SwipeRow: "התעלמות" as signal-colour text with no fill. The row leaves with `.m-row-leave`, and `onRemove` fires on `animationend`.
   - The tab bar's colour timing only.

   If 3b is too big, split the chips, segment, toggle and swipe row into their own PR.
4. **3c: the toast, on its own.**
   - The board puts the toast above the bottom bar for 3s: in 200ms with a rise, out 160ms. That replaces decisions 0069 §8, 0074 §1, 0075 §7 and 0137 §3, so it needs a new decision first (next free number after 0181). The owner's rule is that the redesign wins.
   - Keep the failure toast at 4s (0180).
   - Default for the case the board does not cover: while a sheet is open, keep today's top placement and the sheet-pad logic.
   - Highest risk: 41 `useToast` callers, fake-timer unit tests in `ui/toast.test.tsx`, and the e2e geometry specs in `app/e2e/toast.spec.ts`.
5. **363.4:** IconRow, CountedInRow and its sheet, ConnectionPage, and the field states. Then rewrite DESIGN-RULES §2.8 and implementation-guide §7 as the component inventory. Then FLOW-371 and FLOW-372, then the screens in queue order (R4–R11, [TASKS.md](../backlog/TASKS.md#priority-queue)).

## Decisions already made (don't re-ask)

- **Owner, 2026-10-12** (recorded in the task files and in decision [0181](../decisions/0181-redesign-foundation.md)):
  - FLOW-140: renovation costs follow each category's נספר ב setting. Renovation categories default to רק תזרים, which counts them in השקעה.
  - FLOW-369 and 445: "הוספה לפרויקט" is a row in the project's ⋯ menu.
  - FLOW-369: receipt reading waits for FLOW-306.
  - Whole amounts keep no ".00".
  - Expenses keep their U+2212 minus in every list.
- **Lane manager's reading where the boards disagree** (REDESIGN-PLAN §2.1 and the 3a brief):
  - Push to detail is 280ms in and 220ms back; reduced motion means the end state at once, with sheets at 1ms for Vaul.
  - The scrim fades on `--ease-linear` over 260ms.
  - Compact bar: title 17/500, 44px on lists and 56px on detail.
  - Scrim .6; toggle 46×28; selected chip as above.
- **Storybook and tokens:**
  - Storybook's default theme stays light. Specs and scripts pass `&globals=theme:<t>` explicitly.
  - `implementation-tokens.css` is the one hand-edited token file.

## Open with the owner

- **Storybook dedupe.** The proposal: delete the 434 width-copy stories now (`clip-check` already covers 320, 360 and 390 in both themes), and the 405 `*Dark` copies once the Storybook vitest run does a dark pass of every story. Run it as its own infra PR after FLOW-363, or ahead of the queue. No answer yet.
- **Bottom bar (FLOW-364).** The board's tabs are בית · פרויקטים · הלוואות · קבועים, with no + button, לאישור or הגדרות. Ask the owner in the FLOW-364 brief, not in a shared-component PR.

## Follow-ups already filed

- [FLOW-373](../backlog/tasks/FLOW-373.md): expected (כ־) income figures get the "+".
- [FLOW-364](../backlog/tasks/FLOW-364.md): the band figure steps down to 40/400 with two currencies.
- [FLOW-366](../backlog/tasks/FLOW-366.md): earlier income payments on the transaction page get the "+".
- [FLOW-371](../backlog/tasks/FLOW-371.md): a busy secondary button should keep its outline look.

## How the cycle ran (keep it)

- One Haiku builder per part works from a written brief with the board's exact values, in its own worktree, and does not push.
- The lane picks the builder's commit onto the branch, runs lint, typecheck, the raw-value, unused-CSS and unused-code checks and the touched tests, then pushes. The pre-push local CI takes 12–18 minutes.
- Three Opus reviewers: code (with mutation tests), pixel (screenshots with `scripts/story-shots.mjs` at 320 and 393, dark and light) and motion. Any difference from the board blocks the merge.
- One fix round, then the reviewers check only the delta. Merge when all three approve the same head and no `ci` run on main is in progress.
- **Known flaky test:** `app/src/screens/line-split.test.tsx`. Its two-sheet close waits were raised to 3s in #592.
- **Load report:** `FLOW_LOAD_ALLOW=1` was used once, in #590, for the +1.1 KB of Home's first-load CSS that the foundation tokens and motion utilities need. The reason is in that PR.
