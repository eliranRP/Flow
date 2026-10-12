# The redesign foundation: type, colour, spacing and motion

**Date:** 2026-10-12
**Status:** Accepted (FLOW-363, step 1 of 4)

## Context

The owner approved an app redesign on the [Design canvas](https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD). The canvas has a Design guide page (type, colours, cards and flat lists, components) and a Flow & motion page (timings). The screens are on Ready for dev. The canvas replaces the ds boards of [0024](0024-design-system-approved.md) as the design reference. The redesign build plan is in [REDESIGN-BUILD](../design/REDESIGN-BUILD.md) and [REDESIGN-PLAN](../design/REDESIGN-PLAN.md).

The old scale had nine weights and sizes that did not match the screens: 600 on 17px titles, 500 on body text, and a 52px hero at 600. The owner wants text light, with weight kept for titles, headers and buttons.

## Decision

1. **Type.** One role per size, with a token per role (`--type-<role>-size | -line | -weight`) and a `.t-<role>` class. Rubik 400, 500 and 600 for text; 700 for the wordmark only.

   | Role | Size / weight | Use |
   | --- | --- | --- |
   | band | 52 / 500 | Home band figure |
   | detail | 40 / 400 | Detail amount |
   | total | 34 / 400 | List and summary total |
   | title | 32 / 600 | Screen title (also first-run hero titles) |
   | card | 28 / 400 | Card figure |
   | name | 24 / 600 | Detail name, step titles, empty-state title |
   | sheet | 20 / 600 | Sheet title |
   | section | 20 / 500 | Section and date header: white, plain text, no caps, no grey label |
   | body | 17 / 400 | Row name and body text |
   | btn | 17 / 500 | Primary button |
   | btn-2 | 16 / 500 | Secondary button, icon-row value |
   | line2 | 15 / 400 | Row second line |
   | meta | 14 / 400 | Detail meta line |
   | chip | 14 / 500 | Chips, segments, avatar initials |
   | caption | 13 / 400 | Caption |
   | cents | 11 / 400 | Cents on an amount, raised 5px |

   The old names alias the new roles until the screens are rebuilt (R11 deletes the aliases): hero → band, display → detail, title-1 → total, band-title → title, title-2 → name, heading → sheet, title-3 → btn, amount → body, label → line2, hint → caption, micro → cents.

2. **Colour.** The dark values are drawn; the light values come in [FLOW-372](../backlog/tasks/FLOW-372.md). Token names keep the `--color-*` prefix. New tokens: `--color-signal`, `--color-signal-soft`, `--color-band-past`, `--color-pill-helps` and `--color-pill-hurts`.
   - Green (`--color-income`) means money in and nothing else. Income always carries a "+".
   - At most one signal colour (`--color-signal`) per screen, and only for what needs attention: a loss, a change that hurts, an invoice over 30 days. Good states stay neutral.
   - Status and tags are coloured text or a 6px dot (`--dot`), never a filled chip.
   - Bars are 6 to 8px (`--bar-thin`, `--bar-job`).

3. **Spacing, radius and touch.** The side margin is 20px (`--space-side`). Sections sit 14 to 24px apart (`--space-4` to `--space-6`). Flat list rows are about 64px (`--row-height`), with a 36px initial circle (`--avatar`) and no dividers. Cards have a 20px radius (`--radius-card`, inside the 16 to 24px range) and 14 to 18px of padding. Primary buttons are 52px pills (`--radius-button` 9999px). Touch targets are at least 44px.

4. **Motion.** The durations and easings are in the table of [REDESIGN-PLAN §2.1](../design/REDESIGN-PLAN.md#21-motion-tokens-and-utilities-every-component-uses-these). Enter is `cubic-bezier(0.2,0.8,0.2,1)` and exit is `cubic-bezier(0.4,0,1,1)`. Sheets take 280ms in and 220ms out. The compact bar takes 240ms. Page enter rises 8px and fades in 280ms, with the first blocks staggered 40ms. Push to a detail page slides 24px in from the left (the end side in RTL) and fades in 280ms; back leaves the same way in 220ms. A press takes 120ms. Thin bars grow from the right over 480ms when they enter. The utilities live in `app/src/ui/css/00-motion.css`.

   **Reduced motion:** under `prefers-reduced-motion: reduce` every `--motion-*` token is 0ms and every rise is 0px, so the end state shows at once. The two sheet tokens stay 1ms, because Vaul needs a transition end.

5. **Tokens only.** `design/system/implementation-tokens.css` is the one hand-edited token file. Its header names it as the source. Screen CSS never sets its own hex, font size, weight, duration, easing or radius. If a value is missing, it is added to the token file. `scripts/check-css-tokens.mjs` fails on raw values in app CSS, and `scripts/css-tokens-baseline.json` counts the existing ones until each screen takes its own files to zero. `design-tokens.json` and `design/src/gen_implementation_tokens.py` are deleted. Nothing reads them now.

## Amends and supersedes

- Amends [0120](0120-income-green-type-scale.md) on type weights: body text moves from 16/500 to 17/400, and the 17px row and card titles move from 600 to 500. Its colour and option C layout stay.
- Amends [0025](0025-implementation-guide-is-mandatory.md): `implementation-tokens.css` replaces `design-tokens.json` as the token source.
- Supersedes [0024](0024-design-system-approved.md) for colour, type, spacing and motion. The ds boards it links are retired, and the Design canvas is the design reference. Its Rubik weights and WCAG AA rule stand.
- The `meta` token changes size. `--type-meta` used to be 15px; it is now the 14px detail meta line. Row second lines (`.ui-row-hint` and the hint clip boxes) moved to `line2` (15px) in this change. The remaining old `meta` readers shrink 1px until their screen PR assigns each one `line2` or `meta`: month lists, the transaction page, team, split, and Tailwind `text-meta`.

## Alternatives rejected

- Keep the old scale and add the new sizes beside it. Two scales would drift again, and the screens could not share one rule.
- Keep the generator and the JSON as the source. The generator had drifted: it dropped tokens that code reads, and nothing read the JSON.
- Keep motion at 250ms for push and 200ms for toast. The canvas's Flow & motion page sets the timings, and the owner's brief sets reduced motion to everything off.

## Consequences

Each screen is rebuilt from the shared parts, not from its own values. The old `--type-*` names keep working until a screen moves to the new ones. A screen PR must show the canvas board it matches. Until FLOW-372 the light theme uses the old light values, so light screens look as they do now.
