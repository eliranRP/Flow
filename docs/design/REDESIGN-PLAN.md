# Redesign plan: components, migration, tests, clean-up

This plan turns the approved [Design canvas](https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD) into build work. [REDESIGN-BUILD](REDESIGN-BUILD.md) holds the rules every PR follows; this file says **what** gets built, **in which PR**, and **what each PR deletes**. The task files hold the screen details.

- **Pages on the canvas:**
  - Ready for dev: 127 boards.
  - Light theme · ready for dev: the same 127 boards in light.
  - Design guide.
  - Flow & motion: the motion spec and the navigation map.
- **Owner's answers (2026-10-12):** they are recorded in [FLOW-140](../backlog/tasks/FLOW-140.md), [FLOW-369](../backlog/tasks/FLOW-369.md) and [FLOW-445](../backlog/tasks/FLOW-445.md).
  - Renovation costs follow the category's נספר ב setting.
  - "הוספה לפרויקט" is a row in the project's ⋯ menu.
  - Receipt reading waits for FLOW-306.

## 0. Who does what

| Team | Model | Does |
| --- | --- | --- |
| Planning (lane manager for the redesign) | Opus 5.5 (`claude-opus-5-5`) | This plan, the briefs, the queue, claims, merges, the owner's questions |
| Execution: builders, one per PR | Haiku 5.5 (`claude-haiku-5-5`) | Builds from a brief, runs lint, typecheck and the touched tests, pushes, and stops ([backlog README, builder](../backlog/README.md#builder)) |
| Code review | Opus 5.5 | As in the backlog README |
| Design review team | Opus 5.5, two reviewers per PR | Reviews every component and screen against its canvas board before the merge (see [§6](#6-design-review-team)). Any difference blocks the merge, and the reviewer sends a short list of the differences |

Execution follows the [backlog README](../backlog/README.md):
- Two UI lanes, one area per lane.
- Each PR claims its work with a draft PR.
- The pre-push hook runs local CI.
- The PR gets a code review and a design review.
- There is one fix round, then a squash merge.

## 1. Order

The order is in the [priority queue](../backlog/TASKS.md#priority-queue) as rows R1 to R11.

1. **R1 · FLOW-363 foundation.** It ships alone, as PRs in a row from one UI lane (363.1, 363.2a to 2c, 363.3 and 363.4 below; each title starts `FLOW-363 (<part>):`). No screen PR starts until 363.4 has merged.
2. **R2 · FLOW-371** (skeletons, empty states, loaders) and **R3 · FLOW-372** (light theme, מראה). One per UI lane, in parallel. They change disjoint files: FLOW-371 owns `skeleton`, `empty-state`, `screen-state`, the sync strip and the spinner; FLOW-372 owns the light token values, the theme store and `ThemeColor`.
3. **The screens, by area.** Once R2 and R3 have merged, each lane takes one area batch at a time, in queue order (a screen's definition of done needs FLOW-371's skeletons and FLOW-372's light stories):

   | Row | Batch | Lane |
   | --- | --- | --- |
   | R4 | FLOW-364 Home, FLOW-366 month lines and the transaction page (most screens reuse these) | 1 |
   | R5 | FLOW-365 review, FLOW-367 open invoices | 2 |
   | R6 | FLOW-445 projects, FLOW-446 השקעה והלוואות, FLOW-139 loans | 1 |
   | R7 | FLOW-140 profit, FLOW-141 forecast | 2 |
   | R8 | FLOW-447 קבועים | 1 |
   | R9 | FLOW-368 search, FLOW-369 add, FLOW-370 split | 2 |
   | R10 | FLOW-512 Settings, FLOW-513 categories, switching business and the invitation | 1 |
   | R11 | FLOW-514 onboarding (last: it reuses the connection pages, the new-loan form and the review card) | 2 |

   A batch may be one PR or one PR per task. It is never more than one area.

## 2. Core components (FLOW-363)

Approach: **evolve the existing components in place and merge near-duplicates.** Screens import from the `app/src/ui/index.ts` barrel, so when a component keeps its name and gains the new look, every screen picks the look up without a screen change. A variant, prop or wrapper that only an old screen still uses is deleted in the screen PR that stops using it.

### 2.1 Motion tokens and utilities (every component uses these)

| Token | Value | Used by |
| --- | --- | --- |
| `--ease-enter` | `cubic-bezier(0.2,0.8,0.2,1)` | Everything that arrives |
| `--ease-exit` | `cubic-bezier(0.4,0,1,1)` | Everything that leaves |
| `--ease-standard` | `cubic-bezier(0.4,0,0.2,1)` | In-place changes (bar widths, row collapse). It replaces today's `cubic-bezier(0.2,0,0,1)` |
| `--ease-linear` | `linear` | The sheet scrim fades linear (Motion board, month drawer); it fades and does not move |
| `--motion-press` | 120ms | Press: opacity .72, plus scale .985 on buttons |
| `--motion-fast` | 150ms | Tab crossfade, chip colour, segment, toggle knob, focus ring |
| `--motion-toast-out` | 160ms | Toast out |
| `--motion-fade` | 200ms | Toast in, skeleton → content crossfade, the sync pill's delay |
| `--motion-sheet-out` | 220ms | Sheet out, back from a detail page, a row leaving |
| `--motion-width` | 300ms | Bar widths (ease-standard) |
| `--skeleton-delay` | 300ms | Nothing shows before this (FLOW-371) |
| `--motion-bar` | 240ms | Compact bar and sticky panel in and out, month change |
| `--motion-scrim` | 260ms | Sheet scrim |
| `--motion-page` | 280ms | Page enter, push to detail |
| `--motion-sheet-in` | 280ms | Sheet in |
| `--motion-stagger` | 40ms | Page-enter stagger, first five blocks |
| `--motion-bar-grow` | 480ms | Thin bars grow from the right on enter |
| `--motion-pulse` | 1.2s | Skeleton pulse (FLOW-371) |
| `--motion-spin` | 800ms | Inline spinner, one turn (FLOW-371) |
| `--rise-page` / `--rise-push` | 8px / 24px | Page-enter rise, push offset |

- **One utility each**, in a new `app/src/ui/css/00-motion.css`, imported first from `app/src/ui/ui.css`:
  - `.m-press`
  - `.m-page-enter`, with `--i` for the stagger index
  - `.m-push-in` and `.m-push-back`
  - `.m-sheet-in` and `.m-sheet-out`
  - `.m-bar-in` and `.m-bar-out`
  - `.m-row-leave`, which uses `grid-template-rows: 1fr → 0fr` and never a measured height
  - `.m-bar-grow`
- **A helper:** `pageEnterStyle(index)` sets `--i` on the first five blocks. It lands with its first user, the Home screen (FLOW-364), since nothing in the shared parts enters as a page.
- **Reduced motion:** under `prefers-reduced-motion: reduce`, every `--motion-*` token becomes `0ms` and every rise becomes `0`, so the end state shows at once, except `--motion-sheet-in` and `--motion-sheet-out`, which stay `1ms` for Vaul (it has no animationend fallback; see `app/src/ui/css/10-settings-onboarding.css`). 363.1 moves that override to the new names. `reduced-motion.tsx` keeps its Storybook frame and decorator.
  - The Motion board turns slides into a 120ms fade. REDESIGN-BUILD and the owner's brief say "everything off", and that rule wins.
  - The scroll-linked band fade is not a timed animation, so it still follows the finger.
- **Push-to-detail timing:** the Motion board's 300ms in and 260ms back are replaced by the Design guide's numbers, 280ms from 24px and 220ms back. The Design guide and the brief agree on those.

### 2.2 The component list

Every row below is one component, with one story file and one test file. "Replaces" names what is folded in or deleted, and the PR that deletes it.

| # | Component (file) | Replaces | States | Motion |
| --- | --- | --- | --- | --- |
| 1 | **Button** (`button.tsx`): `primary`, a 52px pill at 17/500 on the accent (text `--color-on-accent`, #15111E in dark); `secondary`, a 52px outline pill (1.5px `--color-tint-strong`) at 16/500; `link`, a 44px text link at 15/400 in `--color-accent-text` with an optional left-chevron icon; `danger-link`, signal-colour text | `text-link.tsx` folds into `variant="link"`. The `pill`, `ghost`, `danger` and `danger-tint` variants go: each screen PR switches its call sites, and the last one deletes the variant. TextLink's 61 screen uses (39 files) move in their screen PRs, and R11 deletes `text-link.tsx` | default, pressed, disabled, busy (inline spinner and the action's verb, same width, `aria-busy`, other actions on the screen disabled), focus ring | Press 120ms (opacity .72, scale .985) |
| 2 | **IconButton** (`icon-button.tsx`) | — | default, pressed, disabled, on-band | Press 120ms (opacity only) |
| 3 | **ListRow** (`list-row.tsx`): `flat` (on the background, 20px margins, about 64px tall, 36px initial circle, name 17/400, one line 15/400, amount at the end, no dividers or chevrons) and `inset` (a row inside a Card, 14px padding, `--color-line` dividers). `control` is `none`, `chevron` (inset only), `radio`, `check`, `switch` or `value` | `check-row.tsx`, `radio-row.tsx` (`control="radio"` and `"check"`), `person-row.tsx`, `connector-row.tsx`, `cash-line-rows.tsx` and the rows of `expected-month-sheet` become ListRow presets. 363.2 migrates the call sites mechanically (same look, new props) and deletes the old files. ListRow's nine variants shrink to the two layouts plus `control` | default, pressed, selected, disabled (with a reason line), busy (spinner at the end), pending (soft text), skeleton (FLOW-371) | Press 120ms (opacity .72); leaving 220ms fade and collapse |
| 4 | **Card** (`card.tsx`, new): radius 20 (the token sits in the 16 to 24 range), 14 to 18px padding, `--color-surface`; `tone="tint"` for the problem box and דורש טיפול | The generic `.ui-project-list` surface. The feature cards (`.ui-invest-card`, `.ui-split-card`, `.ui-prompt-card`, `.ui-invite-card`) move onto Card in their screen PRs, which delete their CSS | default, pressed (when the whole card is a link), tint | Press 120ms |
| 5 | **Amount** (`big-number.tsx` renamed `amount.tsx`) | `BigNumber`. The role prop sets the size: band 52/500, detail 40/400, total 34/400, card 28/400, list 17/400 with the cents at 11px, raised 5px | expense (U+2212 on the left), income (green with "+"), loss (signal colour), muted ($0) | None (figures never count up) |
| 6 | **Band** (`top-band.tsx`) and **ScreenHeader** (`screen-header.tsx`), sharing **CompactBar** (`compact-bar.tsx`, new; extends the [0156](../decisions/0156-labelled-back-and-compact-bar.md) bar, never a second one) | `hero.tsx`, `BandHero` (`layout.tsx`) and `band-company.tsx` fold into Band in FLOW-364. The ScreenHeader `kicker`, `titleAside` and `layout="inline"` options go when their last screen moves | Band: current or past month (#7B3FE4 ↔ #5A2DB0). Header: with Back, with actions, scrolled (compact bar shown with Back · "title · figure" and actions) | The band figures fade with scroll (60 to 220px, no timer). The compact bar slides in 240ms ease-enter and out 240ms ease-exit. Band colour 240ms |
| 7 | **OrganizeChips** (`chip-scroller.tsx` renamed `organize-chips.tsx`) with **StickyPanel** | `chip-scroller.tsx`; the `choice` and `selected` kinds of `chip.tsx` | one chip always selected; pressed; panel shown | Chips 150ms colour; panel 240ms with the compact bar |
| 8 | **Segment** (`segmented-control.tsx`), e.g. נכנס / יצא | — | one selected, pressed, disabled, busy, on-band | 150ms |
| 9 | **Toggle** (`toggle.tsx`) | — | on, off, disabled-on, disabled-off, locked (`aria-disabled`), busy | Knob 150ms ease-standard |
| 10 | **IconRow** (`icon-row.tsx`, new): 24px outline icon, label 13, value 16/500, a chevron or a link action; a switch row has no chevron. **CountedInRow** with **CountedInSheet**: "נספר ב" with רווח ותזרים / רק תזרים / לא נספר, one line on each ([0170](../decisions/0170-pnl-follows-company-basis.md)) | `charge-switches.tsx` (moves in FLOW-366, which deletes `37-charge-switches.css`) | default, pressed, disabled, busy, value changed (the undo toast) | Press 120ms; the sheet as #11 |
| 11 | **Sheet** (`sheet.tsx`), **ChoiceSheet** (`choice-sheet.tsx`, from `radio-sheet.tsx`) and **ConfirmSheet** | `radio-sheet.tsx` is renamed to ChoiceSheet. `currency-sheet.tsx`, `basis-sheet.tsx` and `pace-sheet.tsx` become ChoiceSheet calls in 363.3 and are deleted. The Sheet + RadioRow lists built by hand in eight screens move in their screen PRs | open, closing, busy (save in progress), refusing (an incomplete change, ביטול השינוי) | In 280ms ease-enter; out 220ms ease-exit; scrim 260ms; drag down to close |
| 12 | **Toast** (`toast.tsx`, `toast-layout.tsx`) | The undo toast lasts 3s with ביטול. The [0180](../decisions/0180-instant-tap-notify-on-failure.md) failure toast stays. `--toast-duration` moves to 3000ms | ok (with or without ביטול), failure, info | In 200ms rising from above the bottom bar; out 160ms |
| 13 | **Field** family: `text-field.tsx`, `money-field.tsx`, `select-field.tsx`, `code-field.tsx` (monospace LTR with העתקה), `search-field.tsx` | `percent-field.stories.tsx` merges into the money-field stories and `percent-field.test.tsx` into `money-field.test.tsx` (there is no `percent-field.tsx`) | default, focused, filled, error (message line reserved), disabled, read-only while busy, busy (spinner at the end, FLOW-371) | Focus ring 150ms |
| 14 | **ConnectionPage** (`connection-page.tsx`, new): what the connection gives, numbered steps, a tinted problem box, one field or one copy button, then מתחבר… and מחובר ✓ with the last sync | `connect-sheet.tsx`, `mercury-connect-sheet.tsx`, `sumit-connect-sheet.tsx` and `connector-status-sheet.tsx`, deleted by FLOW-512 when SUMIT, Mercury and MCP move onto the page | new, connecting (busy), connected, problem (the key stopped working), error (one line with נסו שוב) | Page enter |
| 15 | **SwipeRow** (`swipe-remove.tsx` renamed `swipe-row.tsx`) | — | rest, revealed (התעלמות in signal-colour text, no fill), leaving | Leaves with a 220ms fade and collapse; undo toast |
| 16 | **ChangePill** and **StatusDot** (`change-pill.tsx`) | `StatusPill` from `chip.tsx`. Status is coloured text or a 6px dot, never a filled chip | helps (grey #4A4458 on the band, neutral off it), hurts (#C3302B on the band, signal off it); dot tones neutral, accent, signal | None |
| 17 | **ProgressBar** (`progress-bar.tsx`): thin 6 to 8px bars, two-part split bars, and the 8px job bar of FLOW-371 | `BudgetBar` becomes `variant="split"` | value, split, indeterminate (sync strip) | Grows from the right, 480ms on enter; widths ease `--motion-width` with ease-standard |
| 18 | **TabBar** (`tab-bar.tsx`): בית · פרויקטים · הלוואות · קבועים | The FLOW-364 brief settles the + button's place against the canvas | active, pressed, badge | Tab colour 120ms; content crossfade 150ms; no slide |
| 19 | **Page transitions**: `usePageEnter`, `PushPage` | The screen-push 250ms in DESIGN-RULES | entering, entered, going back | Page enter 280ms with a 40ms stagger; push 280ms from the left, back 220ms |

FLOW-371 builds these, on the 363 motion tokens:
- **Skeleton**: blocks, pulse, shown after 300ms, 200ms crossfade.
- **EmptyState**: a 64px tint circle; `error-state.tsx` folds into its failure line with נסו שוב.
- **Spinner**: inline, 16 to 18px.
- **SyncStrip**: 3px line plus a pill after 200ms.
- **ProgressBar `variant="job"`**.

FLOW-363 leaves their slots and tokens in place and adds no loader of its own.

**Count.** `app/src/ui` has 277 files and about 60 component modules today. The merges above remove about 20 component files: text-link, check-row, radio-row, person-row, connector-row, cash-line-rows, radio-sheet (renamed), currency-sheet, basis-sheet, pace-sheet, hero, band-company, connect-sheet, mercury-connect-sheet, sumit-connect-sheet, connector-status-sheet, charge-switches, error-state, the BudgetBar export, and the chip choice kinds. Each goes in the PR that moves its last call site.

### 2.3 Tokens (363.1)

- **Source of truth.** `design/system/implementation-tokens.css` becomes the one hand-edited token file. Its header says "generated from design-tokens.json", but the generator has drifted: running `design/src/gen_implementation_tokens.py` today drops `--surface-hover`, `--tabbar-min-inset`, `--toast-duration-error` and the `.t-hint` colour, and no code reads `design-tokens.json`. So 363.1 deletes `design-tokens.json` and `gen_implementation_tokens.py`, rewrites the header, and updates every doc that names them (`design/README.md`, `design/system/design-system.md`, implementation-guide §2.1, DESIGN-RULES, `docs/tech/tech-plan.md`, `design/MANIFEST.txt`). `design/src/tokens.py` stays only while the old mockup generators in `design/src` use it (363.1 also removes the `design-tokens.json` write in `design/src/flow.py`); R11 deletes `design/src` with the last old board.
- **Type.** One token per role in REDESIGN-BUILD's table: `--type-band`, `--type-detail`, `--type-total`, `--type-title`, `--type-card`, `--type-name`, `--type-sheet`, `--type-section`, `--type-body`, `--type-btn`, `--type-btn-2`, `--type-line2`, `--type-meta`, `--type-chip`, `--type-caption`, `--type-cents`.
  - Each role keeps today's pattern: `--type-<role>-size`, `-line` and `-weight`, a `.t-<role>` class, and the `--text-<role>` aliases in `app/src/styles/app.css`. `--type-wordmark` is kept as it is.
  - The old `--type-hero`, `display`, `title-1`, `band-title`, `title-2`, `heading`, `title-3`, `amount`, `body`, `label`, `meta`, `hint` and `micro` go once nothing reads them. 363.1 aliases each old name to its new role, so screens keep working; each screen PR switches to the new names; R11 deletes the aliases.
  - Body moves from 16/500 to 17/400. The 17px titles move from 600 to 500. Text stays light.
- **Colour.** The dark values from FLOW-363 (#15111E background and the rest), keeping today's `--color-*` names where they exist, plus `--color-band-past`, `--color-signal-soft`, `--color-pill-helps` and `--color-pill-hurts`. Light values are FLOW-372's.
- **Spacing.** `--space-side` 24 → 20px. Section gaps use `--space-4` to `--space-6` (14 to 24px). Add `--row-height` 64px, `--avatar` 36px, `--empty-icon` 64px (was 80), `--bar-thin` 6px, `--bar-job` 8px and `--dot` 6px.
- **Radius.** `--radius-card` 20px (inside the 16 to 24 range). Buttons become pills: `--radius-button` is 9999px.
- **New decision** (next free number, 0181 at the time of writing): it records the new scale, colours and motion, and amends [0120](../decisions/0120-income-green-type-scale.md), today's `--type-*` weights, and [0025](../decisions/0025-implementation-guide-is-mandatory.md) (`implementation-tokens.css` replaces `design-tokens.json` as the token source).

### 2.4 The four FLOW-363 PRs

| PR | Contents | Deletes |
| --- | --- | --- |
| 363.1 Tokens and motion | `implementation-tokens.css` (now the source), `app/src/styles/app.css` aliases, `00-motion.css`, `reduced-motion.tsx`, the raw-value check (§4.3), explicit themes in `clip-check.mjs` and the layout spec, and `story-shots.mjs` (§3), decision 0181, DESIGN-RULES §2.2 to 2.7 and implementation-guide §2, §5 and §10 | Old motion tokens (`--dur-*`), once 363.1 moves their readers to `--motion-*`; `design-tokens.json` and `gen_implementation_tokens.py` |
| 363.2a Buttons | Button (primary and secondary on the board's metrics, `link` and `danger-link`), IconButton press, dark `--color-on-accent` #15111E | Old Button stories folded into args and one `Legacy` story |
| 363.2b Cards, amounts, pills, bars | Card, Amount (BigNumber renamed; income gets "+", cents 11px raised 5px), ChangePill and StatusDot, ProgressBar (split) | `StatusPill`; `BudgetBar`; their stories and CSS |
| 363.2c Rows | ListRow (`flat`, `inset`, `control`) | check-row, person-row, connector-row and cash-line-rows (mechanical call-site moves, same look); radio-row (28 sites) in its own PR (2d) if it does not fit |
| 363.3 Header, sheets, toast, chips | The stacked page title on the `title` role (32/600; today `.t-title-1` overridden to 28px in `10-settings-onboarding.css`), CompactBar, Band and ScreenHeader on the new tokens, Sheet and ChoiceSheet, Toast (undo 3s), OrganizeChips and StickyPanel, Segment, Toggle, SwipeRow, TabBar motion | currency-sheet, basis-sheet and pace-sheet (moved to ChoiceSheet), `chip-scroller.tsx` (renamed), their stories |
| 363.4 Icon rows, connection frame, fields | IconRow, CountedInRow and CountedInSheet, ConnectionPage, Field states; DESIGN-RULES §2.8 and implementation-guide §7, rewritten as the new component inventory | `percent-field.stories.tsx` and `percent-field.test.tsx` (merged into money-field's); the ds-4/5/6/8 board PNGs, once the rewritten §2.8 and §7 stop linking them (§5) |

## 3. Storybook: fewer stories, one file per component

Today there are 133 story files and 1,638 stories. 405 of them are `*Dark` copies and 434 are width copies (320, SE, 375, 393, Short). No story uses `argTypes`. `clip-check` already renders every story at 320, 360 and 390 in light and dark, so most of those copies test nothing new. The rules, following the Storybook docs on [writing stories](https://storybook.js.org/docs/writing-stories), [args](https://storybook.js.org/docs/writing-stories/args), [controls](https://storybook.js.org/docs/essentials/controls) and [autodocs](https://storybook.js.org/docs/writing-docs/autodocs) (Storybook 8.6 here):

1. **One story file per component.** It sits next to the component, `<name>.stories.tsx`, with `title: "UI/<Name>"` or `"Screens/<Name>"`. A merged component takes its old files' stories as args and the old files are deleted.
2. **CSF3 with `args` and `argTypes`.**
   - `meta.args` holds the default props, with invented data.
   - `meta.argTypes` declares every state prop: `variant`, `disabled`, `busy`, `selected`, `checked` and `error` as select or boolean controls.
   - A story per state is a one-line `args` override: `export const Busy = { args: { busy: true } }`.
   - No story repeats a render function only to change a prop.
3. **Theme and width are globals, never story copies.**
   - `preview.tsx` already has the `theme` toolbar global and the `flow320` and `flow393` viewports.
   - The default theme stays light: about 1,200 stories set no theme, and the Storybook tests render each story once, so a dark default would leave light untested until the stories migrate. Each spec and script that opens a story passes `&globals=theme:<t>` explicitly (363.1 fixes `clip-check.mjs` and `storybook-layout.spec.ts`, whose light pass sent no theme).
   - 363.1 adds `scripts/story-shots.mjs`: given story ids and a built Storybook, it screenshots each story in dark and light at 320 and 393 (theme through `&globals=theme:…`, width through `page.setViewportSize`, as `clip-check.mjs` does), for the design review. CSS tokens hang on `:root[data-theme]`, so one page can't show both themes side by side; four shots can.
   - The vitest Storybook project and `clip-check` run each story in both themes and at both widths, so no `*Dark` or `*320` story is written by hand.
   - A story whose layout only breaks at a size (for example a sticky bar at 375x667) keeps a story-level `parameters.viewport` and a name that says why.
4. **Docs pages.** `tags: ["autodocs"]` on every component meta. The component's JSDoc becomes its docs page, with the controls table and every state story.
5. **Screens.**
   - Each screen keeps one story file with its canvas states: for example `Default`, `Scrolled`, `Empty`, `Loading`, `PastMonth`.
   - Each state is a named story with `args` for its data fixture.
   - A screen state that is only a component state (busy button, error field) lives in the component's file, not the screen's.
6. **Reduced motion.** Every component with motion has a `ReducedMotion` story, using the `forceReducedMotion` decorator from `reduced-motion.tsx`.
7. **The migration deletes copies.** Each PR that touches a story file:
   - deletes its `*Dark` and width copies;
   - turns near-duplicates into args;
   - lists the story count before and after in the PR body.

   The target is under 600 stories once R11 merges.

**Acceptance per component:** a story for each of its states, in dark and light, at 320 and 393 (through the theme and viewport globals, shot by `story-shots.mjs`), with invented data, plus a docs page.

## 4. Tests

### 4.1 Per component (in the PR that builds or changes it)

- **States:**
  - Each state prop renders its state: `aria-pressed`, `aria-checked`, `aria-selected` and `aria-disabled` where they apply.
  - Disabled controls don't fire `onClick`.
  - A busy Button keeps its width (from the measured box in jsdom, or a `data-width-lock` contract), sets `aria-busy`, shows the verb, and ignores taps.
  - A busy Sheet waits for its save before it closes.
- **Motion:** for each `.m-*` utility, the computed `transition-duration` and `animation-duration` are `0s` (sheets: at most `0.001s`) under `forceReducedMotion`, and equal to the token otherwise. FLOW-363's acceptance asks for this test.
- **Money:**
  - The formatter puts "+" on income and U+2212 on a loss, inside `<bdi dir="ltr">`.
  - Cents are wrapped for the 11px raised style.

### 4.2 Across the app

- Each screen PR updates the screen's tests to the new components' roles and labels. Tests query by role and accessible name, never by class.
- A test that only covers a deleted component or variant is deleted with it. A test that also covers something kept moves to the part that stays ([CONTRIBUTING](../../CONTRIBUTING.md#remove-what-your-change-leaves-unused)).
- The e2e specs that click through Home, review and add are updated in R4, R5 and R9.

### 4.3 Raw values in screen CSS (363.1)

A new `scripts/check-css-tokens.mjs` (with `.test.mjs`), run in `scripts/local-ci.sh` and `ci.yml` next to `check-unused-css.mjs`.

- **It reads** every `app/src/**/*.css` file except the token files (`implementation-tokens.css`, the `:root` and `@theme` blocks of `app/src/styles/app.css`).
- **It fails on:**
  - a hex colour, `rgb()`, `rgba()`, `hsl()` or a named colour (`transparent`, `currentColor` and `inherit` are allowed);
  - a `font-size` or `line-height` that is not `var(--type-*)`;
  - a numeric `font-weight`;
  - a duration in ms or s in `transition`, `animation` or `*-duration`;
  - a `cubic-bezier()`;
  - a `border-radius` that is not `var(--radius-*)`, `0` or `50%`.
- **Spacing:** raw `px` in `margin`, `padding`, `gap`, `inset` or `top/right/bottom/left` also fails, except `1px` hairlines and `0`.
- **Existing values:** they go in `scripts/css-tokens-baseline.json`, a count per file and rule. The check fails when any count differs from the baseline, up or down, so a PR that removes raw values must lower the baseline in the same PR. Each screen PR takes its own files to zero. R11 deletes the baseline file.
- **Its test** proves a raw hex, a raw 14px font size and a raw 200ms transition each fail, and a `var()` passes.

## 5. Global CSS, the design guide, clean-up

### 5.1 Global CSS and fonts

- **363.1:** tokens, `01-base.css` type and colour, and the Rubik weights.
- **Fonts:** keep Rubik 400, 500, 600 and 700. The text wordmark (`wordmark.tsx`, `--type-wordmark-weight`) and the sign-in title (`--text-signin` in `app/src/styles/app.css`) use 700; all other text uses 400 to 600.
- **FLOW-372:** the light values and the theme store.
- **Screen CSS files** (`ui/css/NN-*.css`) shrink in their screen PRs. A file whose last class goes is deleted and its `@import` is removed from `app/src/ui/ui.css`.

### 5.2 DESIGN-RULES and the implementation guide

- **363.1** rewrites DESIGN-RULES §2.2 to 2.7 (colour, type, spacing, radii, shadows, motion) and implementation-guide §2, §5 and §10 to match the canvas Design guide and the tokens.
- **363.4** rewrites DESIGN-RULES §2.8 and implementation-guide §7 as the §2.2 component inventory above.
- **FLOW-372** adds the light table.
- **Each screen PR:**
  - replaces its screen's entry in DESIGN-RULES §4 with a link to its canvas board;
  - removes §3.7 design-log patterns that the canvas replaces;
  - adds a [design log](log/README.md) entry.
- The guide's header names the canvas as the source of truth, in place of the ds boards.

### 5.3 Old PNGs and mockups

Each file is deleted in the PR that removes its last reference. Before deleting, run `rg <basename>` across the repo; it must find nothing outside `design/MANIFEST.txt`, which is updated in the same PR.

| Files | Delete in |
| --- | --- |
| `design/screens/09b-` to `09e-onboarding-dark.png` (named only by `design/src/09-onboarding-dark.html`) | R11, with `design/src` |
| `docs/module-1-project-pnl/design/style-{a-calm,b-dark,c-warm}.png` | Kept: the module-1 design README links them as superseded options |
| `design/system/ds-1..3*.png` (colour, type, spacing) | R11. 363.1 removed their links from DESIGN-RULES, the guide and 0024 (which now says "superseded by 0181"), but a past `docs/changelog.md` entry still links ds-1, and the changelog is not edited by task PRs |
| `design/system/ds-4..6*.png`, `ds-8*.png` | 363.4, with the rewritten §2.8 and guide §7 |
| `design/system/ds-7*.png`, all `design/states/*.png` | FLOW-371, with the rewritten empty and loading section and the `design-system.md` and implementation-guide §7.20 and §8 references |
| `design/screens/NN-*.png` | The screen PR that rewrites that screen's DESIGN-RULES §4 entry (e.g. `01-home-*` in FLOW-364, `14-settings-*` in FLOW-512, which also updates `scripts/ci-cd.test.mjs`) |
| `design/src` (the old mockup generators and the HTML they render, including `ds-*.html`, `overview*.html` and `09-onboarding-*.html`) | R11, with the last old board. `design/src/tokens.py` stays until then |
| `docs/module-1-project-pnl/wireframes` | Kept: the wireframes document the product spec |

## 6. Design review team

Two Opus 5.5 reviewers per UI PR, in parallel, each with a narrow brief. Both must approve the head commit.

**Pixel reviewer:**
- Compares each component or screen with its canvas board at 320 and 393px wide, in dark and light (the board's light twin is on the Light theme page).
- Measures sizes, type role (size and weight), colour token, spacing, radius, bar thickness and touch targets.
- Checks RTL: amounts in `<bdi dir="ltr">`, U+2212, chevron icons, and time running right to left.
- Works from screenshots of the PR's stories made with `scripts/story-shots.mjs`, plus `pnpm clip-check`.

**Motion reviewer:**
- Checks each transition against §2.1: duration, easing, stagger, rise distance and direction (in from the left, past on the right).
- Checks that reduced motion shows the end state at once.
- Reads the CSS and the computed styles from the motion tests, and steps the Storybook interaction stories.

**Output and verdict:**
- Each reviewer opens with `#<n> design-pixel r<round> (head <sha>): APPROVED | CHANGES REQUESTED`, or `design-motion`.
- After that comes a short list of differences: what, where (`file:line` or story), the board's value and the build's value. A patch is attached when it is small.
- **Any difference blocks the merge.** There are no "nit" passes on a design difference. A difference that the canvas itself is unclear on goes to the lane manager, who asks the owner.

The charter goes into each design reviewer's prompt, next to the [design reviewer charter](../backlog/README.md#design-reviewer).

## 7. Briefs for the Haiku builders

Each brief follows [Writing a brief](../backlog/README.md#writing-a-brief) and adds:
- the canvas boards to match, by file name (e.g. `Lines.dc.html`, `LinesLight.dc.html`), with the exact values copied into the brief so the builder doesn't read the canvas;
- the components to use, and the old components, variants, CSS blocks, stories, tests and PNGs the PR deletes;
- the story list in args form, and the before and after story count;
- the tests to write first (§4).

A builder that needs a value the brief doesn't give stops and asks. It never picks a raw value.
