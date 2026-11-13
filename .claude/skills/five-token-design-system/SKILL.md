---
name: five-token-design-system
description: >-
  Use this when building or restyling an app screen (or asking a coding agent
  to) so every value comes from five design tokens: color roles, 4-pt spacing, a
  4-size type scale, nested radius, and two shadows.
---
# Five tokens, one screen

Source: Design Motion reel "Five tokens that turn a gray wireframe into a real screen" ([Facebook reel](https://www.facebook.com/reel/1759668412405830/), Nov 11, 2026). The reel's screenshots are left out of this copy; each is described in one line where it was.

**Core rule:** start from a gray wireframe. Every value on the screen comes from a token and is never typed by hand (for example `padding: var(--space-4);`, not `padding: 15px;`).

Image (left out): a gray wireframe of a phone screen, boxes only, no colour.

## Steps

### 1. Color roles: name them by job, not by hue
Define `--color-bg`, `--color-surface`, `--color-text`, `--color-muted`, and `--color-primary`. Components use roles only and never raw palette values like `--teal-500`. Raw hues live in the palette, and each role points at one.

Image (left out): the five roles as swatches beside the wireframe.

### 2. Spacing on 4: every gap is a multiple of 4
Use a scale of `4, 8, 16, 24` (with `--space-1` = 4px and so on). Snap every padding, margin, and gap to it, so an odd value like 11, 23, or 25 becomes the nearest step.

Image (left out): the wireframe with its padding and gaps marked in multiples of 4.

### 3. Type scale: pick four sizes, never use one in between
The demo uses 28 (title), 20 (name or heading), 16 (body), and 13 (meta or muted) px.

Image (left out): the four sizes set as a title, a name, a line of body text and a muted meta line.

### 4. Nested radius: outer = inner + padding
When a rounded element sits inside a rounded container, set `outer radius = inner radius + padding`. For example, inner 14 plus padding 16 gives outer 30. This keeps the corners concentric.

Image (left out): a rounded button inside a rounded card, the two corner arcs sharing one centre.

### 5. Two shadows
Use `shadow-sm` for cards and surfaces, and `shadow-lg` for anything that floats, such as toasts, menus, modals, and popovers. Have no other shadow levels.

Image (left out): a card with a faint shadow and a toast above it with a deeper one.

## Check: pull the screen apart
Every layer should map to tokens only:
- Background: `color.bg`
- Surface: `r 24`, `shadow-sm`
- Text: the type scale
- Components: `primary`, `space 8`
- Toast: `shadow-lg`

Image (left out): the screen exploded into layers, each labelled with its tokens.

## Payoff: theming for free
Swap only the color-role values and you get light mode (or any theme) with no component changes.

Image (left out): the same screen in light mode.

## Starter tokens (CSS)
```css
:root {
  /* palette */
  --teal-500: #2dd4a7;
  /* color roles (dark) */
  --color-bg: #0b0d10;
  --color-surface: #16191e;
  --color-text: #f2f4f7;
  --color-muted: #8b93a1;
  --color-primary: var(--teal-500);
  /* spacing on 4 */
  --space-1: 4px; --space-2: 8px; --space-4: 16px; --space-6: 24px;
  /* type scale */
  --text-sm: 13px; --text-md: 16px; --text-lg: 20px; --text-xl: 28px;
  /* radius (outer = inner + padding) */
  --radius-inner: 14px; --pad-card: 16px;
  --radius-outer: calc(var(--radius-inner) + var(--pad-card));
  /* two shadows */
  --shadow-sm: 0 1px 3px rgb(0 0 0 / .25);
  --shadow-lg: 0 12px 32px rgb(0 0 0 / .4);
}
[data-theme="light"] {
  --color-bg: #f5f6f8; --color-surface: #ffffff;
  --color-text: #111418; --color-muted: #5b6472;
}
```
The hex and shadow values are example starters and don't come from the video.

## Review checklist
- There are no hard-coded hex, px, or shadow values in components (search for `#`, `px`, and `box-shadow` outside the token file).
- All spacing is in {4, 8, 16, 24}, and all font sizes are among the four sizes.
- Nested corners follow outer = inner + padding.
- Only `shadow-sm` and `shadow-lg` are used.
- Toggling the theme changes only the role values.

## In Flow

Flow follows this skill with its own tokens. [docs/design/DESIGN-RULES.md](../../../docs/design/DESIGN-RULES.md) and the owner's recorded decisions win over the skill wherever they differ; the example values above (teal, 13/16/20/28, the starter shadows) are not Flow's.

- **Token file:** `design/system/implementation-tokens.css`, edited by hand, the only token file. `scripts/check-css-tokens.mjs` fails a raw colour, size or shadow in a component; `scripts/check-unused-css.mjs` fails a token nothing uses.
- **Colour roles:** `--color-bg` (page), `--color-surface` (card, sheet), `--color-text`, `--color-text-muted`, `--color-accent` (the one violet; the skill's primary). Light is the base; the two dark blocks (the `prefers-color-scheme` one and the `[data-theme="dark"]` one) set the same properties.
- **Spacing:** `--space-1` to `--space-10` (4, 8, 12, 16, 20, 24, 32, 40) and the named ones built on them (`--space-side` 20). Every value is on the 4-pt grid, with no `calc()` arithmetic; the in-between 2, 6, 10, 14 and 18 steps are retired (the owner, 2026-11-13). Hairlines, borders and focus rings are not spacing.
- **Type:** Flow keeps its role scale (`--type-<role>-size | -line | -weight`, DESIGN-RULES §2.3), not four sizes. The 12px size is `--type-label-size`. A new size is a new role, not a raw number.
- **Radius:** the `--radius-*` tokens. Outer = inner + padding where a rounded control sits in a tight padded rounded track (a segmented control's pill in its track); cards keep `--radius-card`.
- **Shadows:** `--shadow-sm` on cards and surfaces, `--shadow-lg` for floating layers (toasts, the sync pill, menus, sheets, popovers). No other shadow. `--shadow-pill` and `--shadow-toast` are aliases of `--shadow-lg`.
- **RTL and dark:** Hebrew right to left first (DESIGN-RULES §3.4); a screen is checked in light and dark.
