# Flow: screen implementation guide

**Who this is for:** developers and AI coding agents building Flow screens.
**What Flow is:** a Hebrew-only, right-to-left, phone-only installable web app (PWA). It shows a simple project P&L (income, expenses, profit) for Israeli contractors. There is no desktop layout.
**Source of truth:** the [Design canvas](https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD) (Design guide and Flow & motion pages), with [REDESIGN-BUILD](../../docs/design/REDESIGN-BUILD.md) and [DESIGN-RULES](../../docs/design/DESIGN-RULES.md). The boards in this folder still apply to the screens that have not been rebuilt yet (`ds-7` and `ds-8`). The earlier controls, content and band boards are retired; their parts are in §7 and the Design canvas.
**Tokens for code:** `implementation-tokens.css`, the one hand-edited token file ([0181](../../docs/decisions/0181-redesign-foundation.md)).

How to read the rules:

- **MUST** means the screen is not done until this is true.
- **SHOULD** means do it unless you have a written reason not to (put the reason in the PR).
- **MAY** means optional.

If this guide and the canvas disagree, the canvas wins. Raise the conflict in the PR, and don't guess.

---

## Contents
1. [Principles](#1-principles)
2. [Tokens](#2-tokens)
3. [Screen anatomy](#3-screen-anatomy)
4. [Layout and spacing](#4-layout-and-spacing)
5. [Typography](#5-typography)
6. [RTL and numbers](#6-rtl-and-numbers)
7. [Components](#7-components)
8. [States every screen must handle](#8-states-every-screen-must-handle)
9. [Accessibility](#9-accessibility)
10. [Motion](#10-motion)
11. [Content and copy](#11-content-and-copy)
12. [Checklists: definition of done and PR review](#12-checklists)
13. [File map](#13-file-map)
14. [Appendix: known deviations in the draft screens and open questions](#14-appendix-known-deviations-in-the-draft-screens-and-open-questions)

---

## 1. Principles

These rules come before everything else. When in doubt, choose the calmer option.

| # | Rule | In practice |
|---|---|---|
| P1 | **Calm and airy.** | White page (violet-tinted near-black in dark mode), generous space, hairlines instead of boxes. White space is part of the look, so don't fill it. |
| P2 | **Few numbers per screen.** | A screen answers one question. Home shows the profit, one change, income, expenses, the pending summary and at most 3 projects. That is the whole budget. |
| P3 | **Detail moves to inner screens.** | If you want to add a figure, a chart or a breakdown to an overview screen, put it on the next screen down and link to it with a row or a text link. |
| P4 | **One violet accent: `#7B3FE4`.** | Violet is used on the + button, the primary button, links, the active tab, selected controls and the top band. Filled violet appears **at most about twice** per screen area (normally the + button and one primary button). |
| P5 | **No gradients, no emoji, no heavy shadows.** | Depth comes from the tint fill and 1px hairlines. The only shadows allowed are the faint ones on the switch knob and the selected segment. |
| P6 | **Figures use the main text colour.** | Amounts, counts and percentages use `--color-text`. They are never violet, and never red or green on their own. |
| P7 | **Red and green only with ▼/▲ or a minus sign.** | Colour is never the only signal. A loss is `−₪10,000` in `--color-bad`. A change is `▼ 10%` in a pill. |
| P8 | **The band is the signature.** | The solid violet top band appears only on **Home** and the **Project header**. Every other screen is plain with violet accents. |

---

## 2. Tokens

### 2.1 Rules
- You **MUST** use tokens for every colour, font size, weight, line height, spacing value and corner radius. You **MUST NOT** write raw hex, `rgb()` or ad-hoc pixel values in screen code.
  - The only exceptions are `0`, `1px` hairlines, and component internals copied from the reference CSS in `flow.py`.
- You **MUST NOT** invent new colours or tints: no opacity tricks on the accent, no `color-mix()` and no new greys. If you need a colour that doesn't exist, raise it in the PR.
- You **MUST** import `implementation-tokens.css` once at the app root. Components read `var(--color-*)`, `var(--type-*)`, `var(--space-*)` and `var(--radius-*)`.
- **App consumption:** styling is Tailwind CSS v4. Map these tokens into `@theme` (colours, including light and dark, spacing, radii, the type scale, and shadows) and use only those utilities. An arbitrary value needs a justification. RTL uses logical utilities (`ms-`, `me-`, `ps-`, `pe-`, `start`, `end`) with `dir="rtl"` on the root. Dark mode uses this same token set. Vaul stays for sheets. No component kit with its own look. Decision [0040](../../docs/decisions/0040-tailwind-v4.md).
- Tokens change in one place only: `implementation-tokens.css`, edited by hand. There is no generator and no JSON copy. `scripts/check-css-tokens.mjs` fails on a raw colour, font size, weight, duration, easing or radius in app CSS, so a screen that needs a new value adds a token here first.

### 2.2 Colour token names
In CSS, every colour is `--color-<name>`, for example `--color-text-secondary`.

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | #F6F4FA | #15111E | Page |
| `surface` | #FFFFFF | #1E1929 | Cards, tab bar, sheets, inputs |
| `raised` | #F1EEF6 | #251F33 | Inner box and input (the board; dark mode only differs) |
| `tint` | #EEE6FD | #2A2045 | The one fill colour: pending card, pills, secondary button, skeletons |
| `tint-strong` / `tint-pressed` | #D9CBF6 / #E7DAFD | #382A5E | tint-strong: the selected outline and row fill (the board); tint-pressed: the pressed state of tinted things |
| `line` | #E7E2F0 | #2E2740 | 1px hairlines between rows, card and input borders |
| `outline-secondary` | #DAD3E6 | #382A5E (= tint-strong) | Secondary button border (new) |
| `control-off` | #8F86A3 | #736A8C | Switch track when off, unchecked checkbox border, sheet grab handle (≥ 3:1) |
| `control-border` | #8F86A3 | #736A8C | Borders of inputs, search fields, outlined chips, radio circles (≥ 3:1) |
| `gsi-bg` / `gsi-border` / `gsi-text` | #FFFFFF / #747775 / #1F1F1F | same | The "המשך עם Google" button only (§7.33). Fixed by Google branding, identical in both modes. Stroke 4.5:1 (light) / 4.1:1 (dark) on the page |
| `bad-tint` | #FCEDEC | #3A1E24 | Soft fill behind a destructive confirm button (`bad` text on it: 4.9:1 / 6.6:1) |
| `text` | #1D1728 | #F1EDF8 | Main text and **all figures** |
| `text-secondary` | #5B536E | #B1A8C4 | Labels, secondary lines, row icons |
| `text-muted` | #746C88 | #978EAB | Hints, dates, percentages, chevrons, placeholders |
| `accent` | #6C2ED6 | #B894FF | + button, primary button fill, switch on, selected chip |
| `accent-pressed` | #6631C9 | #A47FF0 | Pressed accent fills |
| `accent-text` | #6C2ED6 | #C3A5FF | Links, accent icons, active tab, secondary button text |
| `logo` | #7B3FE4 | #B894FF | The "Flow" wordmark on white and dark pages (brand violet). **Not** `accent-text`. On the band use `on-band`. |
| `on-accent` | #F6F4FA | #1E0B45 | Text and icons on an accent fill (note: **dark** text in dark mode) |
| `band` | #7B3FE4 | #7B3FE4 | Top band. **The same in both modes.** |
| `on-band` | #FFFFFF | #FFFFFF | Text on the band |
| `on-band-secondary` | #F0E8FF | #F0E8FF | Labels on the band |
| `band-chip` / `band-pill` | #FFFFFF | #1E1929 | Period pill and change pill sitting on the band |
| `good` | #1A8048 | #62CB8D | Positive change, only with ▲ |
| `bad` | #D23B2F | #FF8A80 | Negative change or loss, only with ▼ or a minus sign |
| `warning` | #8A5700 | #EDB866 | Warnings (for example "over budget") |
| `error` | #D23B2F | #FF8A80 | Input error border and message |
| `disabled-bg` / `disabled-text` | #F1EEF6 / #8F889C | #2A2438 / #7A7290 | Disabled controls |
| `scrim` | rgba(29,23,40,.45) | rgba(5,3,10,.62) | Backdrop behind sheets |
| `toast-bg` / `toast-text` | #1D1728 / #F6F4FA | #F1EDF8 / #15111E | Toast (it inverts per mode) |
| `seg-on` | #FFFFFF | #3B2F5E | Selected segment |
| `band-past` | #5A2DB0 | #5A2DB0 | Band of a past month. New in [0181](../../docs/decisions/0181-redesign-foundation.md) |
| `income` | #1A8048 | #62CB8D | Money in only, always with "+". Never with a minus, never on the band (0181) |
| `signal` | #D23B2F | #FF8A80 | The one signal colour on a screen: a loss, a change that hurts, an invoice over 30 days. At most one per screen. New in 0181 |
| `signal-soft` | #B9503F | #E8A598 | Soft signal fill or text beside `signal`. New in 0181 |
| `pill-helps` | #4A4458 | #4A4458 | Band change pill when the change helps. New in 0181 |
| `pill-hurts` | #C3302B | #C3302B | Band change pill when the change hurts. New in 0181 |

These component colours are also in `implementation-tokens.css`:

| Token | Value | Use |
|---|---|---|
| `knob` | #FFFFFF | Switch knob when off (3.4:1 light, 5.0:1 dark on `control-off`) |
| `knob-on` | #FFFFFF / #1E0B45 | Switch knob when on. Dark mode uses a dark knob on the light violet track (7.3:1); light 5.7:1 |
| `toast-bad` | the other mode's `bad` | Error icon inside the inverted toast (7.6:1 light, 4.8:1 dark) |
| `badge-bg` / `badge-text` | `text` / `surface` | Tab bar count badge. It is neutral, not red. |
| `focus`, `focus-on-band` | `accent-text`, `on-band` | Focus rings (see §9) |
| `skeleton`, `skeleton-shine` | #F1EEF6 / #FAF6FF, dark #2A2045 / #33285A | Loading placeholders (decorative) |
| `skeleton-band`, `skeleton-band-shine` | #9565E9 / #A57CED | Placeholders on the band |

The other token groups are:

- **Type:** `--type-<style>-size | -line | -weight` (see §5).
- **Spacing:** `--space-1 … --space-10`, plus `--space-side` (24), `--space-card-inset` (16) and `--space-section` (36).
- **Radius:** `--radius-chip | input | button | card | sheet | band | fab`.
- **Layout and motion:** `--touch-min`, `--control-height`, `--tabbar-height`, `--safe-top`, `--safe-bottom`, `--motion-*`, `--ease-*` (§10).

### 2.3 Light and dark switching
- The app follows the operating system by default (`prefers-color-scheme`). Setting `data-theme="light"` or `data-theme="dark"` on `<html>` forces a mode. You **MUST** put `data-theme` on `<html>` and nowhere else.
- Dark mode is a **violet-tinted near-black** page (`#15111E`), **never pure black**. Cards are `#1E1929`.
- The **top band stays `#7B3FE4` in both modes**, with white text (5.7:1) and `#F0E8FF` labels (4.8:1). The period and change pills on the band become dark (`band-chip #1E1929`) in dark mode.
- In dark mode the accent brightens to `#B894FF` and takes **dark** text (`on-accent #1E0B45`). You **MUST** use `--color-on-accent`. Never hard-code white on violet.
- The `theme-color` meta **SHOULD** be `#7B3FE4` on Home and Project (the band runs under the status bar) and the page `bg` on all other screens.

```html
<html lang="he" dir="rtl">             <!-- follows the OS -->
<html lang="he" dir="rtl" data-theme="dark">  <!-- forced, e.g. from Settings -->
<meta name="theme-color" content="#7B3FE4">   <!-- Home / Project only -->
```

```css
/* ✅ */ .row-amount { color: var(--color-text); font: var(--type-title-3-weight) var(--type-title-3-size)/var(--type-title-3-line) var(--font-family); }
/* ❌ */ .row-amount { color: #1D1728; font-size: 17px; }
/* ❌ */ .loss { color: red; }   /* raw colour, and colour alone */
```

---

## 3. Screen anatomy

Every screen uses exactly one of four templates.

| Template | Used by | Tab bar | Band |
|---|---|---|---|
| **A. Standard screen** | 03 Review, 05 Projects, 07 Categories, 08 Upload results, 12 Unpaid, 14 Settings | yes | no |
| **A+band. Standard with band** | 01 Home, 02 Project | yes | yes |
| **B. Bottom sheet** (over a screen) | 04 Add, 06 Change assignment, "mark as paid", period picker | stays underneath, dimmed | n/a |
| **C. Full-screen flow or task** | 09a–09e Onboarding, 10 Transaction detail, 11 Split | no | no |

(13 Notifications is a mock of the phone's lock screen showing push content. It is not an app screen.)

### 3.1 Template A: standard screen
From top to bottom:

1. **Status area.** The system status bar. The page background (or the band) runs under it: pad with `--safe-top`.
2. **Top bar.** 52px high, 12px side padding.
   - Start side (right in RTL): an icon button, 44×44. It is **back** (chevron pointing right) on inner screens, or **✕** on tasks opened modally. Tab root screens (Review, Projects, Settings) have no button here.
   - End side (left): an optional overflow `⋯` or the example-data tag.
   - A centred title (`title-3`) is only used on detail screens (e.g. "הוצאה").
3. **Header.** Page title in `title-1`, with an optional `label` subtitle in `text-secondary` underneath, both at 24px side padding.
4. **Content.** Sections 36–40px apart, 24px side padding, cards 16px from the edge. Content scrolls; the top bar MAY stay pinned.
5. **Bottom tab bar.** Fixed. `surface` background with a `line` hairline on top. Holds בית · פרויקטים · **+** · לאישור · הגדרות. Height is `--tabbar-height` (86px on notched phones).
   - Content **MUST** have `padding-block-end: calc(var(--tabbar-height) + var(--space-4))` so the last row is never hidden.

```html
<div class="screen">                        <!-- min-height:100dvh; background:var(--color-bg) -->
  <header class="topbar">                   <!-- height:var(--topbar-height); padding-top:var(--safe-top) -->
    <button class="iconbtn" aria-label="חזרה"><svg class="icon">…back…</svg></button>
    <span class="ex">נתוני דוגמה · Example data</span>   <!-- mockups / demo data only -->
  </header>
  <div class="head"><h1 class="t-title-1">פרויקטים</h1><p class="t-label secondary">17 פעילים</p></div>
  <main class="content">…</main>
  <nav class="tabbar" aria-label="ניווט ראשי">…</nav>
</div>
```

### 3.2 The coloured band (Home and the Project header only)
- You **MUST NOT** use the band on any other screen: not on sheets, not on onboarding, not "just for emphasis".
- It is solid `--color-band`: no gradient, no image, no shadow. The bottom corners use `--radius-band` (28px) and there is 28px of padding at the bottom. It starts under the status bar.
- It holds **only the summary**:
  - **Home:** wordmark "Flow" and period pill → greeting (plus example tag) → label "רווח ב…" → profit in `hero` → change pill with "מחודש שעבר" → income and expenses line.
  - **Project:** back and ⋯ → project name (`title-2`) with client and period (`label`) → "רווח · רווחיות X%" → profit → income and expenses line.
- Inside the band, text is `on-band`, labels are `on-band-secondary`, and pills use `band-pill` or `band-chip` backgrounds with `text` or `bad`/`good` inside.
- The first content block below the band starts 24px under it (the Home pending card).

### 3.3 Template B: bottom sheet
- A `scrim` backdrop covers the whole screen, including the tab bar.
- The sheet is a `surface` panel anchored to the bottom, with `--radius-sheet` (24px) on the **top corners only**. Its padding is `8px 0 calc(var(--safe-bottom) + 16px)`, and at least 34px at the bottom on phones with a home indicator.
- Inside, from top to bottom:
  1. A **grab handle**: 40×5, `control-off`, centred, with 12px below it.
  2. A **header row**: title in `title-2` with an optional `label` subtitle, and a **✕ icon button** on the end side (left). The ✕ has `aria-label="סגירה"`.
  3. **Content**, with 24px sides.
  4. **One primary action**, full width, at the bottom. A ghost "ביטול" MAY sit below it.
- **Height:** it fits its content. When the content is long, the sheet grows up to `top: 56px` (see 06) and the body scrolls inside while the primary action stays pinned.
- **Closing:** the ✕, a tap on the scrim, a swipe down on the handle or header, and the Android back gesture all close the sheet. You **MUST** push a history entry when it opens so that back closes the sheet and doesn't leave the screen.
- **Use sheets for short, single-purpose tasks** (1–3 inputs). Anything longer is a full-screen task (template C).

### 3.4 Template C: full-screen flow (onboarding) and full-screen task
- There is **no tab bar** and **no band**.
- The top bar has **back** (steps 2 and later), or **✕** for tasks opened from elsewhere (Split, Upload results).
- **Onboarding only:** a progress row under the top bar, made of a 4px progress bar (`tint` track, `accent` fill) and the hint "שלב X מתוך 5". Step 0 (פרטי העסק) has no progress row. The sign-in step (09a, Google) has no top bar and no progress row. דלג is the top-bar text link on a counted step, not a second primary under the CTA.
- The header is `title-1` plus a one-line `label` explaining why this step matters.
- **Pinned action area:** the primary CTA (52px) sits `calc(var(--safe-bottom) + 16px)` above the bottom edge. Content scrolls behind it and **MUST NOT** be hidden by it (add bottom padding equal to the action area's height).
- One primary per step. Step titles are short nouns (e.g. "פרטי החברה", "הפרויקטים שלך").

---

## 4. Layout and spacing

| Rule | Value | Token |
|---|---|---|
| Page side padding | 24px | `--space-side` |
| Card inset from the screen edge | 16px (cards are wider than text blocks) | `--space-card-inset` |
| Padding inside a card | 16px | `--space-4` |
| Between sections | 36–40px (default 36) | `--space-section` / `--space-10` |
| Between blocks in a section | 16–24px | `--space-4` … `--space-6` |
| Between chips | 8px | `--space-2` |
| Icon to text | 4–8px (rows use 12–14px) | `--space-1`, `--space-2` |
| Row vertical padding | 14px (component internal) | from `flow.py` `.pr` / `.rowi` |
| Minimum touch target | 44×44px | `--touch-min` |
| Button and input height | 52px | `--control-height` |
| Search field height | 46px | `--search-height` |
| Top bar height | 52px | `--topbar-height` |
| + button | 48px circle | `--fab-size` |
| Tab bar | 52px + bottom safe area (86px on notched iPhones) | `--tabbar-height` |

- **The 4-point scale** is 4, 8, 12, 16, 20, 24, 32, 40. Layout spacing between components **MUST** use only these values, plus `section` (36). Dimensions inside a component (e.g. 14px row padding, 6px label gap) come from the reference CSS in `flow.py` and are part of that component. Don't invent new ones.
- **Touch targets:** anything tappable **MUST** have a hit area of at least 44×44. Chips, small pill buttons and segments are drawn 36px tall, so extend their hit area with padding or a `::after` inset. Rows are tappable across their full width. A switch row toggles when the row is tapped, not only the 46×28 switch.
- **Corner radii:**

  | Radius | Value | Used for |
  |---|---|---|
  | `chip` / `fab` | full | Chips, pills, badges, switch, + button |
  | `input` | 12px | Inputs, search, segmented track |
  | `button` | 14px | Buttons, toast |
  | `card` | 16px | Cards and tinted blocks |
  | `sheet` | 24px | Sheet, top corners |
  | `band` | 28px | Band, bottom corners |

  Don't mix radii inside a component.
- **Safe areas:** the viewport **MUST** include `viewport-fit=cover`. The top content pads with `env(safe-area-inset-top)`. The tab bar, sheets and pinned CTAs pad with `env(safe-area-inset-bottom)`. You **MUST NOT** hard-code 47px or 34px.
- **Width:** screens are designed at 390px wide. They **MUST** work from 320 to 480px with nothing overflowing (long names wrap or truncate, and amounts never wrap). Above 480px, centre a phone-width column (`--content-max`). There is no desktop layout.
- **Keyboard:** when the on-screen keyboard is open, the tab bar **SHOULD** hide and the focused input **MUST** stay visible (use `100dvh` and `scrollIntoView({block:'center'})`).

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
```
```json
// manifest.webmanifest (excerpt)
{ "lang": "he", "dir": "rtl", "display": "standalone", "orientation": "portrait",
  "theme_color": "#7B3FE4", "background_color": "#FFFFFF", "name": "Flow", "short_name": "Flow" }
```

---

## 5. Typography

- The font is **Rubik** (Google Fonts, OFL), loaded with `display=swap`, with `system-ui, sans-serif` as the fallback. Rubik has the ₪ glyph.
- **Weights** carry meaning. Text stays light, and weight is for titles, headers and buttons only:

  | Weight | Used for |
  |---|---|
  | 400 | Text: row names, row second lines, amounts in lists, details, captions, the card figure and the total |
  | 500 | Section and date headers, the band figure, primary and secondary buttons, chips |
  | 600 | Screen titles, detail names, sheet titles, empty-state titles |
  | 700 | The "Flow" wordmark only |

  You **MUST NOT** use 300, 800 or 900, and you **MUST NOT** fake bold.
- You **MUST** use only the roles below. There are no other sizes. If something doesn't fit, pick the nearest role and raise it in the PR. Each role is `--type-<role>-size | -line | -weight`, with a `.t-<role>` class. Line heights are set by the token file. [0181](../../docs/decisions/0181-redesign-foundation.md), the canvas Design guide.

| Role | Size / weight | Use | Colour |
|---|---|---|---|
| `band` | 52 / 500 | Home band figure only | `on-band` on the band, otherwise `text` |
| `detail` | 40 / 400 | Detail amount | `text` |
| `total` | 34 / 400 | List and summary total | `text` |
| `title` | 32 / 600 | Screen title; first-run hero titles | `text` |
| `card` | 28 / 400 | Card figure | `text` |
| `name` | 24 / 600 | Detail name, step titles, empty-state title | `text` |
| `sheet` | 20 / 600 | Sheet title | `text` |
| `section` | 20 / 500 | Section and date header: white, plain text, no caps, no grey label | `text` |
| `body` | 17 / 400 | Row name and body text | `text`; money in `income` |
| `btn` | 17 / 500 | Primary button | per component |
| `btn-2` | 16 / 500 | Secondary button, icon-row value | per component |
| `line2` | 15 / 400 | Row second line | `text-muted` |
| `meta` | 14 / 400 | Detail meta line | `text-muted` |
| `chip` | 14 / 500 | Chips, segments, avatar initials | per component |
| `caption` | 13 / 400 | Caption, dates, helper text, field labels | `text-muted` (`text-secondary` for field labels) |
| `cents` | 11 / 400 | Cents on a list amount, raised 5px | `text` |
| `wordmark` | 22 / 700 | The "Flow" logo only (LTR) | `on-band` on the band, otherwise `logo` |

- **Old names.** The old role names are aliases until their screens move to the new ones (R11 deletes them): `hero` → `band`, `display` → `detail`, `title-1` → `total`, `band-title` → `title`, `title-2` → `name`, `heading` → `sheet`, `title-3` → `btn`, `amount` → `body`, `label` → `line2`, `hint` → `caption`, `micro` → `cents`. New code uses the new names only.
- **Tabular digits:** every figure **MUST** use `font-variant-numeric: tabular-nums lining-nums` (the `.num` class does this), so columns and changing numbers don't jitter.
- **Line heights** come from the token file. Don't set `line-height: 1` on text. Allow multi-line text to wrap. Truncate with an ellipsis only on single-line row titles, and never truncate amounts.
- Input text **MUST** be at least 16px (`body`) so iOS doesn't zoom on focus.

```css
.hero-amount { font: var(--type-band-weight) var(--type-band-size)/var(--type-band-line) var(--font-family); }
```

---

## 6. RTL and numbers

### 6.1 Direction
- The root **MUST** be `<html lang="he" dir="rtl">`. Don't set `direction` in component CSS, except `dir="ltr"` on number spans, the wordmark and LTR inputs.
- You **MUST** use **logical CSS properties**. `flow.py` uses physical properties in places (`margin-right`, `left:14px`, `right:3px`), so port them to logical ones when you reuse them:

| Instead of | Use |
|---|---|
| `margin-left` / `margin-right` | `margin-inline-end` / `margin-inline-start` |
| `padding-left` / `padding-right` | `padding-inline-end` / `padding-inline-start` |
| `left` / `right` (positioning) | `inset-inline-end` / `inset-inline-start` |
| `text-align: left` / `right` | `text-align: end` / `start` |
| `border-left` | `border-inline-end` |
| `border-top-left-radius` | `border-start-end-radius` |
| `margin-right: auto` (push to the end) | `margin-inline-start: auto` |

In RTL, **start is right and end is left**. Flex rows lay out right-to-left automatically, so don't reverse them by hand.

### 6.2 Icons
The icons are 24-grid line icons (Feather-like) from `flow.py`: stroke 1.9–2.4, round caps, `currentColor`.

| Mirror in RTL (directional) | Don't mirror |
|---|---|
| Back and forward chevrons and arrows, "move", "transfer" arrows, logout, undo/redo, anything pointing along the reading direction | **+**, **✓** check marks, ✕, search, clock, calendar, bell, camera, upload/download (vertical), ▼/▲, ⋯, the ✦ spark, trash, doc, bank, the ▾ dropdown chevron (it points down) |

- The `flow.py` chevrons are **already drawn for RTL**. `back` points **right** (→ "go back") and `chev`, the forward or disclosure chevron, points **left**. Use them as they are and **don't flip them again**. If you bring in an icon drawn for LTR, mirror it with `.icon--dir { transform: scaleX(-1); }`, and only for the directional icons in the left column.
- The `logout` icon in `flow.py` is drawn LTR (arrow pointing right) and **SHOULD** be mirrored.

### 6.3 Numbers inside Hebrew (bidi isolation)
Every number **MUST** be wrapped in an isolated LTR span. This covers amounts with ₪, percentages, counts, dates, times, phone numbers, company numbers (ח.פ.) and codes such as P-14. Without it, the bidi algorithm reorders the minus sign, ₪ and % around Hebrew text.

```html
<span class="num">₪1,310,000</span>                         <!-- .num = dir ltr + unicode-bidi:isolate + tabular -->
<bdi dir="ltr" class="num">−₪10,000</bdi>                   <!-- equivalent -->
<bdi dir="ltr" class="num ui-income">+₪150,000</bdi>        <!-- money in: income green, with its plus (0181) -->
<p>רווחיות <span class="num">27%</span> · לפני <span class="num">3</span> ימים</p>
<p><bdi>פועלים_ספטמבר.xlsx</bdi></p>                          <!-- user text of unknown direction: <bdi> -->
```

**LTR inputs** (phone, amount, ח.פ.) use `dir="ltr"` and `inputmode`, and stay right-aligned so they match the Hebrew form. This is the one allowed physical `text-align`:
```html
<input dir="ltr" inputmode="tel" autocomplete="tel" style="text-align:right" aria-label="מספר טלפון">
```

### 6.4 Formats

| Kind | Format | Examples |
|---|---|---|
| Money | ₪ **before** the number, with no space, comma thousands separators, and whole shekels in summaries and lists | `₪200,000` · `₪8,500` |
| Money with agorot | Only on the transaction detail, review card and edit fields, and only when non-zero | `₪8,500.50` |
| Negative | True minus **U+2212 `−`** before the ₪, the whole thing in `bad` when it is a loss | `−₪10,000` |
| Explicit sign | `+` on money in (`income` green, decision 0181) and `−` on money out (`text`), in transaction rows | `+₪150,000` · `−₪12,000` |
| Percent | Whole number, `%` after, no space, inside `.num` | `27%` · `−17%` |
| Change | Arrow, then a space, then the absolute % in a change pill | `▼ 10%` · `▲ 8%` |
| Date, short (current year) | `DD/MM` | `22/09` |
| Date, full | `DD/MM/YYYY` | `21/09/2026` |
| Date range | `DD–DD/MM` with an en dash | `01–30/09` |
| Date, long (headings, lock screen) | Hebrew weekday and month names | `יום שלישי, 29 בספטמבר` |
| Month or period | Hebrew month name | `ספטמבר` · `רווח בספטמבר` |
| Relative (recent items) | `Intl.RelativeTimeFormat('he', {numeric:'auto'})` | `היום` · `אתמול` · `לפני 3 ימים` |
| Time | 24-hour | `18:00` |
| Phone and company number | Israeli grouping, LTR | `050-123-4567` · `51-234567-8` |

The week starts on Sunday. The Gregorian calendar is used throughout.

**Don't use `Intl.NumberFormat('he-IL', {style:'currency'})`.** It puts ₪ *after* the number, inserts bidi control marks and uses a hyphen-minus (`"‏‎-10,000 ‏₪"`). Also don't use the `he-IL` numeric date format, which gives `21.09.2026` with dots. Use the shared formatters instead:

```ts
// format.ts — the ONLY way screens turn numbers into text
const group = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const group2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MINUS = '\u2212';

/** agorot: integer amount in agorot (store money as integers, never floats) */
export function formatILS(agorot: number, opts: { sign?: boolean; agorotIfAny?: boolean } = {}): string {
  const shekels = agorot / 100;
  const showAgorot = opts.agorotIfAny && agorot % 100 !== 0;
  const rounded = showAgorot ? shekels : Math.round(shekels);   // round half away from zero for display
  if (rounded === 0) return '₪0';                                // never "−₪0"
  const body = (showAgorot ? group2 : group).format(Math.abs(rounded));
  const s = rounded < 0 ? MINUS : opts.sign ? '+' : '';
  return `${s}₪${body}`;
}
export const formatPct = (x: number) => { const r = Math.round(x); return `${r < 0 ? MINUS : ''}${Math.abs(r)}%`; };
const pad = (n: number) => String(n).padStart(2, '0');
export const formatDate = (d: Date, withYear = d.getFullYear() !== new Date().getFullYear()) =>
  `${pad(d.getDate())}/${pad(d.getMonth() + 1)}${withYear ? '/' + d.getFullYear() : ''}`;
export const formatLongDate = (d: Date) =>
  new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long' }).format(d); // "יום שלישי, 29 בספטמבר"
```
(Note: `Math.round(-2.5)` gives `-2`. If you need strict half-away-from-zero, use `Math.sign(x) * Math.round(Math.abs(x))`.)

---

## 7. Components

The components are the 19 parts of the [component inventory](../../docs/design/DESIGN-RULES.md#28-component-inventory-and-states) in DESIGN-RULES §2.8, in the same order (7.1 to 7.19). Each one is built once in the shared library, and screens compose it rather than restyle it. The Design canvas (Design guide, Ready for dev, Flow & motion) is the source for the look; the values below repeat it for the build. Parts that are not in the inventory are in 7.20 to 7.33, with the rules they keep until their screens move.

Where this section and the canvas disagree, the canvas wins.

### 7.1 Button
| Kind | Look | Use for |
|---|---|---|
| **Primary** | 52px pill, 17/500, `accent` fill, `on-accent` text | The one main action of the screen or sheet ("אישור", "שמירה", "המשך") |
| **Secondary** | 52px pill, 1.5px `tint-strong` outline, 16/500, `accent-text` text | Important alternatives, and the empty-state action (44px in the empty state) |
| **Link** | 44px text, 15/400, `accent-text`, optional left-pointing chevron | Low-emphasis actions in a row or a card ("שינוי", "דלג") |
| **Danger link** | As link, in the signal colour | "מחיקה", always confirmed or undoable |

States: default, pressed, disabled, busy, focus.
- **Pressed:** opacity .72 and, on primary and secondary, scale .985, over 120ms.
- **Disabled:** `disabled-bg` and `disabled-text`, with `disabled` or `aria-disabled` set.
- **Busy:** the same width, a spinner and the action's verb ("מאשר…"), `aria-busy`. The other actions on the screen are disabled.
- **Focus:** the 2px ring (see §9).

Do:
- Use exactly one primary per screen (or sheet or step). Where there are several choices, the others are secondary or link.
- Use full width at 24px sides for main actions, and stack them with 8px gaps.
- Keep labels short: a verb or noun of one or two words.

Don't:
- Put two accent-filled buttons on one screen.
- Make a button red-filled. A destructive confirm is `bad` text on `bad-tint`.
- Put a button inside the band.
- Use the 36px pill, the ghost or the old destructive variant in new screens. They stay only until their call sites move (REDESIGN-PLAN §2.2).

### 7.2 IconButton
- A 44px icon target, with a 24px icon. States: default, pressed (opacity .72 only), disabled, on-band.
- Every icon-only button has an `aria-label`.

### 7.3 ListRow
- **Flat** (`layout="flat"`): on the background, 20px sides, about 64px tall, a 36px initial circle, name 17/400, one grey line 15/400, the amount at the end. No dividers, no chevrons. Used for long lists (month lines, invoices).
- **Inset** (`layout="inset"`): a row inside a Card, 14px side padding, a 1px `line` divider between rows and not after the last.
- **Control:** none, chevron (inset only), radio, check, switch or value.
- States: default, pressed (opacity .72), selected, disabled (with a reason line), busy (a spinner at the end), pending (soft text), skeleton (FLOW-371).
- Motion: press 120ms; a row that leaves fades for 220ms and collapses.
- Don't add hairlines to a flat list, and don't add a chevron to a row that cannot open anything.

### 7.4 Card
- Radius 20 (`--radius-card`), 14 to 18px padding, `surface`, no border. `tone="tint"` gives the tinted problem box and the דורש טיפול block.
- A list stays flat. A card is for one focused item or a summary.
- States: default, pressed (only when the whole card is a link), tint. Press 120ms.

### 7.5 Amount
- The `role` sets the size: band 52/500, detail 40/400, total 34/400, card 28/400, list 17/400 with the cents at 11px, raised 5px.
- States: expense (U+2212 on the start side, in `text`), income (`income` green with a "+", and a visually hidden "הכנסה "), loss (signal colour, with a minus), muted (`$0`).
- Every amount is wrapped in `<bdi dir="ltr">`. Figures never count up.
- Green is only for money in, always with "+". A figure with a minus is never green. [0120](../../docs/decisions/0120-income-green-type-scale.md)

### 7.6 Band and ScreenHeader
- **Band** (`top-band.tsx`): the current or past month, from `#7B3FE4` to `#5A2DB0` (light and dark from the same tokens). Its figures fade with the scroll between 60 and 220px, with no timer. The band colour changes in 240ms.
- **ScreenHeader** (`screen-header.tsx`): with Back, with actions, or scrolled. Back is labelled with the kicker when there is one (`label` in `accent-text`, cut at about 16 characters) and there is no kicker line ([0156](../../docs/decisions/0156-labelled-back-and-compact-bar.md)). When Back goes to a page other than the kicker's, `backText` labels Back with that page and the kicker stays as a `hint` line above the title (FLOW-444).
- **CompactBar** (`compact-bar.tsx`, extends the 0156 bar and is never a second bar): once the large title scrolls off, it pins to the top, 44px on a list page and 56px on a detail page, over a `line` hairline. It shows Back, "title · figure" and the actions. It slides in 240ms ease-enter and out 240ms ease-exit, and at once under reduced motion. A compact title (the transaction) gets no compact bar.
- Don't add a kicker or an inline layout to a new screen. The options are kept only until their last screen moves.

### 7.7 OrganizeChips
- Chips group a screen's views or filters. One chip is always selected: the chips are not filters you can clear.
- Look: suggested (`tint` fill, ✦ in `accent-text`, optional hint), outlined choice (`surface`, 1px `control-border`), selected (`tint-strong` fill with an `accent` border, no ✓), disabled (`disabled-text`).
- Chips are 36px drawn, 14px inline padding, a full radius, a 44px hit area, and they wrap. Show at most about 4 chips, then "עוד…".
- Use `role="radiogroup"` with `radio` or `aria-pressed`. Don't use chips as navigation or as action buttons.
- The organize row sticks under the compact bar in a StickyPanel (240ms, with the compact bar). Chips change colour in 150ms.
- A read-only status is a ChangePill (7.16), not a chip.

### 7.8 Segment
- Use it to switch between 2 or 3 views of the same thing (נכנס / יצא, הוצאות / הכנסות).
- Look: a `raised` track with 4px padding and gap, 40px buttons. The selected segment has a `tint-strong` fill and `text`; unselected segments are `text-secondary`. No shadow, no 600 weight.
- States: one selected, pressed, disabled, busy, on-band. Motion 150ms.
- Use `role="tablist"` with `tab` and `aria-selected`, or a radio group. Don't use it for more than 3 options, for navigation, or with icons only.

### 7.9 Toggle
- A 46×28 track. `control-off` when off, `accent` when on. The knob is `knob`, with a faint shadow; the knob moves in 150ms ease-standard.
- States: on, off, disabled-on (a muted accent, distinct from an enabled off track), disabled-off (3:1 edge against the row), locked (`aria-disabled`), busy.
- The whole row is the control. Use `role="switch"` with `aria-checked` and the row's text as its label. The hint under the label states the current effect ("כבוי · מציג רווח לפני כלליות"), so the state never depends on colour.
- Use a toggle for settings that apply at once. Use a checkbox (24px, 7px radius, `accent` fill with a ✓ when checked) to select items in a list.
- **The overhead switch ("אחרי חלק בכלליות") is OFF by default** everywhere. You **MUST NOT** turn it on by default or remember it on without the user choosing it ([0022](../../docs/decisions/0022-after-overhead-starts-off.md)).

### 7.10 IconRow
- An icon row (`icon-row.tsx`): a 24px outline icon in `text-secondary`, a label 13 in `text-muted`, the value 16/500 in `text`, 12px block and 14px inline padding, 12px gap, at least 44px high. The accessible name is "label value" (or `name`).
- The end is a chevron (default; `onClick` opens a sheet) or a text link action (`action`, "שינוי"). A switch row has no chevron. A busy row shows a spinner in the chevron slot. A static row (a read-only fact) has no end.
- An accent value marks an empty prompt.
- States: default, pressed (opacity .72, 120ms), focus, busy, disabled, static, value changed (the undo toast, 7.12).

**Counted-in row and sheet** (spec, built in FLOW-366 for the line and FLOW-513 for the category; FLOW-363 (4) wrote it down):

The row is an IconRow with `ChartIcon`, the label "נספר ב" and a chevron. Its value is "רווח ותזרים" (both on), "תזרים בלבד · <reason>", "רווח בלבד · לא בתזרים", or "לא נספר". The value is `text` when both are on, otherwise `accent-text`. [0170](../../docs/decisions/0170-pnl-follows-company-basis.md)

- **Line sheet:** surface, padding 10 16 28, gap 10. Title "איפה השורה נספרת" (sheet title, 20/600). ✕ is a 44px target with a 22px glyph in `text-secondary`. Two switch rows, each on `raised`, radius 14, min-height 64, padding 10 14: "נספר ברווח" (sub: the P&L reason) and "נספר בתזרים" (sub "כסף שזז בבנק. כבוי רק להעברות בין החשבונות שלך"). Footer 13 in `text-muted`: "רק השורה הזו. הקטגוריה לא משתנה."
- **Line toasts:** "הוצא מהרווח", "נספר ברווח", "הוצא מהתזרים", "נספר בתזרים".
- **Category row:** label "נספרת ב", on `raised`, radius 16, min-height 60, padding 12 14, value 17/400. Copy: "רווח ותזרים", "תזרים בלבד · הוצאה מהרווח", "תזרים · שיפוץ, לא ברווח החודשי", or "לא נספרת".
- **Category sheet:** title "איפה הקטגוריה נספרת", sub "חל על כל N התנועות של <name>". Three switches: "נספרת ברווח", "נספרת בתזרים" and "נספרת בשיפוץ" (expense only). The knob side is opposite to the line sheet's (open question 12 in FLOW-363).
- **Decided:** switches, not three choices, because the board frames in use draw switches (0170). Open values with no token or role are in the design log.

### 7.11 Sheet
See the template in §3.3. The family is three parts:
- **Sheet** (`sheet.tsx`): a bottom sheet with a grab handle, a title, ✕ and a scrim. It has one primary action. Use `role="dialog"`, `aria-modal="true"` and `aria-labelledby` pointing at the title.
- **ChoiceSheet** (`choice-sheet.tsx`, from `radio-sheet.tsx`): option rows. Tapping an option applies it and closes the sheet, so there is no confirm button. The currency, basis and pace sheets are ChoiceSheet calls.
- **ConfirmSheet**: the question as the title, the item as the subtitle, one line on the consequence, the primary action and a quiet "ביטול". Details are in 7.28.

States: open, closing, busy (a save in progress), refusing (an incomplete change, with ביטול השינוי beside the sentence that says why). Motion: in 280ms ease-enter; out 220ms ease-exit; the scrim 260ms; drag down to close.
- ✕, scrim, swipe and Android back save a valid pending change, then close. An incomplete change stays open. A second dismiss discards it. A dismiss during a save waits for the save, then closes ([0075](../../docs/decisions/0075-save-on-tap-and-on-leave.md)).
- Focus moves into the sheet when it opens and returns to the trigger when it closes. Don't stack sheets. A second sheet replaces the first, or the task becomes a screen.

### 7.12 Toast
- A single line above the bottom bar, 16px sides, one at a time. Its look is `toast-bg` and `toast-text` (inverted per mode), a 14px radius and `label` text. A confirmation has no icon.
- **Undo toast:** 3 seconds with ביטול (a link in the toast's action colour, weight 500). The timer pauses while the toast has focus or is touched.
- **Failure toast:** the 4 seconds with an icon in `toast-bad`, and "שוב" or "ניסיון חוזר" when there is a retry. The failure toast stays for failures that need the user ([0180](../../docs/decisions/0180-instant-tap-notify-on-failure.md)). The timer is `OK_MS` in `toast-layout.tsx`.
- States: ok (with or without ביטול), failure, info. Motion: in 200ms rising from above the bottom bar; out 160ms.
- Use `role="status"`. Every action that shows an undo toast **MUST** be undoable for those 3 seconds: approve, move, delete, mark as paid. Commit on the server optimistically, and revert if the user taps ביטול.
- Don't use a toast for errors that block the user (use the field or the error pattern, 7.29), or for long messages.

### 7.13 Field family
Five components: `text-field.tsx`, `money-field.tsx` (money and percent: the ₪ and % affixes keep their place), `select-field.tsx`, `code-field.tsx` and `search-field.tsx`.

- **Text, money and select fields:** 48px high (`--field-height`), a 1.5px `tint-strong` border, a 12px radius, `raised` background, 14px side padding, body 17/400. The label sits above in caption role, `text-muted`, with a 6px gap. The label is always visible. A placeholder never replaces it. Placeholders are `text-muted` and start with "למשל:".
- **States:** default, focused (accent border; no ring; border transition 150ms), filled, error (the border stays as drawn; the message under the field is `signal-soft` and carries the error; the message line is reserved, so the layout does not move), disabled (disabled tokens), read-only (the text in `text-muted` on the same box), busy (a spinner at the end, FLOW-371).
- Validate on blur and on submit, not on every keystroke. Link the message with `aria-describedby`, and set `aria-invalid="true"`. A connect or setup form checks required fields on submit, before any request, and the message sits on the field's reserved line.
- Amounts use `inputmode="decimal"` with the ₪ or % shown as an affix inside the field. Numbers are LTR (see §6.3). Use the right `inputmode`, `autocomplete` and `enterkeyhint`.
- **Code field:** the value is 13px monospace, read-only, LTR, on a `line` border. The copy is a "העתקה" pill (36px, chip role, `accent-text` on `tint`) in a 44px hit area at the end, on one line. The value keeps its end clear of the button.
- **Search:** a 44px pill on `raised`, no border. An 18px icon in `text-muted`, input 17/400. The focus is the global ring on the pill. Busy: an 18px spinner after the input, the clear button hidden, and `aria-busy` on the box. Filter as the user types, debounced by about 150ms. A ✕ clear button shows once there is text (`aria-label="ניקוי"`). With no results, use the empty state: "לא מצאנו ״<query>״", and a "ניקוי החיפוש" button.
- Money and percent share the text field's box. The percent field is `money-field` with a % affix; there is no separate percent component.

### 7.14 ConnectionPage
Spec, built in FLOW-512 for SUMIT, Mercury and MCP (`connection-page.tsx`). FLOW-363 (4) wrote it down. It composes the page header, StepList (`ui-install-num`), the problem box, a TextField with show and hide, a CodeField, the primary and secondary Button, and facts rows. States: new, connecting (busy), connected, problem (the key stopped working), error (one line with נסו שוב). Motion: page enter.

- **Page and header:** padding 12 16 28 (the app's side is 20). Back is 16/500 in `accent-text` with a 44px target and a 20px chevron. The title is 32/600 with line-height 1.2. The subtitle is 15 in `text-muted`. Content gap 14.
- **Steps:** the section head is 15/500 in `text-secondary`. The card is `surface`, radius 16, padding 16, gap 10. A step is 15 with line-height 1.5. The number circle is 22, radius 11, `tint` background, `accent-text`, 12/500.
- **Problem box:** padding 14, radius 14, `tint` background, 15 with line-height 1.5. The copy comes from the connection's broken text, as `connect-sheet.tsx`'s authReconnect lead did.
- **Show and hide:** "הצגה" and "הסתרה", 36px high, padding-inline 10, radius 10, `tint`, `accent-text`, 14/500 (`--type-chip`).
- **Copy:** the CodeField with its "העתקה" pill (7.13).
- **Connect button:** the primary Button, 52px pill. Disabled uses `disabled-bg` and `disabled-text`. Label "מתחבר…" while busy, otherwise "חיבור מחדש" or "חיבור".
- **Connected:** facts rows min-height 44, 15 text, label in `text-secondary`, a line divider, card padding 6 16. A secondary Button, 52px. "החלפת מפתח API" is 15/400 in `accent-text`. "ניתוק" is 15/400 in `signal-soft`.
- **Motion:** push 280 in and 220 out. Page enter 280 with an 8px rise and a 40ms stagger. Press opacity .72 and scale .985. Reduced motion turns everything off.
- **Values with no token or role (open question 10 in FLOW-363):** `#3A3350` (secondary border and category switch off), `#6A627A` (disabled text), the section head 15/500, the step number 12/500, the side padding 16, and the card radius 16. They are recorded in the design log, not in tokens.

### 7.15 SwipeRow
- A row that swipes to reveal one action (`swipe-row.tsx`, from `swipe-remove.tsx`). The action is "התעלמות" in signal-colour text, with no fill.
- States: rest, revealed, leaving. A leaving row fades in 220ms and collapses, and the undo toast (7.12) offers ביטול.

### 7.16 ChangePill and StatusDot
- **ChangePill** (`change-pill.tsx`): the change against last month, "▼" or "▲" with the absolute %, in `text`/`good`/`bad` on the band or off it. Off the band it is text: neutral when it helps, `signal` when it hurts. On the band a helping change is a `pill-helps` fill and a hurting one a `pill-hurts` fill, white text, in chip type (14/500). `upHurts` swaps the tones for an expense. Words for screen readers: `aria-label="ירידה של 10% מהחודש שעבר"`.
- **StatusDot** (`change-pill.tsx`): a status is coloured text in role meta (14/400), never a filled chip. With a dot (6px, hidden from readers), the words stay `text-secondary` and the dot takes the tone: `accent-text`, or `signal-soft` for signal. Tones: neutral, accent, signal.
- The change pill on the page uses a `tint` background only where it is a control; otherwise it is text.

### 7.17 ProgressBar
- Thin bars, 6 to 8px (`--bar-thin`), rounded to `--radius-chip`: a value bar, a two-part split bar (budget), and the 8px job bar of FLOW-371.
- States: value, split, indeterminate (the sync strip, FLOW-371). A split stops at 100% in `bad` and states the overage in words (decision 0060).
- Motion: the fill grows from the right on enter (`m-bar-grow`, 480ms); widths ease `--motion-width` with ease-standard.

### 7.18 TabBar
- Five slots, 64px wide each, in this order from the right: בית · פרויקטים · **+** · לאישור · הגדרות. The + is a 48px `accent` circle in the middle, and it opens the Add sheet (`aria-label="הוספה"`). The place of + is settled by the FLOW-364 brief against the canvas.
- Icons are 24px and labels are `micro`. Inactive items are `text-muted`; the active item has an `accent-text` icon and label. Use `aria-current="page"` on the active item.
- The badge on לאישור shows the waiting count: `badge-bg` and `badge-text`, fully round, 17px minimum, `micro`, at the icon's top end corner. Its accessible name reads the count ("לאישור, 7 ממתינים"). It is hidden at 0 and shows "99+" above 99.
- States: active, pressed (+ and the items: opacity), badge. Motion: tab colour 120ms; content crossfade 150ms; no slide.
- Don't add a fifth tab, text-only tabs, or a red badge.

### 7.19 Page transitions
- `usePageEnter` and `PushPage`. A page enters with its content rising 8px and fading in over 280ms, with the first blocks staggered 40ms. A push to a detail page slides 280ms from the left; going back is 220ms.
- States: entering, entered, going back. Under reduced motion the end state shows at once.

---

Parts that are not in the inventory keep these rules until their screens move. A part that a screen PR removes is deleted in that PR.

### 7.20 Period pill
- The period pill is a tinted, fully round pill, 32px high, with the label (e.g. "החודש") followed by a ▾ chevron in `accent-text`. Pressed state is `tint-pressed`.
- On the band it uses `band-pill`: **white in light mode, `#1E1929` in dark mode**, with `text` inside.
- Tapping it opens the period sheet (§7.27, `16-period-sheet`): החודש, חודש קודם, מתחילת השנה, and טווח מותאם (opens the range picker, §7.26). Add more presets only with design. The choice updates every figure on the screen, and the hero label **MUST** name the period ("רווח בספטמבר").

### 7.21 Pending card
- This is **the one tinted block on Home**. It is `tint` with a 16px radius and a 16px inset.
  - Inbox icon in `accent-text` on the start side.
  - Title in `body`/17px: "7 פריטים ממתינים לאישור".
  - Hint line: "3 חשבוניות פתוחות · ₪23,400".
  - Disclosure chevron on the end side in `text-muted`.
- Pressed state is `tint-pressed`. Tapping it goes to **03 Review**.
- When there are 0 pending items and 0 unpaid invoices, **hide the card**. Don't show "0 items".
- Don't add a second tinted card to Home.

### 7.22 Project row
- **Name** (17/400, the row title) and **margin** below it (`meta`: "רווחיות 27%") on the start side (right). **Profit** (`amount`, 17/400, whole units) on the end side (left). Rows have no hairline (decision 0120); they are separated by 14px vertical padding.
- A **loss** shows in `bad` **with a minus sign** (`−₪10,000`), and the margin is shown with a minus too ("−17%"). A profit is `text`, **never green**.
- The pressed state is a `tint` background with a 12px radius that bleeds 12px past the text. Tapping the row opens **02 Project**.
- The secondary line MAY be the client name instead of the margin (05 Projects).

### 7.23 Transaction row
- A **grey source icon** (`text-secondary`) on the start side: `doc` for an invoice, `bank` for a bank line.
- The title is the vendor or payer (`body`). The hint below shows category and date ("חומרים · 22/09").
- The **amount** is on the end side in `amount` (17, weight 400), **with cents** drawn small and raised, ".00" included (`₪150,000.00`); this replaces §11.3's whole units for transaction rows only. An expense is `text` **with its minus** (`−₪12,000.00`). Money in is `income` green **with a `+`** (decision 0181), preceded by a visually hidden "הכנסה ", so direction is never colour alone. A figure with a minus is never green. [0120](../../docs/decisions/0120-income-green-type-scale.md)
- Rows have **no hairline** (any list, decision 0120), and month groups are 32px apart. The title is 17/400. The month head is `heading` with no rule; its income total is `income` green with a `+`.
- Tapping a row opens **10 Transaction detail**.

### 7.24 Empty state
See §8.2.

### 7.25 Link rows and text links
- "לכל הפרויקטים ‹", "תנועות אחרונות ‹": `label` text with a forward chevron.
  - Use `accent-text` for the main next step.
  - Use `text-secondary` (`.lnk.q`) for quiet "see all" links.

### 7.26 Date picker
Screens: `15a-date-field` (the field), `15b-date-single`, `15c-date-range`. Board: `ds-8-pickers-sheets`.
- **The field:** a normal text input (§7.13) showing `dd/mm/yyyy` (LTR number, §6.3) with a calendar icon on the end side. Tapping anywhere on it opens the sheet. Don't allow free typing on phones.
- **The sheet** (§3.3): title ("תאריך ההוצאה"), quick chips, then the month header, then the grid, then one primary button at the bottom ("בחירה").
  - Quick chips (choice style, §7.7): **single** היום / אתמול. **Range** החודש / חודש קודם / מתחילת השנה. A chip fills the value, and it's highlighted only while the value matches it.
  - Month header: "ספטמבר 2026" (Hebrew month names) between ‹ › buttons, each 44px. In RTL the *previous* month is the right arrow. *Next* is disabled in the current month.
  - Grid: **Sunday first, on the right**. Weekday row א׳ ב׳ ג׳ ד׳ ה׳ ו׳ ש׳ in `hint` / `text-muted`. Cells are 44px high with 40px circles and tabular digits.
  - Day states: **today** has a 1.5px `accent-text` ring with `accent-text` digits. **Selected** has an `accent` fill with `on-accent` digits. **Range** start and end are `accent` circles, with a `tint` strip between them (the start connects towards the end, using logical `inset-inline`). **Future** days use `disabled-text` and are not tappable (transactions and reports can't be in the future).
  - Single: under the grid, the chosen date in words ("יום שני, 21 בספטמבר 2026"). Range: two small fields above the grid ("מתאריך" / "עד תאריך"); the one being set is focused. The button names the result ("הצגת 12 ימים").
- **Accessibility:** use `role="grid"`. Each day has `aria-label="יום שני 21 בספטמבר 2026"`, plus `aria-selected` and `aria-current="date"` for today. Arrow keys move by day and PageUp/PageDown by month, mirrored for RTL.

### 7.27 Period sheet
Screen: `16-period-sheet`. It opens from the band's period pill.
- Option rows show the name and its dates in `hint` ("ספטמבר 2026"), with a radio on the end side. The radio is a 22px circle with a `control-border` outline, or an `accent` fill with a ✓ when selected.
- Tapping an option **applies it and closes the sheet**, so there is no confirm button. The last row, "טווח מותאם" (calendar icon and chevron), closes this sheet and opens the range picker (don't stack sheets).
- After a change, every figure updates and the hero label names the period (§7.20).

### 7.28 Confirmation sheet
Screens: `20-confirm-delete`, `21-confirm-archive`, `22a-merge-pick` → `22b-merge-confirm`, `23-confirm-hide`.
- A short bottom sheet: the **question as the title** ("למחוק את ההוצאה?"), the item as the subtitle, **one line about the consequence** (and whether it can be undone), then the primary action and a quiet "ביטול" (ghost, `text-secondary`).
- **Destructive** (delete): `bad-tint` fill with `bad` text and a trash icon (`.btn.dngs`), never a solid red block. After confirming, show the undo toast (§7.12).
- **Reversible** (archive, hide): the primary accent button. The line says how to get the item back ("אפשר להחזיר מ״מוסתרות״").
- **Multi-step** (merge a category): step 1 picks the target from option rows (§7.27 radios), with "שלב 1 מתוך 2". Step 2 shows *from → to* chips, "21 תנועות יעברו ל״ציוד והשכרה״" and two ✓ lines about what happens next, then "מיזוג" and "חזרה".

### 7.29 Error pattern
Screens: `er-01-bank-file`, `er-02-invoice-blurry`, `er-03-google-cancelled`, `er-04-google-failed`, `er-05-save-failed`.
- **Tone:** say what happened, that nothing was lost, and give **one** action. No red blocks. Red (`error`) appears only on a field border and its one-line message, or on the icon of a note.
- **Wrong file** (not a Poalim Excel): full-screen empty-state layout. The file name goes in an outlined chip (`<bdi>`), the title is "זה לא דוח מפועלים", one line names the expected file, the primary action is "בחירת קובץ אחר", plus a quiet help link.
- **Unreadable photo:** a blurred thumbnail, "החשבונית לא ברורה", one tip (light, flat, filling the frame), a "צילום מחדש" primary, and a quiet "הזנה ידנית" link.
- **Google sign-in** (same layout as 09a, with a note card above "כניסה או הרשמה"; the Google button itself is the retry, §7.33):
  - *Cancelled* (`er-03`, the user closed the Google window, `popup_closed` / user cancel): a neutral `tint` note with an `accent-text` info icon, "הכניסה לא הושלמה" / "החלון של Google נסגר. אפשר לנסות שוב." It is not treated as an error.
  - *Failed* (`er-04`, no connection, Google error, or the account couldn't be verified): the same note with the icon in `bad` (4.8:1 / 6.6:1 on tint) and text in `text` / `text-secondary`, "לא הצלחנו להתחבר" / one line suggesting checking the connection, plus a quiet "צריך עזרה בכניסה?" link.
  - Never show Google's error codes. Keep the note until the next attempt starts.
- **Save failed:** the form keeps every value, and the error toast shows above the button ("לא נשמר – אין חיבור" · "ניסיון חוזר"), with the icon in `toast-bad`.

### 7.30 Install prompt (PWA)
Screens: `17a-install-android`, `17b-install-iphone`.
- Offer it after the first successful report, **not on first launch**, and at most once a week after "לא עכשיו".
- **Android / Chrome:** the S1 app icon (white Rubik F on band violet, 72px, 18px radius; §7.32), "התקנת Flow", one line, three benefit rows, then "התקנה" (calls the saved `beforeinstallprompt`) and a quiet "לא עכשיו".
- **iPhone / Safari** (no install API): three numbered steps, each with the Safari icon in a `tint` tile (share, then add-square), a hint pointing down at the Safari toolbar, and "הבנתי". Detect standalone mode and never show the prompt inside the installed app.

### 7.31 Overhead breakdown (switch on)
Screens: `18-home-overhead-on`, `19-project-overhead-on`.
- **Project:** the band hero becomes "רווח אחרי כלליות · רווחיות 16%" (display 36). Under the switch ("פועל · לפי חלק הפרויקט בהכנסות"), an "איך מחושב" section shows three rows: before overhead, the share (with "21% מההכנסות של כל הפרויקטים" as a hint and a minus sign), and the semibold total.
- **Home:** the hero stays the company's net profit. The band's two small figures become "לפני כלליות" and "כלליות −₪…". Project rows show profit after the share, with a quiet "אחרי חלק בכלליות" beside the section title.
- The share is `overhead × project income ÷ income of all active projects` for the selected period. Round only for display.

### 7.32 Logo and app icon
- **Wordmark:**
  - Set as live text "Flow" in `.t-wordmark` (Rubik 700, 22/1.2, letter-spacing −0.01em) with `dir="ltr"`. The coloured-band header uses `color: var(--color-on-band)`. Everywhere else, use `color: var(--color-logo)` (#7B3FE4 light, #B894FF dark).
  - Where live text isn't possible (splash, emails, docs, marketing), use the outline SVGs in `design/logo/wordmark/`. **Don't** retype the wordmark in another weight or font, and don't use `accent-text` for it.
- **App icon (S1):** the Rubik 700 F on a violet `band` tile, white F, the F at 50% of the tile height.
  - In the UI, use the inline SVG from `flow.py` (`appic(px, radius)`, `APP_F_PATH`) and give it `role="img"` with `aria-label="Flow"`. The install prompt uses 72px with an 18px radius; notifications use 38px with a 9px radius.
  - For the PWA, use `design/logo/pwa/`: `manifest.webmanifest` icons (any, maskable, monochrome), `apple-touch-icon.png` (180), and `favicon.ico` / `favicon.svg`. Set `theme-color` to #7B3FE4.
  - **Don't** redraw the F, add effects, or scale the ≤48px PNGs up. The small PNGs are pixel-snapped.
- Clear space, minimum sizes and the list of don'ts are in `design/logo/LOGO.md` and `flow-logo-usage.png`. Decision 0031.

### 7.33 Sign in with Google
Screens: `09a-onboarding` (sign-in), `er-03-google-cancelled`, `er-04-google-failed`; board 8. Google is the **only** sign-in method in the POC (no phone number, no one-time code, no password).
- **Layout (09a):** status bar only (no top bar, no progress row). The wordmark (44px, `logo`) and one value line ("הרווח וההפסד של העסק, בלי אקסלים") sit in the upper third. The bottom block holds "כניסה או הרשמה" (title-2), "בלי סיסמה – עם חשבון Google שכבר יש לך", the button, and a hint-size privacy line: "נקבל מ־Google רק שם ואימייל. אין לנו גישה לתיבת הדואר." with underlined links to the terms and the privacy policy.
- **Button (follow Google's sign-in branding guidelines):**
  - Light theme in **both** modes: `gsi-bg` #FFFFFF fill, 1px `gsi-border` #747775 stroke, `gsi-text` #1F1F1F. Don't recolour it in violet or tint it for dark mode.
  - The standard four-colour "G" at 20px, unmodified, on the start side (the right in RTL), 12px gap to the text. Pill shape, 52px high, full width.
  - Text exactly "המשך עם Google" in Roboto Medium 16px; Roboto has no Hebrew, so the Hebrew falls back to Rubik. Don't shorten it or use only the "G".
  - Prefer Google Identity Services' rendered button (`google.accounts.id.renderButton` with `theme:"outline"`, `shape:"pill"`, `text:"continue_with"`, `locale:"he"`, `width` = the column width). Use the custom HTML button above only if the rendered one can't fit, keeping the exact spec.
- **States:** default; pressed = 12% #1F1F1F overlay; focus = the app focus ring (2px `bg` gap + 2px `focus`); loading while the Google window is open = spinner in place of the G and "מתחברים…", button not tappable; disabled (offline before tapping) = 38% fill and text, 12% stroke.
- **After sign-in:** a new account goes to 09b (company details). A returning account goes straight to Home. Use the Google name only as a greeting ("בוקר טוב, אלירן").
- **Errors:** see §7.29 (`er-03`, `er-04`).

---

## 8. States every screen must handle

Each screen spec and PR **MUST** show all of these states in **both light and dark** mode. The visual reference is the `ds-7` board plus the per-screen `es-*` (empty) and `ld-*` (loading, busy and offline) screens in this folder, and `overview-states-*`. The file names are listed in §13. These were still being rendered when this guide was written, so if a PNG is missing, open the matching `.html`.

### 8.1 Loading
- **Content loads with skeletons, not spinners.** Skeletons are blocks in the **exact layout** of the content that will replace them: same heights, radii and line lengths.
  - They use `--color-skeleton`, with a soft `--color-skeleton-shine` sweep (§10).
  - Text lines are 10–14px tall bars with fully round ends; amounts are shorter bars; cards are 16px-radius blocks.
- The band on Home and Project **renders immediately** in its real colour and shape. Its interactive chrome is real from the start: the wordmark, the period pill, and the back and ⋯ buttons. The labels and figures are skeleton bars in `on-band` at low opacity (about 25%), which is the one exception to the "no opacity tricks" rule. Static section heads, such as "פרויקטים מובילים", render as real text. See `ld-01-home-skeleton`, `ld-02-project-skeleton` and `ld-03-list-skeleton`.
- Show skeletons only if loading takes longer than **300ms**, to avoid flashes. If cached data exists, show it at once and refresh quietly (stale-while-revalidate). Never blank a screen that already had data.
- **Actions** (save, approve, upload) show a **spinner inside the button** (`ld-04-button-loading`).
  - The button shows a small spinner, 18px in its text colour, plus a progressive label ("אישור" becomes "מאשר…").
  - It keeps its width and colour, becomes non-interactive and gets `aria-busy="true"`.
  - The other buttons for the same item are disabled while it runs.
  - Don't show a full-screen blocking spinner.
- **Long processes** get a dedicated screen: reading an uploaded bank report (`ld-05-upload-processing`) and reading a photographed invoice (`ld-06-invoice-reading`).
  - Show a determinate progress bar (the `.prog` style) with "שלב X מתוך Y" and the step names.
  - Fill in results as they arrive.
  - Offer a way out: "המשך ברקע" (continue in the background) for uploads, or "ביטול" for invoices.
- **Pull to refresh** on Home and lists keeps the content in place and shows a small spinner at the top (`ld-07-pull-to-refresh`). It never replaces the content with a skeleton.
- Use `aria-busy="true"` on the loading region, with a visually hidden "טוען…".

### 8.2 Empty
- Use the empty-state layout from the Design canvas (Design guide):
  1. A **muted icon** (40–44px, `text-muted`).
  2. A **short title** (`title-3`).
  3. **One line** of text (`hint`).
  4. **One secondary button** (small pill) that gives a way forward.

  Centre it in the content area. Don't use illustrations, emoji or a primary button.
- Write each screen's empty state specifically:

The rendered empty states and their copy:

| Screen (board) | Title / line / action |
|---|---|
| Home, first run (`es-01-home-first-run`) | Band with the placeholder "כאן יופיע הרווח הנקי של העסק". Body: "עוד אין נתונים" / "מעלים דוח Excel מאפליקציית פועלים, ובונים ממנו רווח והפסד תוך דקה." / "העלאת דוח בנק" |
| Project, no transactions (`es-02-project-empty`) | Header shows `₪0`. "אין עדיין תנועות" / "חשבוניות ותשלומים שישויכו לפרויקט הזה יופיעו כאן." / no button (FLOW-331: capture is not built) |
| Review, all done (`es-03-review-done`) | "הכל מאושר" / "אין פריטים שמחכים לך. נעדכן כשיגיע משהו חדש." / "לדף הבית" |
| Projects, none (`es-04-projects-none`) | "עוד אין פרויקטים" / "פרויקטים נפתחים מעצמם כשמזהים לקוח חוזר בדוח הבנק. אפשר גם לפתוח ידנית." / "פרויקט חדש" |
| Unpaid, none (`es-05-unpaid-none`) | "הכל שולם" / "אין חשבוניות פתוחות כרגע." / no button (nothing to do) |
| Search, no results (`es-06-search-none`) | "לא מצאנו ״…״" (echoes the query) / "אפשר לחפש לפי שם הפרויקט, הלקוח או הקוד (P-12). גם פרויקטים שהסתיימו נכללים." / "ניקוי החיפוש" |
| Categories, income tab (`es-07-categories-income`) | "אין קטגוריות הכנסה" / one line explaining the default / "קטגוריה חדשה" |
| Notifications off (`es-08-notifications-off`) | "אין התראות" / "ההתראות כבויות. נשלח רק שתיים: …" / "הפעלת התראות" |

The button is optional when there is truly nothing to do (Unpaid). Otherwise there is exactly one, and it is secondary.

- A **period with no activity** is a partial state, not an empty screen: show `₪0` figures and hide the change pill (see §8.4).

### 8.3 Error and offline
- **Offline or load failed, with nothing cached** (`ld-08-offline`): show an inline block in the content area, with the same layout as the empty state.
  - Muted icon and the title "אין חיבור לאינטרנט". For a server error, use "לא הצלחנו לטעון".
  - One reassuring line: "בדקו את החיבור ונסו שוב. שום דבר לא נמחק."
  - A secondary **"ניסיון חוזר"** button that retries.
  - Keep the tab bar. Never show raw error codes or English.
- **Offline with cached data** (`ld-09-offline-cached`): keep showing the cached data, including the band.
  - Add a quiet one-line notice under the band or header: "אין חיבור · נתונים מ-09:12", with a "ניסיון חוזר" link.
  - Retry automatically when the connection returns (`online` event).
- **While offline** (the app shell and last data MUST work offline through the service worker):
  - Disable actions that need the network (disabled style, with the reason given on tap).
  - Queue approvals if the backend supports it. The toast then says "יישלח כשהחיבור יחזור".
- **Action failed:** the button leaves its busy state and an error toast shows ("לא נשמר", with "שוב"), as on the Design canvas. Form errors show at the field (§7.13). Destructive actions that fail restore the item.
- **Upload failed or unreadable file:** use the error pattern (§7.29): `er-01-bank-file` for a wrong or non-Poalim file, `er-02-invoice-blurry` for a photo that can't be read. Google sign-in cancelled or failed: `er-03` / `er-04`. Save failed: `er-05`.

### 8.4 Partial data
Screens **MUST** stay honest and calm when data is incomplete:

| Situation | Behaviour |
|---|---|
| No previous period to compare | Hide the change pill. Show the hint "אין נתונים לחודש הקודם" instead. |
| Change rounds to 0% | Show a neutral pill "0%" in `text`, with no arrow and no red or green |
| Income = 0 (margin undefined) | Show the margin as "—" (don't show "0%", "−∞" or NaN) |
| Profit is exactly 0 | `₪0` in `text`, with no sign |
| Only a bank report, no invoices yet | Show figures from the bank data, with the hint "לפי דוח הבנק בלבד" |
| Items still pending | The figures exclude them, and the pending card says so. Don't silently include unconfirmed items. |
| Unpaid invoices | Show them separately with the note "לא נכלל ברווח" (as in 12 and 08) |
| Fewer than 3 projects on Home | Show what exists and don't add placeholder rows. With 0 projects, hide the section. |
| Budget not set | Hide the budget block. Offer "הוספת תקציב" in the ⋯ menu. |
| Long names | Row titles truncate to one line with an ellipsis. Project and page titles wrap to two lines at most. |
| Very large numbers | Never abbreviate. The hero steps down to `display` if it doesn't fit (§11.3). |

### 8.5 Interaction states
Every interactive element **MUST** implement all of these:

| State | Look |
|---|---|
| **Pressed** | `:active` styles from the Design canvas (`accent-pressed`, `tint-pressed`, or a `tint` wash on rows). Instant on touch, with a 100ms transition. |
| **Disabled** | `disabled-bg` / `disabled-text`. Set `disabled` or `aria-disabled`. Where the reason isn't obvious, give it in a hint. |
| **Focus** | A visible focus ring on `:focus-visible` (§9) |
| **Selected** | As defined per component (chip, segment, tab) |
| **Busy** | Spinner in the button (§8.1) |

Remove the grey tap highlight with `-webkit-tap-highlight-color: transparent` **only** if the pressed styles are implemented.

---

## 9. Accessibility

- **Contrast:** all text **MUST** meet **WCAG AA 4.5:1**. Check any new pairing against WCAG AA before you use it, and don't put `text-muted` on `tint-pressed` or on the band.
- **Focus rings:** use `:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }`, which is 7:1 or better on the page. **Inside the band** use `--color-focus-on-band` (white). Rounded elements keep their radius. Never write `outline: none` without a replacement.
- **Language and labels:** set `lang="he"` on `<html>`. Every input has a visible Hebrew `<label>`. Accessible names are in Hebrew. Put `lang="en"` on English fragments (e.g. "Example data").
- **Icon buttons** **MUST** have Hebrew `aria-label`s:

  | Icon | Label |
  |---|---|
  | back | "חזרה" |
  | ✕ | "סגירה" |
  | ⋯ | "עוד פעולות" |
  | + | "הוספה" |
  | clear | "ניקוי" |

  Decorative icons next to text get `aria-hidden="true"`.
- **Colour is never alone:**
  - Loss: minus sign plus red.
  - Change: arrow plus colour, plus words for screen readers.
  - Errors: message plus red border.
  - Selected: check mark plus fill.
  - Switch state: stated in its hint.
- **Structure:** one `<h1>` per screen (the page title, or the band's main label on Home). Section heads are `<h2>`. Lists are `<ul>` or `role="list"`. The tab bar is `<nav>` with `aria-current`. Sheets are dialogs (§7.11). Toasts use `role="status"`.
- **Amounts for screen readers:** amounts read correctly as "₪10,000". Losses **SHOULD** add visually hidden context ("הפסד של").
- **Targets and zoom:**
  - Targets are at least 44×44 (§4).
  - Type is set in `rem` (tokens do this), so text scales.
  - Layouts **MUST** survive 200% text zoom without clipping amounts.
  - Don't disable pinch-zoom.
- **Reduced motion:** honour `prefers-reduced-motion` (§10).
- **Timing:** the 4-second toast pauses while it has focus. Undo stays reachable by keyboard and screen reader.
- **Non-text contrast (WCAG 1.4.11), resolved:** switch tracks, knobs, checkbox and radio borders, input and search borders, outlined chips and the Google button stroke are all ≥ 3:1 (`control-off`, `control-border`, `knob`, `knob-on`). Check them against 3:1 by hand. Checkboxes and switches still keep a visible text label that states their state.

---

## 10. Motion

Motion is short, calm and functional. Nothing bounces, overshoots or loops for attention. The values are the tokens in `implementation-tokens.css` ([0181](../../docs/decisions/0181-redesign-foundation.md), the canvas Flow & motion page). Use the token, never a number.

| Token | Value | Use |
|---|---|---|
| `--ease-enter` | `cubic-bezier(0.2,0.8,0.2,1)` | Everything that arrives |
| `--ease-exit` | `cubic-bezier(0.4,0,1,1)` | Everything that leaves |
| `--ease-linear` | `linear` | The sheet scrim fades linear (Motion board, month drawer) |
| `--ease-standard` | `cubic-bezier(0.4,0,0.2,1)` | In-place changes: bar widths, row collapse |
| `--motion-press` | 120ms | Press: opacity .72, and scale .985 on buttons |
| `--motion-fast` | 150ms | Tab crossfade, chip colour, segment, toggle knob, focus ring |
| `--motion-fade` | 200ms | Toast in; skeleton to content crossfade |
| `--motion-toast-out` | 160ms | Toast out |
| `--motion-sheet-out` | 220ms | Sheet out, back from a detail page, a row leaving |
| `--motion-sheet-in` | 280ms | Sheet in |
| `--motion-scrim` | 260ms | Sheet scrim |
| `--motion-bar` | 240ms | Compact bar and sticky panel, in and out; month change |
| `--motion-page` | 280ms | Page enter; push to a detail page (from 24px, from the start side) |
| `--motion-width` | 300ms | Bar widths |
| `--motion-bar-grow` | 480ms | Thin bars grow from the right on enter |
| `--motion-stagger` | 40ms | Page-enter stagger, first five blocks |
| `--motion-pulse` | 1.2s | Skeleton pulse |
| `--motion-spin` | 800ms | Inline spinner, one turn |
| `--skeleton-delay` | 300ms | Nothing shows before this |
| `--rise-page` / `--rise-push` | 8px / 24px | Page-enter rise; push offset |

The utilities in `app/src/ui/css/00-motion.css` use these tokens. Use them, and don't write transitions by hand:

| Utility | Does |
|---|---|
| `.m-press` | Press feedback on a control |
| `.m-page-enter` | Page enter; set `--i` for the stagger index (`usePageEnter()` sets it on the first five blocks) |
| `.m-push-in` / `.m-push-back` | Push to a detail page and back |
| `.m-sheet-in` / `.m-sheet-out` | Sheet in and out |
| `.m-bar-in` / `.m-bar-out` | Compact bar and sticky panel |
| `.m-row-leave` | A row leaving; animates `grid-template-rows` from `1fr` to `0fr`, never a measured height |
| `.m-bar-grow` | A thin bar growing from the right on enter |

```css
.sheet { transform: translateY(100%); transition: transform var(--motion-sheet-out) var(--ease-exit); }
.sheet[data-open] { transform: none; transition: transform var(--motion-sheet-in) var(--ease-enter); }
```

- **Reduced motion.** Under `prefers-reduced-motion: reduce`, every `--motion-*` token is `0ms` and every rise is `0`, so the end state shows at once. Nothing slides, pulses or fades in. The two sheet tokens stay `1ms`, because Vaul needs a transition end (see `app/src/ui/css/10-settings-onboarding.css`). `reduced-motion.tsx` keeps its Storybook frame and decorator. The scroll-linked band fade is not timed, so it still follows the finger.
- You **MUST** respect `prefers-reduced-motion: reduce` through the tokens. Don't add a media query that sets a duration of its own.
- Animate only `transform` and `opacity`. Don't animate layout, and don't use auto-playing motion.

---

## 11. Content and copy

### 11.1 Hebrew tone
- **Short, friendly, direct, second person.** Talk to the contractor like a helpful bookkeeper. Say what happened and what to do next. Aim for one line where possible.
- **Gender-neutral second person.** Use plural imperatives for instructions ("העלו", "בחרו", "הוסיפו למסך הבית"), and noun or infinitive forms for buttons ("אישור", "שמירה", "ביטול", "הוספה", "סימון כשולם"). Avoid "אתה"/"את". The draft 04 subtitle "אתה רק מאשר" **SHOULD** become, for example, "ה־AI ישייך לפרויקט ולקטגוריה – נשאר רק לאשר".
- Use plain words, not accounting jargon. Write "רווח", "הכנסות", "הוצאות", "חשבוניות פתוחות", "הוצאות כלליות". Where a term is unavoidable (מע״מ, ח.פ.), keep it standard.
- **Explain the AI briefly.** Show suggestions with ✦ and a confidence % in `hint`. Give a one-line "למה?" reason ("לפי כלל: חומרי בניין השרון ← חולון").
- **No exclamation marks, no emoji, no ALL-CAPS English.**
- Use Hebrew punctuation: geresh and gershayim (ח״פ, בע״מ, משפ׳), an en dash with spaces ( – ) for asides, and a middle dot ( · ) to separate hint facts.
- Errors say what went wrong and how to fix it, without blame ("מספר קצר מדי – 9 ספרות", not "קלט לא תקין").
- English appears only in the "Flow" wordmark and the example-data tag.

### 11.2 The "Example data" tag
- In **mockups, prototypes, Storybook and demo mode**, every screen that shows invented figures **MUST** show the tag **"נתוני דוגמה · Example data"**. Put it in `hint` style, `text-muted` (`on-band-secondary` on the band), at the end side of the top bar or the Home greeting row.
- In the product it appears **only** when the screen shows sample data (e.g. a guided tour before the first bank upload). It **MUST NOT** appear on real data.
- The drafts render it at 12px. Use `hint` (13px) (see §14).

### 11.3 Number rounding on Home (and overview screens)
Home is for a glance, so figures are whole and stable:

1. Money is **whole shekels** everywhere except the transaction detail, review card and edit fields (where agorot show if they aren't zero). Store money as integer agorot. Never use floats.
2. **Never abbreviate.** Don't write "1.3M", "₪1.3 מ׳" or "אלף". Always show full digits with thousands separators: `₪1,310,000`.
3. **The line adds up.** On Home and the Project header, compute the shown profit as *rounded income − rounded expenses*, so the three visible numbers always add up.
4. **Percentages** (margin, change, budget used) are whole numbers.
   - Round half away from zero.
   - Compute them from exact, unrounded values.
   - A non-zero value that rounds to 0 shows as "0%" in a neutral pill (§8.4).
   - Margin with zero income shows "—".
5. **Change pill:** the absolute % with ▼/▲. The direction comes from the sign of the exact change, not the rounded one. Hide it when there is no comparison period.
6. **Hero fit:** if the hero figure doesn't fit the width at `hero` (52px), step it down to `display` (36px). Never scale the font continuously, and never truncate.
7. **Counts** are exact integers ("7 פריטים").
8. **Figure budget on Home:** profit, change, income, expenses, pending count, unpaid total, and up to 3 top projects (profit and margin each). Adding any other figure needs a design decision.

---

## 12. Checklists

### 12.1 Per-screen definition of done
Tick every box before calling a screen implemented.

**Structure and template**
- [ ] Uses exactly one template (A, A+band, B or C) and matches its board in this folder (§13), in light **and** dark mode.
- [ ] The band appears only if this is Home or Project. The tab bar appears only in template A. The + button opens Add.
- [ ] Exactly **one primary button**. At most about 2 filled-violet shapes in view.
- [ ] Few numbers: nothing added beyond the board. Extra detail links to an inner screen.

**Tokens and style**
- [ ] No raw hex, rgb or px values in screen code (except hairlines and component internals from `flow.py`).
- [ ] Only the ten type styles are used. Weights are 400/500/600/700 and used as intended.
- [ ] Spacing: 24 sides, cards at 16, sections 36–40, and everything else from the 4-point scale.
- [ ] Radii come from the token table. No gradients (except the loading shimmer), no emoji, no shadows except the switch knob and the selected segment.
- [ ] Figures are in `text`. Red and green appear only with ▼/▲ or a minus sign.

**RTL and numbers**
- [ ] `dir="rtl"` from the root, with logical properties only (search the code for `left`/`right`).
- [ ] Directional icons point the right way. + and ✓ are not mirrored.
- [ ] Every number is in `.num` or `<bdi dir="ltr">`, with tabular digits.
- [ ] All formatting goes through `format.ts`: ₪ before the number, `−` (U+2212) for negatives, whole %, Hebrew dates. No `he-IL` currency format.
- [ ] Home rounding rules (§11.3) are followed, and the line adds up.

**States**
- [ ] Loading: a skeleton that matches the layout. Busy buttons show a spinner inside.
- [ ] Empty: an icon, a title, one line and one secondary action, with screen-specific copy.
- [ ] Error or offline with "ניסיון חוזר". Offline with cached data and the "אין חיבור · נתונים מ-…" line.
- [ ] Partial data cases from §8.4 that apply to this screen.
- [ ] Pressed, disabled, focus and selected states on every control.
- [ ] Toast with undo for every reversible action.

**Accessibility**
- [ ] Passes an axe (or Lighthouse accessibility) run with 0 serious issues in both modes.
- [ ] Visible focus ring on every control, white inside the band. The full flow works with a keyboard or switch control.
- [ ] Hebrew labels on inputs and `aria-label`s on icon buttons. The change pill and badge have spoken text.
- [ ] Targets are at least 44×44. The screen works at 200% text size and at 320px width.
- [ ] Reduced motion turns off slides and shimmer.

**Platform**
- [ ] Safe areas: nothing sits under the notch or the home indicator. The keyboard doesn't cover the focused field.
- [ ] Works installed (standalone) on iOS Safari and Android Chrome. `theme-color` is correct for the screen.
- [ ] Copy is short, gender-neutral Hebrew. The example-data tag appears only on sample data.

### 12.2 PR review checklist
Reviewers, human or AI, check:

- [ ] **Screenshots attached:** light and dark, default, loading, empty and error states, at 390px wide (plus 320px if the layout is tight). Placed next to the matching board PNG.
- [ ] **Diff scan:**
  - `rg -n '#[0-9A-Fa-f]{3,8}\b|rgba?\(' src/` finds no hits in screen code.
  - `rg -n '\b(margin|padding)-(left|right)\b|\b(left|right):|text-align:\s*(left|right)' src/` finds no hits, except the documented LTR-input exception.
  - `rg -n "font-size:\s*\d" src/` finds no raw sizes.
- [ ] No new colours, sizes, radii or shadows. If one is needed, it is raised as a design question, not merged.
- [ ] Shared components are reused, not copied or restyled per screen. New component variants are added to the library with all their states.
- [ ] One primary per screen. The band is used only on Home and Project.
- [ ] Numbers use the formatters. Negatives use `−`. No `toLocaleString('he-IL', {style:'currency'})`.
- [ ] Money is handled as integer agorot, and rounding happens only at display.
- [ ] Overhead switch defaults to **off**.
- [ ] All states from §8 are present, plus the toast undo path, tested.
- [ ] Accessibility: labels, `aria-*`, focus order, dialog focus trap, `aria-live` for toasts, reduced motion.
- [ ] Hebrew copy is reviewed by a native speaker: tone, gender-neutral phrasing, punctuation (״ ׳ – ·).
- [ ] No regressions in the other theme. Both `prefers-color-scheme` and forced `data-theme` work.

---

## 13. File map

All paths are relative to `/workspace/wireframes-pnl/final/`. Every screen exists as `NN-name-light` and `NN-name-dark`, in `.html` and `.png` (390×844 at 2×).

**Design system**

| File | What it is |
|---|---|
| `design-system.md` | Short spec of the approved system (V1 Violet with the coloured band) |
| `implementation-tokens.css` | **CSS custom properties for code**: light and dark, `prefers-color-scheme` + `data-theme`, and the layout and motion values. Hand-edited; the one token file ([0181](../../docs/decisions/0181-redesign-foundation.md)). |
| `implementation-guide.md` | This guide |
| `flow.py` | Reference component CSS (`BASE`), the icon set (`I`), the `num()` formatter and the draft screen generators |
| `ds.py`, `render-ds.sh`, `crop.py` | Generate and render the design-system boards (1–8) |
| `states.py`, `render-states.sh` | Empty states and loaders |
| `more.py`, `render-more.sh` | Screens 15–23 and the er- errors, plus `overview-more` |
| `render.sh` | Renders the screen PNGs |
| `render-logo.sh` | Re-renders only the screens touched by the logo decision (09a, 09e, 13, 17a/b, overviews, boards 1–8) |
| `design/logo/` (repo) | Final logo package: wordmark, S1 icon, PWA icons, favicon, usage board, `LOGO.md` (see §7.32) |

**Boards** (`-light` / `-dark`, `.png` and `.html`)

| Board | Content | Use it for |
|---|---|---|
| `ds-7-empty-loading-*` | **Empty and loading states** board | §8 |
| `ds-8-pickers-sheets-*` | Date picker, period sheet, confirmation sheet, error pattern, install prompt, overhead breakdown, fixed switch | §7.9, §7.26–7.31 |
| `overview-more-*` | All screens from 15 onwards, plus the updated 10, in one grid | §7.26–7.31 |
| `overview-states-*` | All empty and loading screens in one grid | §8 |

**Empty states** (`es-*`, light and dark, `.html` + `.png`)

| File | State |
|---|---|
| `es-01-home-first-run-*` | Home before any data (band placeholder, "העלאת דוח בנק") |
| `es-02-project-empty-*` | New project with no transactions |
| `es-03-review-done-*` | Review queue cleared ("הכל מאושר") |
| `es-04-projects-none-*` | No projects yet |
| `es-05-unpaid-none-*` | No unpaid invoices |
| `es-06-search-none-*` | Search with no results |
| `es-07-categories-income-*` | No income categories |
| `es-08-notifications-off-*` | Notifications turned off |

**Loading, busy and offline** (`ld-*`)

| File | State |
|---|---|
| `ld-01-home-skeleton-*` | Home skeleton (band chrome real, figures as bars) |
| `ld-02-project-skeleton-*` | Project skeleton |
| `ld-03-list-skeleton-*` | List skeleton (Projects; search stays usable) |
| `ld-04-button-loading-*` | Spinner inside the primary button ("מאשר…") |
| `ld-05-upload-processing-*` | Bank report processing, stepped progress, "המשך ברקע" |
| `ld-06-invoice-reading-*` | Invoice being read, fields filling in |
| `ld-07-pull-to-refresh-*` | Pull to refresh over live content |
| `ld-08-offline-*` | Offline, nothing cached ("ניסיון חוזר") |
| `ld-09-offline-cached-*` | Offline, showing cached data with the notice line |

**Screens**

| File | Screen | Template |
|---|---|---|
| `01-home-*` | Home, בית: band with profit, pending card, top projects | A+band |
| `02-project-*` | Project, פרויקט: band header, overhead switch (off), budget, categories | A+band |
| `03-review-*` | Review queue, לאישור: AI suggestion card, approve / change / skip | A |
| `04-add-*` | Add, הוספה: sheet over Home (photo, bank report, manual) | B |
| `05-projects-*` | Projects list with search | A |
| `06-change-sheet-*` | Change assignment: tall sheet with chips, search, remember switch | B |
| `07-categories-*` | Categories (Settings): segmented, reorder list | A |
| `08-upload-results-*` | Bank report uploaded: results summary | A (✕ close) |
| `09a…09e-onboarding-*` | Onboarding: Google sign-in, company details, bank report, projects, install and notifications | C |
| `09-onboarding-*` | Strip showing all onboarding steps (overview only) | none |
| `10-transaction-detail-*` | Expense detail with source, links and actions | C |
| `11-split-*` | Split between projects | C (✕ close) |
| `12-unpaid-*` | Unpaid invoices | A |
| `13-notifications-*` | Push notification content on the lock screen (reference, not an app screen) | none |
| `14-settings-*` | Settings (tall page) | A |
| `overview-*` | All screens in one grid | none |

**Pickers, sheets, install and overhead** (`more.py` + `render-more.sh`, light and dark, `.html` + `.png`)

| File | Screen | Template |
|---|---|---|
| `15a-date-field-*` | Manual entry form with the date field that opens the picker | C |
| `15b-date-single-*` | Single-date sheet (היום / אתמול, Sunday-first grid) | B |
| `15c-date-range-*` | Custom range sheet (החודש / חודש קודם / מתחילת השנה) | B |
| `16-period-sheet-*` | Period sheet from the band pill | B |
| `17a-install-android-*` / `17b-install-iphone-*` | Add-to-home-screen prompt | C |
| `18-home-overhead-on-*` / `19-project-overhead-on-*` | Overhead switch on: before, share, after | A+band |
| `20-confirm-delete-*`, `21-confirm-archive-*`, `22a-merge-pick-*`, `22b-merge-confirm-*`, `23-confirm-hide-*` | Confirmation sheets | B |
| `er-01-bank-file-*` … `er-05-save-failed-*` | Wrong bank file, blurry invoice, Google window closed, Google sign-in failed, save failed | C |

Note: `flow.py` itself says its screens are an early pass. The **boards and tokens** are approved. Where a draft screen differs from this guide, follow the guide (see §14).

---

## 14. Appendix: known deviations in the draft screens and open questions

**How to normalise the draft screens.** Rebuild these values the tokenised way. Don't copy the raw numbers.

| Draft value | Where | Use instead |
|---|---|---|
| Amount at 44px / 40px | 02 Project header, 12 Unpaid, 10 Detail | `display` (36). `hero` (52) is for Home only. |
| "42" at 52px | 08 Upload results | `display` (36) |
| Example tag at 12px | all screens | `hint` (13) |
| Field label 13px / 500 | inputs | `hint` size in `text-secondary` (the weight is an open question below) |
| Small button text 14px | `.btn.sm` | `label` (15) |
| Badge 10.5px | tab bar | `micro` (11) |
| Chip hint 12px | chips | `hint` (13) |
| Section gaps of 28–30px | 01, 02, 03, 11 | 36 (`--space-section`) |
| Physical `left`/`right`, `margin-right` | `flow.py` CSS | logical properties (§6.1) |
| `#fff` knob, `#000` island, error-toast colour hard-coded | `flow.py` / `ds.py` | `--color-knob`. The island is device chrome and is not built. Use `--color-toast-bad` for the error-toast icon. |
| "אתה רק מאשר" | 04 Add | gender-neutral copy (§11.1) |

**Sign-in decision (26 Sep 2026):** Google sign-in replaces phone-number sign-in for the POC. 09a, `er-03-google-cancelled` and `er-04-google-failed` replace the old code-entry screens (deleted), and the code-box component is removed.

**Status (26 Sep 2026):** every row above is fixed in `flow.py` and re-rendered. Screen 10 was also simplified: project and category stay visible, and the invoice and payment details fold into one "חשבונית ותשלום" row.

**Open questions for design.** Until they are answered, use the interim rule shown.

1. **Field label style:** use `hint` in `text-secondary` at weight 400, or make an exception for 500?
   - *Interim:* `hint` at 400.
2. ~~Non-text contrast~~ **Resolved:** `control-off` / `control-border` are #8F86A3 / #736A8C (≥ 3:1), and `knob-on` fixes the dark ON switch.
3. ~~Derived colours~~ **Resolved:** they are in `implementation-tokens.css`. Motion values stay guide-defined in the CSS.
4. ~~Period sheet and custom range~~ **Resolved:** `16-period-sheet`, `15b-date-single`, `15c-date-range` (§7.26–7.27).
