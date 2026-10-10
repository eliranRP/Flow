# Flow design rules

Authoritative reference for code review and design review. Rules below are compiled from records already in the repo. Each rule cites its source. If this file and a cited source disagree, the source wins. If the implementation guide and a board or `design-tokens.json` disagree, the boards and the JSON win ([implementation guide](../../design/system/implementation-guide.md), opening).

The approved look is **V1 Violet with a coloured top band**. Hebrew, right to left, phone-only PWA. [0023](../decisions/0023-violet-coloured-top-band.md), [0024](../decisions/0024-design-system-approved.md), [design/README.md](../../design/README.md).

The implementation guide is mandatory, including its definition of done. [0025](../decisions/0025-implementation-guide-is-mandatory.md).

---

## 1. Design and UX decisions

| Record | Rule |
|---|---|
| [0005](../decisions/0005-mobile-first.md) | The phone is the layout. |
| [0006](../decisions/0006-confirm-not-type.md) | The owner confirms a suggestion. Daily use is a tap, not a form. Change is a sheet. "Remember for this supplier" starts on. Only approved rows enter reports. A pending-count banner stays on Home. |
| [0008](../decisions/0008-flat-categories-hide-or-merge.md) | Flat categories. Seven expense defaults and two income defaults. Hide or merge. Do not delete a category that has transactions. |
| [0009](../decisions/0009-scalable-pickers.md) | Project and category pickers, and Home, stay usable when there are many jobs. |
| [0011](../decisions/0011-auto-approve-high-confidence.md) | A matched invoice or a learned supplier rule is auto-approved, skips the queue, and can be reopened from a short summary. An AI guess still waits in the queue, one card at a time. |
| [0014](../decisions/0014-optional-project-budget.md) | A project budget is optional. Hide the budget block when none is set. |
| [0015](../decisions/0015-installable-mobile-web-app.md) | Installable mobile web app. No desktop site and no native app in this phase. Onboarding includes an install step. |
| [0016](../decisions/0016-hebrew-only.md) | Hebrew only. Layout is right to left. Amounts are ₪, and the number itself is left to right. |
| [0017](../decisions/0017-sms-sign-in.md) | Superseded. Do not build SMS sign-in. |
| [0018](../decisions/0018-two-notifications.md) | Exactly two notifications, `Asia/Jerusalem`. Sunday 08:00 weekly summary (tap opens Home). 18:00 review nudge only when the queue is not empty (tap opens Review). No per-transaction ping. |
| [0019](../decisions/0019-home-periods-and-comparison.md) | Home periods: this month, last month, year to date, each with a comparison arrow. The project screen defaults to project to date. The period list is amended by [0141](../decisions/0141-period-bar.md). |
| [0020](../decisions/0020-capture-from-the-phone.md) | Capture is multi-photo and files on the phone. Android may share in. iPhone cannot. |
| [0021](../decisions/0021-shared-costs-and-overhead.md) | Shared project costs are split. True overhead stays overhead. The overhead share is a view, not a rewrite of transactions. |
| [0022](../decisions/0022-after-overhead-starts-off.md) | The after-overhead switch starts **off**. Home, the project screen, and Settings share one preference. |
| [0023](../decisions/0023-violet-coloured-top-band.md) | Violet `#7B3FE4`, solid top band, white page below, Rubik at the heavier weights. See §6 for what was rejected. |
| [0024](../decisions/0024-design-system-approved.md) | Light and dark, one violet band in both modes, Rubik 400/500/600/700, spacing and radius scales, WCAG AA text. |
| [0025](../decisions/0025-implementation-guide-is-mandatory.md) | [implementation-guide.md](../../design/system/implementation-guide.md) is the definition of done. |
| [0026](../decisions/0026-empty-loading-error-states.md) | Every screen has empty, loading, and error states, in light and in dark. |
| [0027](../decisions/0027-date-picker.md) | Week starts Sunday. Dates are dd/mm/yyyy. Single-date and range pickers, both with shortcuts. |
| [0028](../decisions/0028-period-sheet-with-custom-range.md) | The period is a sheet opened from the band pill, including a custom range. This replaces only the "no custom range" sentence in 0019. On Home and the project band the sheet opens from the period bar's label ([0141](../decisions/0141-period-bar.md)). |
| [0029](../decisions/0029-pwa-install-prompt.md) | After the first successful report, offer install. Android uses `beforeinstallprompt`. iPhone shows three Safari steps. Do not show it inside the installed app. |
| [0030](../decisions/0030-confirmation-sheets.md) | Delete, archive, hide, and merge use a confirmation sheet. Merge is two steps. The confirm control is a soft bad-tint button, then an undo toast. |
| [0031](../decisions/0031-logo.md) | Wordmark "Flow", Rubik 700, letter-spacing −0.01em. App icon is S1, the straight F. |
| [0032](../decisions/0032-home-hero-stays-company-net-profit.md) | With the after-overhead switch **on**, Home's big number stays company net profit. Overhead is already inside it. The switch changes the small band figures and the project rows, not the hero. |
| [0033](../decisions/0033-google-sign-in.md) | Google account sign-in. Supersedes 0017. The button label is "המשך עם Google". |
| [0040](../decisions/0040-tailwind-v4.md) | Tailwind CSS v4. Tokens map into `@theme`. No component kit with its own look. Vaul stays for sheets. |
| [0041](../decisions/0041-amounts-before-vat.md) | P&L amounts are before VAT. VAT is stored beside the amount and kept out of profit. |
| [0043](../decisions/0043-assumed-vat-on-expenses.md) | An expense with no VAT split assumes 18% (`vat_status='assumed'`), unless the supplier is VAT-exempt (`net = gross`). A subtle hint may appear on the detail screen. Home has no warning banner. |
| [0120](../decisions/0120-income-green-type-scale.md) | Money in is `income` green with no plus, only on a figure with no minus and never on the band. Option C, full Mercury: page titles 34, section and month heads `heading` 20, row titles 17/400, list amounts `amount` 17/400, row secondary lines `meta` 15/400, project name on the band 32. No row hairlines anywhere; month groups 32px apart. Transaction rows show small raised cents, ".00" included; other lists and summaries stay whole. |
| [0141](../decisions/0141-period-bar.md) | Home and the project band carry one period bar: five presets and a stepper with outward SVG chevrons; its label opens the period sheet. Replaces the period pill there (FLOW-411). |

Records that are not visual rules but change what a screen may show: [0004](../decisions/0004-cash-basis-for-v1.md) cash basis, [0007](../decisions/0007-bank-statement-is-primary-input.md) unpaid invoices stay out of the P&L until paid (amended in role by [0042](../decisions/0042-sumit-primary-income-and-expenses.md) and [0065](../decisions/0065-review-round5.md) point 40: SUMIT is the source, and there is no Hapoalim import).

---

## 2. Design system

Sources: [design-system.md](../../design/system/design-system.md), [implementation-tokens.css](../../design/system/implementation-tokens.css), [design-tokens.json](../../design/system/design-tokens.json). `tokens.py` is the generator. Do not edit the CSS by hand. [implementation guide §2.1](../../design/system/implementation-guide.md).

### 2.1 Principles

From [design-system.md](../../design/system/design-system.md) and guide §1:

- Calm and airy. White page, lots of space, few numbers, detail on the next screen.
- **Light and clean, few words (owner, 2026-10-08).** He turned down every option for the FLOW-401 project page as too busy, with too much data, and noisy. A screen is light, with few words and little data. Before adding a figure, a word or a mark, ask whether it changes what the user does next on this screen. If not, leave it out or put it on the next screen. Checked in every design review and sign-off:
  - A row stays short: a title, its value, and at most one meta line. Add a mark only when it changes what the user does with that row.
  - A screen leads with one main figure. Every other figure needs a reason to be there, and Home keeps to its figure budget (§3.5).
  - Labels are one or two words. Add a help sentence only where an existing rule calls for one (empty state, error, confirmation consequence).
  - No new legends, keys or "X = Y" explanations on a screen. If a new screen needs one, it shows too much.
  - When in doubt, draw the lighter option and recommend it.
- One accent, violet. Filled violet at most about twice per screen area (normally the + button and one primary button).
- The coloured band is only the top of Home and the Project header.
- Figures use the main text colour. A loss is `bad` with a minus or ▼, a gain in a change pill is `good` with ▲, and money in is `income` green with no plus. Never colour on the band. [0120](../decisions/0120-income-green-type-scale.md)
- No gradients, no emoji, no heavy shadows. Depth is the violet tint and 1px hairlines. The loading shimmer is the only gradient.

### 2.2 Colour tokens

Light and dark. The band is the same violet in both modes. Dark is a violet-tinted near-black, never `#000000`. [0024](../decisions/0024-design-system-approved.md), [design-system.md](../../design/system/design-system.md), guide §2.2–2.3.

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | `#FFFFFF` | `#15111E` | Page |
| `surface` | `#FFFFFF` | `#1E1929` | Cards, tab bar, sheets, inputs |
| `raised` | `#FFFFFF` | `#251F33` | Raised above a surface |
| `tint` | `#F3ECFE` | `#2A2045` | Pending card, pills, secondary button |
| `tint-strong` / `tint-pressed` | `#E7DAFD` | `#382A5E` | Pressed tint |
| `line` | `#EEE8FA` | `#2E2740` | Hairlines |
| `control-off` | `#8F86A3` | `#736A8C` | Switch off, unchecked checkbox, grab handle |
| `control-border` | `#8F86A3` | `#736A8C` | Input, search, outlined chip, radio |
| `text` | `#1D1728` | `#F1EDF8` | Main text and all figures |
| `text-secondary` | `#564E66` | `#B1A8C4` | Labels, secondary lines |
| `text-muted` | `#6A627A` | `#978EAB` | Hints, dates, placeholders |
| `accent` | `#7B3FE4` | `#B894FF` | +, primary fill, switch on, selected chip |
| `accent-pressed` | `#6631C9` | `#A47FF0` | Pressed accent |
| `accent-text` | `#6C2ED6` | `#C3A5FF` | Links, active tab, accent icons |
| `logo` | `#7B3FE4` | `#B894FF` | Wordmark off the band. Not `accent-text` |
| `on-accent` | `#FFFFFF` | `#1E0B45` | Text on an accent fill. Dark text in dark mode |
| `band` | `#7B3FE4` | `#7B3FE4` | Top band. Same in both modes |
| `on-band` | `#FFFFFF` | `#FFFFFF` | Text on the band |
| `on-band-secondary` | `#F0E8FF` | `#F0E8FF` | Labels on the band |
| `band-chip` / `band-pill` | `#FFFFFF` | `#1E1929` | Pills sitting on the band |
| `good` | `#15733F` | `#62CB8D` | Positive change, only with ▲ |
| `income` | `#13703D` | `#62CB8D` | Money in: income rows and totals, Home נכנס, an income detail. No plus, never with a minus, never on the band. [0120](../decisions/0120-income-green-type-scale.md) |
| `bad` | `#C3302B` | `#FF8A80` | Loss or negative change, only with ▼ or minus |
| `warning` | `#8A5700` | `#EDB866` | Warning, for example over budget |
| `error` | `#C3302B` | `#FF8A80` | Input error border and message |
| `disabled-bg` / `disabled-text` | `#F1EEF6` / `#8F889C` | `#2A2438` / `#7A7290` | Disabled controls |
| `scrim` | `rgba(29,23,40,.45)` | `rgba(5,3,10,.62)` | Sheet backdrop |
| `toast-bg` / `toast-text` | `#1D1728` / `#FFFFFF` | `#F1EDF8` / `#15111E` | Toast inverts per mode |
| `seg-on` | `#FFFFFF` | `#3B2F5E` | Selected segment |
| `knob` | `#FFFFFF` | `#FFFFFF` | Switch knob off |
| `knob-on` | `#FFFFFF` | `#1E0B45` | Switch knob on |
| `bad-tint` | `#FCEDEC` | `#3A1E24` | Destructive confirm fill |
| `toast-bad` | `#FF8A80` | `#C3302B` | Error icon inside the inverted toast |
| `badge-bg` / `badge-text` | `#1D1728` / `#FFFFFF` | `#F1EDF8` / `#1E1929` | Tab count. Neutral, not red |
| `focus` / `focus-on-band` | `#6C2ED6` / `#FFFFFF` | `#C3A5FF` / `#FFFFFF` | Focus rings |
| `skeleton` / `skeleton-shine` | `#F3ECFE` / `#FAF6FF` | `#2A2045` / `#33285A` | Skeleton |
| `skeleton-band` / `skeleton-band-shine` | `#9565E9` / `#A57CED` | `#9565E9` / `#A57CED` | Skeleton on the band |
| `gsi-bg` / `gsi-border` / `gsi-text` | `#FFFFFF` / `#747775` / `#1F1F1F` | same | Google button only. Same in both modes |

Text pairs are WCAG AA 4.5:1. Non-text UI (tracks, borders, knobs, Google stroke) is at least 3:1. [design-system.md](../../design/system/design-system.md), guide §9.

Theme switching: follow the OS (`prefers-color-scheme`). `data-theme="light"` or `data-theme="dark"` on `<html>` forces a mode, and only there. `theme-color` is `#7B3FE4` on Home and Project, and the page background elsewhere. Guide §2.3.

### 2.3 Type scale

Rubik. Weights mean something: 400 hints, row titles, row secondary lines and list amounts, 500 body, inputs and labels, 600 titles, heads, hero and display amounts, 700 wordmark only. Do not use 300, 800, or 900. [0023](../decisions/0023-violet-coloured-top-band.md), [0024](../decisions/0024-design-system-approved.md), [0120](../decisions/0120-income-green-type-scale.md), guide §5.

| Style | Size | Line | Weight | Use |
|---|---|---|---|---|
| hero | 52px | 1.15 | 600 | Home profit only. Letter-spacing −0.02em |
| display | 36px | 1.2 | 600 | Main amount on inner screens |
| title-1 | 34px | 1.15 | 600 | Tab-root page titles. Letter-spacing −0.01em. A stacked title under Back is 28px, same line and weight (FLOW-347, #355) |
| title-2 | 22px | 1.35 | 600 | Sheet titles |
| band-title | 32px | 1.25 | 600 | Project name on the band |
| heading | 20px | 1.3 | 600 | Section heads, month heads in lists |
| title-3 | 17px | 1.45 | 600 | Compact transaction title. Row titles use its size and line at 400 |
| amount | 17px | 1.45 | 400 | Amounts in lists, Home נכנס / יצא. Transaction rows add small raised cents |
| body | 16px | 1.5 | 500 | Rows, input values. Inputs stay at least 16px so iOS does not zoom |
| label | 15px | 1.5 | 500 | Labels, subtitles, links |
| meta | 15px | 1.4 | 400 | Row secondary line, in `text-muted` |
| hint | 13px | 1.45 | 400 | Dates, helper text, field labels |
| micro | 11px | 1.3 | 500 | Tab labels and badges only |
| wordmark | 22px | 1.2 | 700 | "Flow" only. Letter-spacing −0.01em. LTR |

CSS names are `--type-<style>-size`, `--type-<style>-line`, `--type-<style>-weight`, `--type-title-1-tracking`, and `--font-family`. Numbers use `tabular-nums` and `lining-nums`. [implementation-tokens.css](../../design/system/implementation-tokens.css), guide §5.

### 2.4 Spacing

4-point scale, plus the named layout values. [design-system.md](../../design/system/design-system.md), guide §4.

| Token | Value |
|---|---|
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-3` | 12px |
| `--space-4` | 16px |
| `--space-5` | 20px |
| `--space-6` | 24px |
| `--space-8` | 32px |
| `--space-10` | 40px |
| `--space-side` | 24px page sides |
| `--space-card-inset` | 16px card inset from the screen edge |
| `--space-section` | 36px between sections (up to 40px) |

### 2.5 Radii

| Token | Value | Use |
|---|---|---|
| `--radius-chip`, `--radius-fab` | 9999px | Chips, pills, badges, switch, + button |
| `--radius-input` | 12px | Inputs, search, segmented track |
| `--radius-button` | 14px | Buttons, toast |
| `--radius-card` | 16px | Cards |
| `--radius-sheet` | 24px | Sheet, top corners only |
| `--radius-band` | 28px | Band, bottom corners only |

### 2.6 Shadows

There is no shadow scale in the tokens. Do not add drop shadows. The only allowed shadows are a faint one on the switch knob and a faint 1px shadow on the selected segment. The band has no shadow. [design-system.md](../../design/system/design-system.md) principles, guide §1 P5 and §7.5–7.6. Decision [0040](../decisions/0040-tailwind-v4.md) says shadows are mapped into `@theme` when they exist. They do not exist as a scale, so do not invent `--shadow-*` utilities.

### 2.7 Motion

Short, calm, functional. No bounce, no overshoot, no attention loops. Animate only `transform` and `opacity`. Honour `prefers-reduced-motion` (durations go to 0). Guide §10, [implementation-tokens.css](../../design/system/implementation-tokens.css).

| Token | Value | Use |
|---|---|---|
| `--dur-press` | 100ms | Pressed background |
| `--dur-fast` | 150ms | Switch, chip, segment, focus |
| `--dur-base` | 200ms | Fades. No count-up of numbers |
| `--dur-sheet-in` | 280ms | Sheet up. Easing `--ease-standard` `cubic-bezier(0.2, 0, 0, 1)` |
| `--dur-sheet-out` | 220ms | Sheet down. Easing `--ease-exit` `cubic-bezier(0.4, 0, 1, 1)` |
| `--dur-shimmer` | 1400ms linear | Skeleton sweep, right to left |
| `--toast-duration` | 4000ms | A plain confirmation. A toast with an action (ניסיון חוזר, ביטול, לפיצול) stays 5000ms. An error stays 4000ms. A preview notice uses the info tone, not the error tone, and also stays 4000ms when it has no action. Hover, focus, and a press pause it. The two-line minimum applies only when the text shrinks or wraps, not to the container. Toast text uses `text-wrap: balance`. A tap on the toast does not close a sheet underneath. Over an open sheet the toast sits just above the sheet. When that gap is too small it keeps its full height `--space-2` below the safe area. The same `--space-2` is the gap at every size and safe area, so the toast does not sit at y=1.5. It may cover the grabber and the empty top of the sheet. It never covers a header control. The height is measured once before the toast is visible, from the sheet's resting top, not from a rect taken while the sheet is opening. The sheet pads nothing unless a control would be covered. At safe area 0 the sheet keeps its own padding. A 320 two-line refusal pads to 20 at safe area 20 and to 47 at safe area 47, and ✕ finishes at the toast bottom plus `--space-2`. The content moves once, for `--dur-base` with `--ease-standard`, and the toast fades in after that move. No frame shows the toast except at the position it settles at. Above a short sheet the gap is `--space-2`, measured after the pad is gone. A change of the sheet's own layout places the toast and the pad before the next paint. A later toast keeps that pad instead of easing it through 0. Resize, rotation, and the keyboard place a visible toast again, and they wait while the pad or the fade is running. The timer starts when the toast is visible. The pad returns in one `--dur-base` move after the toast leaves. The text is never clipped. [0069](../decisions/0069-back-and-one-tap-review.md), [0072](../decisions/0072-design-review-rulings.md), [0074](../decisions/0074-toast-and-remembered-supplier.md), [0075](../decisions/0075-save-on-tap-and-on-leave.md) |

Screen push is 250ms from the start side. Toast in 200ms / out 150ms.

### 2.8 Component inventory and states

Boards: [ds-4](../../design/system/ds-4-controls-light.png) controls, [ds-5](../../design/system/ds-5-content-light.png) content, [ds-6](../../design/system/ds-6-band-light.png) band, [ds-7](../../design/system/ds-7-empty-loading-light.png) empty and loading, [ds-8](../../design/system/ds-8-pickers-sheets-light.png) pickers and sheets. Each has a `-dark.png` twin. [design-system.md](../../design/system/design-system.md), guide §7 and §8.5.

Every control has pressed, disabled, focus, and selected or busy where it applies. Pressed is instant, 100ms. Focus is a 2px ring, `--color-focus`, offset 2px. Inside the band the ring is white. A screen-reader title (`tabindex=-1`) draws no ring. A sheet panel (`role=dialog`, `tabindex=-1`) draws no ring either. The 2px ring stays on real controls for `:focus-visible`.

A viewer cannot take an action that would not apply, so that action is hidden. When the layout depends on the slot, the slot stays empty. A stateful switch stays on screen, disabled, with the label and the hint at full strength. The disabled off track keeps a 3:1 edge against the row. The disabled on track is a muted accent, so it stays distinct from an enabled off track. A settings row that would open a write becomes static, with no chevron.

| Component | States | Rule |
|---|---|---|
| Button | primary, secondary (tint), ghost, destructive. Default, pressed, disabled | One primary per screen. Destructive confirm is `bad` text on `bad-tint`, never a solid red block |
| + button | 48px circle. Default, pressed | Opens Add. Sits in the tab bar |
| Screen header (`ScreenHeader`) | stacked (default with Back or a leading control), compact, `layout="inline"`; compact bar shown | With Back or a leading control, Back sits alone on the bar and the title and subtitle stack under it on the start side (FLOW-326). With a kicker, the kicker is Back's label ("‹ הגדרות", `label` in `accent-text`, cut at about 16 characters) and there is no kicker line ([0156](../decisions/0156-labelled-back-and-compact-bar.md)). On a stacked page with Back, a 44px compact bar (Back and the title in `title-3`, one line, `line` hairline) pins to the top once the large title scrolls off; month heads pin under it. A compact title (the transaction) and `layout="inline"` stay on the bar and get no compact bar. FLOW-326, FLOW-334 |
| Period pill | tinted, or white/dark on the band | Opens the period sheet. Home's band carries one pill (FLOW-355); the project band uses the period bar |
| Period bar (`PeriodBar`) | preset selected; custom range (no preset selected, first preset keeps the tab stop); later arrow `aria-disabled` | Home and the project band ([0141](../decisions/0141-period-bar.md), FLOW-411): five presets (חודש · 3 חודשים · 6 חודשים · שנה · הכול) on a band-tone segmented control, then a stepper. The later arrow keeps its slot at the current window. The period label opens the period sheet |
| Chips | suggested (tint + ✦), outlined choice, selected (violet + check), disabled, status | Hit area 44px even if drawn 36px |
| Segmented tabs | track tint, selected `seg-on` | |
| Switch and checkbox | off / on / disabled | Overhead switch starts off. [0022](../decisions/0022-after-overhead-starts-off.md) |
| Text input | default, focused, filled, error, disabled | Label above. Error is red border plus a message. A connect or setup form checks required fields on submit, before any request: the message sits on the field's reserved message line (`reserveMessage`, so the button does not move) saying what to type ("כתבו X.", §3.7 FLOW-115), focus goes to the first empty field, and fields are read-only while the submit is busy (FLOW-508) |
| Search | default, typing (violet ring) | |
| Pending card | default, pressed; one row, or two rows (review, unpaid) each pressed on its own | The one tinted block on Home. Two rows share it, separated by padding, no hairline (FLOW-321) |
| Project row | profit in `text`, loss in `bad` with a minus | Name and margin on the start side |
| Transaction row | expense in `text` with −; income in `income` green, no plus, with a hidden "הכנסה"; cents small and raised, ".00" included | Grey source icon. No hairline. A row that opens the transaction carries the trailing chevron (FLOW-328). A line kept out of the P&L reads "מחוץ לרווח" first in its hint (FLOW-411). [0120](../decisions/0120-income-green-type-scale.md) |
| Statement row (`ListRow variant="statement"`) | default, pressed, focus; pending; with suggestion; income; name with no letter | FLOW-305 option A, the review list. 40px initials circle in `tint` with `accent-text` letters (one colour for every row; a name with no letter shows the source icon). Counterparty 17/400 `text`, one line; a Latin name is LTR and cuts at its end. Line 2 in `meta`: the `בהמתנה` status chip, then `✦` in `accent-text` and "project · category" (ellipsis). End column: the amount as in a transaction row, the method under it (16px icon + `meta` label, never cut). The link name reads counterparty, method, "הצעה: …", direction word + amount, "בהמתנה". Day heads (`היום`, `אתמול`, `יום ב׳ · 05/10`) are h3, 15/500 `text-secondary`, under the sticky month head, not sticky; month totals show cents when the rows do. |
| Change pill | ▼ / ▲ plus % | On the band it sits in a solid pill |
| Tab bar | בית, פרויקטים, +, לאישור (neutral badge), הגדרות | Active tab is violet icon and label |
| Bottom sheet | scrim, grab handle, title, ✕ | ✕, scrim, swipe, and Android back save a valid pending change, then close. An incomplete change stays open and says why, with ביטול השינוי beside that sentence. A second dismiss discards it and closes. A dismiss during a save waits for the save, then closes. Push a history entry. [0075](../decisions/0075-save-on-tap-and-on-leave.md) |
| Empty state | icon, title, one line, at most one button | No emoji. Positive wording when the work is done. The action, here and on an error state, is the standard 44px button in the secondary (tint) style, never the 36px pill (FLOW-328; style set by the design lead in cycle 4) |
| Skeleton | bars shaped like the content, shimmer 1.4s | Known chrome stays real. `ld-01`…`ld-03` |
| Busy button | same size, spinner + verb ("מאשר…") | Other actions on that screen go disabled. `ld-04` |
| Processing | progress, step list, "המשך ברקע" | Invoice `ld-06`. Bank `ld-05` is not a build task ([0065](../decisions/0065-review-round5.md) point 40) |
| Pull to refresh | spinner over live content | `ld-07` |
| Offline | full screen if nothing is cached (`ld-08`); tinted notice if cached (`ld-09`) | "ניסיון חוזר" |
| Toast | under the header, clear of the actions. 2.5 seconds, 4 for an error, tap or swipe to dismiss, one at a time | `role="status"`. The host ignores taps. A tall toast may cover the grabber and the empty top of a sheet. It keeps `--space-2` from the safe area and never covers a header control. [0069](../decisions/0069-back-and-one-tap-review.md), [0075](../decisions/0075-save-on-tap-and-on-leave.md) |
| Date picker | field, single sheet, range sheet | Sunday first, א׳ on the right. [0027](../decisions/0027-date-picker.md) |
| Period sheet | radio rows apply on tap, plus custom range | [0028](../decisions/0028-period-sheet-with-custom-range.md) |
| Confirmation sheet | question, item, consequence, action, quiet ביטול | [0030](../decisions/0030-confirmation-sheets.md) |
| Google button | default, pressed (12% overlay), focus, loading ("מתחברים…"), disabled (38%) | Text exactly "המשך עם Google". [0033](../decisions/0033-google-sign-in.md), guide §7.24 |
| Logo | wordmark and S1 icon | [0031](../decisions/0031-logo.md), [LOGO.md](../../design/logo/LOGO.md) |

### 2.9 Tailwind `@theme` mapping

Decision [0040](../decisions/0040-tailwind-v4.md) and guide §2.1:

- Import [implementation-tokens.css](../../design/system/implementation-tokens.css) once.
- Map colours (light and dark), spacing, radii, the type scale, and shadows into `@theme`.
- Use `@theme inline` so utilities point at the CSS variables. Light, dark, and `data-theme` then stay in the token file.
- Screen code uses those utilities only. An arbitrary value needs a written reason.
- RTL: `dir="rtl"` on the root, and logical utilities (`ms-`, `me-`, `ps-`, `pe-`, `start`, `end`).
- No component kit. Sheets use Vaul.
- Font is Rubik, self-hosted in the product plan ([0038](../decisions/0038-stack.md), [tech-plan.md](../tech/tech-plan.md) §1.4.1). The token file's comment still shows the Google Fonts link used by the design boards.

The Phase 0 app maps a subset in [app/src/styles/app.css](../../app/src/styles/app.css) (`bg`, `surface`, `text`, `band`, `logo`, `gsi-*`, and three radii). Reviewers treat the token file as the full set. A screen that needs a token not yet in `@theme` adds the mapping. It does not hard-code the hex.

---

## 3. Implementation rules

Source: [implementation-guide.md](../../design/system/implementation-guide.md). MUST means the screen is not done. SHOULD means do it unless the PR says why.

### 3.1 Templates

| Template | Screens | Tab bar | Band |
|---|---|---|---|
| A | Review, Projects, Categories, Upload results, Unpaid, Settings | yes | no |
| A+band | Home, Project | yes | yes |
| B sheet | Add, Change, period, date, confirms | underneath, dimmed | no |
| C full screen | Onboarding, Transaction detail, Split, install | no | no |

Notifications (`13`) is a lock-screen reference, not an app screen. Guide §3.

The band holds only the summary. Home: one period pill, one label and the hero number (FLOW-355); the project band keeps the period bar ([0141](../decisions/0141-period-bar.md)). The label says "הפסד" when the figure is negative, and "החודש" when that period is selected. נכנס and יצא sit below the band, and the comparison sits under those rows. No greeting and no wordmark on Home. Project: back, project name, profit, income and expenses. Do not put the band on sheets, onboarding, or for emphasis. [0069](../decisions/0069-back-and-one-tap-review.md). Guide §3.2.

### 3.2 Layout grid and viewport

- Designed at **390px** wide, captured at 390×844 @2x. [design/README.md](../../design/README.md).
- Must work from **320 to 480px**. Amounts never wrap. Above 480px, centre a column (`--content-max: 480px`). No desktop layout. [0015](../decisions/0015-installable-mobile-web-app.md), guide §4.
- Sides 24px. Cards inset 16px. Sections 36–40px apart.
- `viewport-fit=cover`. Pad with `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)`. Do not hard-code 47px or 34px.
- Tab bar is 52px plus the bottom safe area (86px on a notched iPhone). When that inset is 0, an 8px floor (`--tabbar-min-inset`) keeps the labels off the screen edge ([0045](../decisions/0045-phase-0-design-gaps.md)). Content pads so the last row is not hidden.
- When the keyboard is open, hide the tab bar and keep the focused field visible.
- Portrait, `display: standalone`. Guide §4 manifest excerpt.

### 3.3 Tap targets and thumb zone

- Minimum hit area **44×44** (`--touch-min`). Buttons and inputs are 52px tall. The + button is 48px. Chips drawn at 36px still hit 44px.
- A row toggles or navigates across its full width. A row rendered as a button starts its copy on the start side, like any other row (FLOW-326).
- Primary actions sit at the bottom of sheets and full-screen flows, in the thumb zone. The tab bar is the persistent thumb-zone navigation. Guide §3 and §4.

### 3.4 RTL

- `<html lang="he" dir="rtl">`.
- Logical properties only. Start is the right. Do not reverse flex rows by hand.
- The design chevron `back` already points right. Do not flip it again.
- Steppers and "earlier / later" arrows are SVG chevrons that point outward (the start-side one points right, the end-side one left), never ‹ › glyphs, which right-to-left text mirrors (FLOW-411). Do not mirror +, ✓, ✕, search, calendar, or ▼/▲.
- Every amount, percent, date, time, phone, and company number is an isolated LTR span (`.num` or `<bdi dir="ltr">`).
- LTR inputs (`dir="ltr"`, `inputmode`) stay visually right-aligned. That is the one allowed physical `text-align`. Guide §6.
- A text, amount, or percent field focuses from a tap anywhere in the box. The input fills the box. ₪ and % sit outside the digits and ignore the pointer. The font is at least 16px. `autocomplete` is off, and the name is not a contact field. Amounts and percents use `inputmode=decimal`. A value up to `9,999,999.99` stays fully visible at 320px. [0069](../decisions/0069-back-and-one-tap-review.md).

### 3.5 Numbers, currency, dates

Guide §6.4 and §11.3. Do not use `Intl.NumberFormat('he-IL', {style:'currency'})` (it puts ₪ after the number). Do not use dotted `he-IL` dates.

| Kind | Format |
|---|---|
| Money | `₪200,000`. ₪ before the digits, no space, thousands commas, whole shekels on summaries |
| Agorot | Only on detail, the review card, and edit fields, and only when non-zero |
| Negative loss | Unicode minus U+2212 before ₪, in `bad`: `−₪10,000` |
| Row sign | `+` or `−`, amount stays `text`. A figure already labelled הוצאות (project band, category rows) carries no minus (FLOW-328). Home's יצא carries no minus for a cost; only a period where refunds beat costs reads with a minus (FLOW-334 H3) |
| Percent | `27%`, whole numbers |
| Change | `▼ 10%` or `▲ 8%` in a pill |
| Date | `22/09` this year, `21/09/2026` full, range `01–30/09` |
| Week | Sunday first. Gregorian. [0027](../decisions/0027-date-picker.md) |
| Time | 24-hour `18:00` |
| Relative | `היום`, `אתמול`, `לפני 3 ימים` |

Figures read in a row get a spoken pause between them (hidden text, not a visible separator). A list that changes its grouping keeps its rows mounted where it can, so focus is not lost (FLOW-313).

Home rounding: whole shekels, never "1.3M" or "אלף". The visible profit is rounded income minus rounded expenses, so the line adds up. If the hero does not fit, step to `display` (36px). Do not scale continuously. The hero number stays the on-band white, including a minus. A loss is named "הפסד" in the label, because red on the violet band does not read. Figure budget on Home: the label, the profit, one explanation, הכנסות, הוצאות, the comparison under those rows, the pending count, the unpaid total, and up to 5 projects (FLOW-411). [0069](../decisions/0069-back-and-one-tap-review.md). [guide §1 P2](../../design/system/implementation-guide.md), §11.3.

P&L figures are before VAT. [0041](../decisions/0041-amounts-before-vat.md), [0043](../decisions/0043-assumed-vat-on-expenses.md).

### 3.6 Copy tone

Guide §11.1.

- Short, friendly, direct, second person. One line where possible.
- Gender-neutral: plural imperatives ("העלו") and noun buttons ("אישור", "שמירה", "ביטול"). Avoid "אתה" / "את".
- Plain words: רווח, הכנסות, הוצאות, חשבוניות פתוחות, הוצאות כלליות. Every money word comes from the table below.
- Splitting a line is always "פיצול" (verb לפצל, past פוצלו), never "חלוקה". Owner pick, 2026-10-08 (FLOW-328).
- No exclamation marks, no emoji, no ALL-CAPS English.
- Hebrew punctuation: ״ ׳, en dash with spaces, middle dot.
- A status line that can wrap at 320 puts its time phrase on its own line. No wrapped line starts with a "·" separator (FLOW-508).
- Errors say what happened and what to do, without blame.
- English only in the wordmark "Flow" and the example-data tag.
- Sample figures must show **נתוני דוגמה · Example data**. Real data must not. Guide §11.2.

#### Money terms

One word per idea, in plain Hebrew that an accountant would also accept. Owner pick, 2026-10-09 (glossary card, "לאשר הכול"). New copy, MCP replies and docs use these words.

| Idea | Write | Not | Plain meaning |
| --- | --- | --- | --- |
| Profit | רווח · רווח החודש | רווח נקי | Income minus expenses, before tax. "נקי" means after tax. |
| Cash flow | תזרים · תזרים החודש | | Money into the bank minus money out, loans included. |
| The two rows under profit | הכנסות · הוצאות | נכנס · יצא | נכנס · יצא are for the cash view only, so the words say which view is open. |
| Kept out of the P&L | לא נספר ברווח (on cash: לא נספר בתזרים) | מחוץ לרווח, מחוץ לרווח והפסד | A line that is not part of the profit, like a loan received or principal. |
| Counted | נספר ברווח | ברווח והפסד | The line is part of the profit. |
| Company overhead | הוצאות כלליות | כלליות | Company costs that belong to no single project. |
| Basis (FLOW-103) | לפי תאריך החשבונית · לפי תאריך התשלום | בסיס מצטבר, בסיס מזומן | Which date puts a line in a month. |
| Month not over | חודש פתוח | בתהליך | No final profit or loss yet. |
| Margin | רווחיות | | Profit as a percent of income. |
| ARV minus purchase and rehab | השבחה צפויה | הון מאולץ | The value the rehab adds. |
| Value today minus loans | הון עצמי בנכס | הון נוכחי | How much of the property is yours. |
| Purchase price | מחיר רכישה | מחיר קנייה | |
| Customer invoices not paid yet | חשבוניות פתוחות · לגבייה | לא שולמו, טרם נגבה | Sent to a customer, no money in yet. |
| Refund from a supplier | החזר מספק | הוצאה שהוחזרה | Lowers expenses. |
| Refund to a customer or tenant | החזר ללקוח | הכנסה שהוחזרה | Lowers income. |
| Loan parts | קרן · ריבית · מסים וביטוח | | Principal is not an expense. Interest and escrow are. |
| Default income category | הכנסה מלקוחות | תקבול מלקוח | A receipt (תקבול) is any money in, a loan too. Income is what counts in profit. |
| Loan received / owner money | קבלת הלוואה · השקעת בעלים · משיכות בעלים | תקבולי הלוואות, הון בעלים | None of these is income or an expense. |

### 3.7 Patterns from the design log

Folded in from [design log](log/README.md) `Rule:` lines at UI/UX cycles 6 to 18 (2026-10-10), plus sign-offs since. The id in brackets names the log entry.

**Headers and navigation**

- A stacked page with Back pins a compact bar once its large title scrolls off. The bar is 44px under the safe area and shows Back and the title in `title-3` on one line with an ellipsis, over a `line` hairline on the page background, with a 120ms fade (none with reduced motion). Month heads pin under it. There is no bar on inline headers, tab roots, or screens with their own leading control. [0156](../decisions/0156-labelled-back-and-compact-bar.md) (FLOW-334 H1).
- A page under Back titles at 28px; tab roots keep `title-1` 34. Back's chevron point, the title and the rows share one start edge, and ✕ sits on the end edge (owner feedback on FLOW-347 shots, #355).
- With Back and a kicker, the kicker becomes Back's label ("‹ הגדרות"), in `label` and `accent-text`, cut at about 16 characters. It shows only when Back really goes there (FLOW-334 H2).
- A review queue's header uses `layout="inline"` even with Back, so the card and its pinned bar stay off the tab bar at 375×667. הצגת הכול sits on the start side of the counter row, and a card opened from the list leaves it out (FLOW-327).
- A linked transaction row carries the trailing chevron. A row that opens something keeps one trailing control: when ⋯ holds the end slot, the title and count are the link and ⋯ is its own 44px button (FLOW-326, FLOW-334).
- An app-wide gesture borrows the screen's own control for its action, never a second route of its own (FLOW-332). A swipe on a band figure follows the direction of the arrows it duplicates (FLOW-335).
- Search is entered from a 44×44 thin outline magnifier (SVG, stroke 1.6, no fill) at the end corner of a header or band, named "חיפוש תנועות". On the search screen the field and its chips sit in a dock above the keyboard and results fill the space above. Matched text gets the `.ui-match` tint, never colour alone (FLOW-323).
- A stacked page's own control (the period pill) sits under the title on the start side, in `ScreenHeader`'s `below` slot, not in the top end corner. The subtitle and count line then don't repeat it (FLOW-334).
- A sideways swipe repeats a control already on screen and never replaces it. One set of rules: touch only, 24px edge zones (the 24th px included) left to swipe-back, nothing inside a field, a sheet or a sideways list, decide after 10px and give vertical moves to the page, follow the finger and commit past 30% or a flick, stay put toward an end, swap on release with reduced motion, and no swipe while pinch-zoomed. In RTL a finger moving right goes forward (FLOW-314).
- A row that can be removed can also be swiped toward the start side, over a neutral "הסרה"; its ✕ stays as the named control. Red and the bin stay for real deletes (FLOW-325).
- A reload opens the page fresh; only a `?sheet=` link opens a sheet on load (FLOW-310).
- One search entry per screen. A filter that misses offers the wider search as a row with the typed text ("חיפוש בתנועות: …"), not an empty state (FLOW-342).
- A period pill or chip uses the period sheet's row name (חודש, 3 חודשים, שנה, הכול) while the window ends now, and the month name once it steps back ("ספטמבר 2026"). Subtitles and the band keep their phrases (FLOW-351).
- A sheet closed with Escape returns focus to its opener with the focus ring showing; closed by touch, focus returns with no ring (FLOW-310).
- A card opened from a list walks it from a quiet row pinned at the bottom (thumb zone, on the safe area): הקודמת on the start side, הבאה on the end side as accent text links with 44px hit areas and no glyphs, and a muted "N מתוך M" between them. At a list end that word is hidden with `visibility` and keeps its box, so the counter stays centred, and focus waits on the counter. The row is filled with `bg` and shows a top hairline only while content is under it. A card opened from a link shows no row (FLOW-345).
- Mid-drag, the neighbour's edge peeks in from the side it will enter, with its name when the prefetch holds it. Toward a list end the card gives a quarter of the move, at most 32px, and springs back. Reduced motion: no follow, no peek (FLOW-345).

**Pinned bars, notes and toasts**

- A screen's repeated action sits in a pinned `ActionBar`, above the tab bar (`place="tabbar"`) or on the screen edge with the safe area (`place="edge"`). The content scrolls above it with bottom padding of the bar's height. That screen's toasts sit `--space-2` above the bar, never over it (FLOW-327).
- A note above a pinned bar is one line (the `slim` banner): title, link, close. When they don't fit, the link wraps under the title (review slim banner).
- A pinned bar takes as few rows as its content needs. A currency's figures are one unit: 8px inside a pair, 24px between currencies, and a pair that doesn't fit wraps whole, start-aligned (FLOW-313).
- An entry field that can hold a long amount gets the row's full width. When the list it grows pushes the add action down, the action moves into the sticky bar. A warning shows in one place only (FLOW-333).
- A sheet closes with ✕ (and scrim, Escape, swipe). A text ביטול belongs only on a confirm sheet (FLOW-339).
- A text link's 44px hit area may grow into empty space or below it, never up or across into another control's box (FLOW-339).
- A toast after a sync says what changed ("3 תנועות חדשות"), not only that it ended (FLOW-509).
- A warning shows in one place only. When that place is the tap target, the footer adds only the way out (FLOW-343).
- With the keyboard open on a short screen, a sheet gives up its top gap before it hides its first field (FLOW-310).
- A tinted note under a demo frame shares the frame's inset; a focused control never hides (FLOW-506).

**Rows, figures and empty values**

- A transaction row's meta line is one line. It shows whole parts in order, as many as fit, and a part that does not fit drops with its "·". Only a lone first part too long on its own ends in an ellipsis. Breakdown lines put the date first (FLOW-124).
- One signal per row: an icon with a hidden word, not a chip. A status chip is not a button. A group folds in place with a down chevron (FLOW-401).
- A header figure comes from the same lines the screen lists. A missing figure is "—", not ₪0, and with no lines there is no count (FLOW-334, FLOW-401).
- An amount in another currency than the project's is listed apart ("ועוד $120,000 בדולר") and never added in. The company currency's row comes first in every per-currency list (FLOW-404, FLOW-504).
- A figure that needs a missing input names it ("חסר שווי אחרי שיפוץ", in the link colour for the owner, muted for a viewer). When the parts don't add up to the total, show the total and say the breakdown is not available rather than rows that disagree (FLOW-404).
- A list titled as a cost (שיפוץ) carries no minus, and its rows add up to the total above them (FLOW-404).
- An expected or typical figure (from patterns, not the books) reads "כ־" plus whole units through `ApproxAmount`, never a minus, and is never added to a band, a total or the profit. A forecast row carries one figure, with the breakdown in a sheet one tap away. A Home row warning that something is missing is a count with no total (FLOW-403).
- A row that opens in place says so with a ▾ cue at its end, and the same control looks the same on the card and the detail (FLOW-315).
- A row whose name is its identity wraps (up to 2 lines) before it truncates. A class that styles a figure is never reused as a layout wrapper (FLOW-339 loans).
- Text is placed against text by layout, never by counting characters (FLOW-310).
- A borderless card lines its content up with the title through its row padding, not the card margin. A bordered card keeps the side gutter (FLOW-334 split).
- A hint part shows whole or not at all. Only a first part too long on its own, or a state to act on, ends in "…" (FLOW-339 Search).
- A whitelisted ellipsis is for stress copy, not real labels. A real label that ends in "…" at 320–390 gets a new layout (size to content, a short form, or a second line) (FLOW-310).
- A list that is found, not browsed (Search), shows who and how much on one line, with detail one tap away. A month figure says what it is ("נטו") (FLOW-339 C).
- A list grouped by something other than the month (שויכו היום by project) uses the month head's shape: name, line count in muted `meta`, totals; rows drop what the head says (FLOW-334).
- An amount is always shown in its own currency (FLOW-408). A hint says what really decides the number (FLOW-329). A project's split line shows the project's part, with the whole amount in the hint (FLOW-344).
- An empty state says why it is empty; a missing number is never shown as zero (loans). A skeleton is the height of what replaces it (FLOW-115).
- A head's totals draw agorot the way the rows under it do; a list never mixes full-size and small agorot (FLOW-334).
- Rows that read as a pair (income and expenses) sit on the list pitch, not a section gap (FLOW-334).
- A hint's date or age is never split across lines; a wrapping hint breaks before its "·". A date in the current year drops its year when space is tight; it is never clipped (FLOW-353).
- A finished item drops the figure that no longer matters and keeps the words that say how it ended ("נפרעה") (FLOW-138).
- A counter whose digits change in place ("N מתוך M") uses tabular digits and reserves the total's digits (FLOW-309).
- A control's tap area doesn't set the height of the row it sits in (FLOW-334).
- A percentage shows only the digits it needs, never trailing zeros ("6%", "10.5%") (FLOW-347).
- An icon that is the same on every row may drop below 360px to give the name its line (FLOW-347).
- A figure's tax and date ride on its one meta line ("לפני מע״מ · מע״מ ₪1,530 · 21/09/2026"). Status words show only when they change what the number means ("מע״מ משוער") (FLOW-339).
- At 320 a pill beside an amount wraps under the amount; the amount is never cut or wrapped (FLOW-327).
- A summary page lists one row per topic with one figure each, and each row drills down. Detail such as bars, cards and long lists lives on the row's own screen (FLOW-340 C).
- A line that doesn't count toward profit fades its icon, name and amount wherever it is listed. Its kept-out hint keeps full muted contrast, so it still passes AA (FLOW-340 C, cycle 11).
- A repeated head keeps one shape down a list. A short name or a single line does not move the figures (FLOW-325).
- In a list where only some rows open, the rows that don't open keep the chevron's space, so the amounts line up (FLOW-334).
- A row that leads to the review queue looks like Home's review row, with the inbox icon and tint, never like a list item (FLOW-334).
- A link that writes before it navigates shows busy in place and ignores presses until the write settles. It stays put when the write fails (FLOW-325).
- The bin icon and red mark real deletes only (FLOW-334).
- Every money word comes from the Money terms table in §3.6. A by-month row's hint shows הוצאות only when the month has income, and no hint when income is 0 (money terms, #367).
- A skeleton's height counts the hints its loaded rows carry (FLOW-115).
- A status the page leads with is not repeated as a row; where the row was its only way to change, the change sits beside the status (FLOW-356).
- A group reads like a project row with a count, never a header with a total; its page and its row show the same figures from the same read (FLOW-406).
- On Home, attention rows sit under the first project rows, so the first screen always shows a project (FLOW-355).
- A long amount in a narrow card shrinks to fit; it is never cut or wrapped (review card at 320).
- A wrapped hint line never starts with "·"; the separator ends the part before it. One date shape across the app: dd/mm (FLOW-356).

**Sheets and settings**

- A short read-only list that belongs to one card opens as a bottom sheet, not a pushed page. An edit sheet focuses its title, not the field. A link or retry in a sheet uses the 44px text-link size, with a retry on its own line (FLOW-404).
- A sheet lists only actions that work today, with no "coming soon" and no disabled-only rows. A quick action that opens a sheet on another screen lands with a one-shot `?new=<what>` (FLOW-331).
- A destructive row sits last in a sheet, after a 1px line or in its own group. A refused one stays visible, disabled, with its reason. A delete confirm that can lose data offers the safe path as a quiet link under ביטול (FLOW-405, FLOW-335).
- A rename is a one-field sheet with שמירה in the action slot and an undo toast, with no confirm (category rename).
- A reversible per-item setting is a labelled switch row, not an overflow menu item. It shows a hint only in the state that needs one and is locked with one reason when something else decides it. ⋯ appears only when it holds something (FLOW-329).
- A setting with two to four short fixed values inside a card is a `SegmentedControl` that applies on tap. A setting with a few fixed choices that converts nothing is a sheet of radio rows that apply on tap with an undo toast. A dependent setting is hidden, not disabled, while it means nothing (FLOW-702, FLOW-504).
- A busy control (a save in flight) uses the disabled look until it settles, keeping focus and its selection. A disabled text link is grey with a not-allowed cursor and no press fill (FLOW-331, FLOW-327).
- A form's save stays enabled. A tap on it with empty fields shows, under each one, what to type ("כתבו את שם המלווה."), and moves focus to the first empty field. A 0 is "too small", not missing (FLOW-115).
- A record with several independent settings (a loan) gets its own page of eyebrow rows; each row opens one small sheet that saves on its own, with ביטול in the toast. A sheet shows its own refusal inside; other failures toast. A date that can't precede an event disables the earlier days and says why under the sheet title. Finished items stay on their list, muted, under a collapsed "label (N)" link (FLOW-106).
- A menu row is a short label with no sentence; the consequence lives on the sheet that does the write. Two actions that differ by one side effect are one row, with the side effect as a switch on the next sheet. The bin icon is for real deletes only: a merge stays red without it, and an undoable action (hide) gets a neutral button (FLOW-341).
- A computed preview shows only for valid input and never keeps a stale result, dimmed or not (FLOW-344).
- Every empty and error state action is the 44px tint button, never a filled primary, a retry included (FLOW-334).
- A read-only view shows state, not progress through a task it can't do, and never a warning that asks for a write (FLOW-507).
- A setup step with two ways in keeps one primary button and puts the other as a full-width secondary under it, never a second primary (FLOW-503).
- A choice between "all" and "from a date" is a two-option `SegmentedControl` with the date field under it only while the date option is on; the field reserves its message line (FLOW-505).
- A demo or storyboard draws the shared component, or its presentational picture, never a hand-built copy (FLOW-506).
- A sheet whose form can grow pins its main action in the sheet's foot. A destructive secondary stays in the body (FLOW-350).
- A menu's actions are rows, not a row list plus a separate button (FLOW-334).
- A picker row whose tap writes something says what it writes in its description. A row that can't be picked stays listed, off, and says why in the same place. Pickable rows come first (FLOW-106).
- A field whose value comes from a list of more than three choices opens a picker view inside the same sheet, not a segmented control. The line under a picker option uses the row hint style, never the label style (FLOW-106, FLOW-352).
- A sheet with nothing to pick says why and offers the next step (FLOW-115).
- A question on a step with a pinned action sits above the step's demo, so its answers show on arrival (FLOW-353).
- One level of nesting, and one word for it: קטגוריית אב, opened by drilling in, never by expanding rows in place. The parent row carries a count and a chevron; leaves keep their line count and ⋯ (FLOW-406).
- A form or list that appears in two places is one component, so a fix lands in both. A one-time question shown in two places shares one answer (FLOW-506, FLOW-502).
- A line that asks the user to fix a sum prints the gap, not the target they must add up to. A waiting state says what changed. A row that is saving keeps focus (FLOW-115).
- A form whose parts must add up to a total says in one place, its summary row, what is still missing or over ("חסרים $x" / "עודף $x"), and its save stays off until they match. This is the one exception to a save that stays enabled (FLOW-106, cycle 12) A running total carries its own state; no second line repeats it (FLOW-353).
- Every setup step's title starts at the same height; a step without a back, a דלג or a count keeps their space empty (FLOW-356).
- A setup choice with a safe default opens on that default and has one button (FLOW-406).
- A role change applies on tap and offers ביטול; removing a person asks first, because the toast cannot undo it (FLOW-601).

**Review card and Jev**

- The label column has one width (`--review-label-w`). Every pill ends at the chevron column with at least `--space-2` before the value. Under 25rem of card width the הצעת Jev pill shows only ✦, with its words as the accessible name (FLOW-327).
- When the card needs a choice, the main button names the next pick. An anomaly flag is loud at a Jev score of 0.7 or more and quiet below it, at most one per card, as the last block. An amount spike is not a flag row: it is a "↑ N%" warning pill beside the amount, with "בדרך כלל ₪X" on one muted line under it; a loud spike's pill reads "לבדיקה:" first for screen readers. At 320 the pill wraps under the amount, which is never cut (FLOW-327).
- On a short phone (up to 720px tall) the document tile is square and rows sit 8px under their hairline, so a card with one Jev line and a quiet flag fits above the pinned bar (FLOW-333 C13).
- When a queue card leaves with focus in its action bar, focus goes to the next card's first button, or to the empty state's action; a tap that didn't focus the bar moves nothing. The queue's blocks stay on the 8px step, trimmed only on short phones (FLOW-309).
- Jev's fill is named with ✦ and the word Jev wherever the value shows; only "✦" when there is no room, never הצעה. With Jev on and no key, its Settings row says "אין מפתח" (FLOW-704).
- A value an automatic job filled says who filled it and how to undo it, in one line with no reason. Turning the job off keeps that line and its undo, with no new suggestion (FLOW-331, FLOW-702).
- A connector invoice its receipt paid shows one muted line under the amount, under the VAT line: ✓ "שולם · קבלה dd/mm", or "שולם חלקית · קבלה dd/mm" with no ✓. With no receipts there is no line. The supplier name wraps to three lines before it ends in an ellipsis (FLOW-309, #371).
- While Jev's read waits and a row shows a skeleton, the card holds the hidden ✦ line under its rows, so the reason or "מולא ע״י Jev" lands without moving the card or the action bar. A card whose rows are all stored, a shared cost and a split_mismatch card hold nothing (FLOW-704).
- On a phone-width card (under 25rem) the ✦ line starts at the card's start edge, under the labels; from 25rem up it stays in the value column (FLOW-704).
- At phone width, a value that doesn't fit beside its pill takes the row's width, and the pill drops under it on the chevron side. A short value keeps its pill inline (FLOW-352).

**Band**

- The band's preset track is at most 10% white with white labels. Pressed darkens, never lightens. A label that opens a sheet ends in a 16px ▼. Home's hero has no explanation line under it (FLOW-355).
- A figure on the band stays white, a minus included. A loss is named in the label ("הפסד ..."), never by red on violet (FLOW-338).
- A label over several currencies' figures never says רווח over a loss. When the signs differ it names both: "רווח והפסד" (FLOW-339).

**Rows, amounts and settings (folded at cycle 15)**

- Whole amounts never show .00; agorot show only when they are not zero (FLOW-334).
- A project's name is its identity: it wraps to two lines before the ellipsis, and a row's hint stops at two lines too (FLOW-358).
- A name is cut only when it does not fit, never to protect words the row does not show (category lines).
- A skeleton row draws the loaded row's parts in their places: an icon slot where the row has an icon, the eyebrow's short bar on top of an eyebrow row, and an end bar only where the row shows a figure (FLOW-358).
- A search row says why it matched when the match isn't in its own name (FLOW-358).
- A company-wide setting is a Settings row with its value as the hint, a sheet that applies on tap, and an undo toast, like the currency (FLOW-103, FLOW-504).
- The copy says פיצול, never חלוקה. A category a loan's part writes to is locked the same way whether it is built in or the loan's own (FLOW-106, FLOW-356).
- A date sheet jumps years from its month title; the grid keeps the days' height (FLOW-115).
- The band label never repeats what the period pill already says (FLOW-358).
- Home shows money that needs a hand (review, open invoices, missing bills) whatever its main figure (FLOW-413).
- A project's group is changed from the project, never from the Projects tab; the tab only shows groups (FLOW-360).

**Cash, recurring and one editor (folded at cycle 16)**

- A label names the period it shows: "רווח החודש" only for the current month, "רווח ב<month>" for any other (FLOW-362).
- An empty state promises what its screen shows, and its line never ends on a lone word (FLOW-362, §2.8).
- A figure that doesn't match the rows above it says what makes up the difference, on a row that opens its lines ("לא נספר ברווח", FLOW-418).
- A drill-down summary row may carry one muted hint line under its label; a figure-only row has no chevron (FLOW-417).
- One set of numbers has one editor; the other places show it static with one way in (FLOW-362).
- A locked line that names something puts the kind on line 1 and the name on line 2, so the wrap never splits the name (FLOW-362).
- A recurring charge names its pace and day in one hint line, "כל חודש ב־N", then "· אחרון dd/mm" or "· זוהה לבד" when known. Hint parts wrap whole, and a separator never starts or ends a line: the "·" before a wrapped part is dropped (FLOW-415).
- A switch the line can't decide is a locked row whose hint names what decides it (FLOW-415).
- A yes says what it turns on: a permission card names every push it starts (FLOW-502).
- Month steppers are one quiet pager segment, never bare chevrons in the rows' drill-in column (FLOW-362). Both arrows always show; an end it cannot go past is dimmed and aria-disabled, not hidden (owner, 2026-10-10).

**Recurring, project cash and lists (folded at cycle 17)**

- An alert a user can hide for themselves ends in a muted 44px ✕ labelled "הסתרה, <name>", and the row also swipes toward the start over "הסתרה". The undo toast says "ההתראה הוסתרה". A hidden change keeps its row without its percent (FLOW-415).
- A change's ▲/▼ % sits beside the amount: red when it is bad news for the business (an expense up, income down), green otherwise (FLOW-415).
- One control per job: the switch turns a thing on or off, and the row's words open its detail. A word that opens a sheet is accent and ends in a ▾ (FLOW-415).
- In a list where some rows end in an action and some don't, every row keeps the action's place, so the figures line up. Every row in a list shares one fill (FLOW-415).
- A project's main page is its cash, laid out like Home's. Profit, investment and loans are one tap away (FLOW-419).
- A prompt card's question that wraps is balanced, like titles (FLOW-420).

**Projects, sheets and paging (folded at cycle 18)**

- A month page steps its months the same way everywhere: the pager segment by the title plus a swipe on the figure. Back names the page it returns to, a project by its name (FLOW-422).
- A screen Home opens only from an alert also gets a fixed quiet TextLink at the end of Home, so it stays reachable once the alert is gone (FLOW-423).
- A sheet row that drills into a list brings Back to the same sheet, open (FLOW-433).
- The project page is Home for one project: Home's rows, words and order, with the project's own figures and alerts. Its history pages name the project above the band label (FLOW-435).
- A bank-side name shares the row with its last 4: a card reads "כרטיס ••1234 · <name>", an account reads "<name> ••1234". The name clips; the card word and the last 4 never do (FLOW-707).
- A percent against the usual amount always names that amount next to it (FLOW-431).
- A month head's total is the whole month's, never a partial sum of the rows loaded so far. When the whole figure isn't known, the head shows none (FLOW-908).
- A set-aside row lays out like a counted row; only its colors change (FLOW-909).
- A split row's figure reads as the sum of the parts it names, out of the whole line: plain words, no pills, the date last and dropped first. "ועוד N" stays with the part before it (FLOW-432).
- A part worth $0 has no row (FLOW-434).
- Figures on one page agree: a schedule's principal still to pay equals the balance shown, and a count of parts counts only the parts that have a row (FLOW-427).

---

## 4. Screen index

Mockups are 390×844 at 2×, light and dark. Paths are under `design/`. HTML sources live in `design/src/` and are not the review images. Flows below are the approved behaviour from the guide §13 and the decisions. They are not a second spec.

Grids: [screens/overview-light.png](../../design/screens/overview-light.png), [screens/overview-dark.png](../../design/screens/overview-dark.png), [screens/overview-more-light.png](../../design/screens/overview-more-light.png), [screens/overview-more-dark.png](../../design/screens/overview-more-dark.png), [states/overview-states-light.png](../../design/states/overview-states-light.png), [states/overview-states-dark.png](../../design/states/overview-states-dark.png).

### 01 Home

- Mockups: [01-home-light.png](../../design/screens/01-home-light.png), [01-home-dark.png](../../design/screens/01-home-dark.png). Overhead on: [18-home-overhead-on-light.png](../../design/screens/18-home-overhead-on-light.png), [18-home-overhead-on-dark.png](../../design/screens/18-home-overhead-on-dark.png).
- Empty: [es-01-home-first-run-light.png](../../design/states/es-01-home-first-run-light.png), [es-01-home-first-run-dark.png](../../design/states/es-01-home-first-run-dark.png).
- Loading: [ld-01-home-skeleton-light.png](../../design/states/ld-01-home-skeleton-light.png), [ld-01-home-skeleton-dark.png](../../design/states/ld-01-home-skeleton-dark.png). Refresh: [ld-07](../../design/states/ld-07-pull-to-refresh-light.png).
- Entry: tab בית. Sunday notification. Returning sign-in. [0018](../decisions/0018-two-notifications.md), guide §7.24.
- Steps: the band's period pill opens 16. The hero is the label and the number. נכנס and יצא sit below the band. The pending card sits under the first two project rows and has a row to Review and a row to Unpaid with its total, each only when it has items (FLOW-321, FLOW-355). A project row opens 02. + opens 04. Overhead switch starts off ([0022](../decisions/0022-after-overhead-starts-off.md)). On, the hero stays company net profit ([0032](../decisions/0032-home-hero-stays-company-net-profit.md)).
- Back: none. This is a tab root.
- Success: the summary. Empty first run follows [0044](../decisions/0044-phase-0-shell-calls.md): the button is "חיבור בנק או SUMIT" and opens the connections page, and the line says the profit appears once a bank or SUMIT is connected (FLOW-328). No greeting and no wordmark ([0069](../decisions/0069-back-and-one-tap-review.md)).
- Error: skeleton while loading (`ld-01`). The loading band matches the calm hero. Offline is `ld-08`. A server load failure and the period pill are [0045](../decisions/0045-phase-0-design-gaps.md). Home no longer greets a missing name ([0069](../decisions/0069-back-and-one-tap-review.md) amends that sentence).

### 02 Project

- Mockups: [02-project-light.png](../../design/screens/02-project-light.png), [02-project-dark.png](../../design/screens/02-project-dark.png). Overhead on: [19-project-overhead-on-light.png](../../design/screens/19-project-overhead-on-light.png), [19-project-overhead-on-dark.png](../../design/screens/19-project-overhead-on-dark.png).
- Empty: [es-02](../../design/states/es-02-project-empty-light.png). Loading: [ld-02](../../design/states/ld-02-project-skeleton-light.png).
- Entry: a project row on Home or in the projects list.
- Steps: band header, overhead switch (same preference as Home), optional budget ([0014](../decisions/0014-optional-project-budget.md)), categories. With the switch on: before, overhead share, after. [0032](../decisions/0032-home-hero-stays-company-net-profit.md).
- Back: chevron, "חזרה", from one shared control. It returns to the screen that opened this one, and a fresh visit opens the parent. Browser back does the same. [0069](../decisions/0069-back-and-one-tap-review.md).
- Error: same loading and offline pattern as Home.

### 03 Review queue

- Mockups: [03-review-light.png](../../design/screens/03-review-light.png), [03-review-dark.png](../../design/screens/03-review-dark.png).
- Done: [es-03-review-done-light.png](../../design/states/es-03-review-done-light.png), [es-03-review-done-dark.png](../../design/states/es-03-review-done-dark.png). "הכל מאושר".
- Entry: tab לאישור, the Home pending card, or the 18:00 nudge. [0006](../decisions/0006-confirm-not-type.md), [0018](../decisions/0018-two-notifications.md).
- Steps: one card. Project and category are two short rows, with no confidence number. הצעה sits on a line that is a real suggestion. A split line is not one, and a card that only needs a category has no הצעה heading. When Jev filled that line's value, the pill reads "✦ הצעת Jev" on `tint-strong` instead (`JevTag`, ✦ hidden from readers, one line); a supplier rule or a value the user set never carries it. The value cuts with an ellipsis before the pill and the chevron at 320. אישור accepts a complete card. It stays disabled, with a not-allowed cursor, while a remembered Jev on is still unconfirmed or a known-on read is still settling, and when the card says אין הצעה. That read ends within a second, and the card then keeps today's values. A failed read is off. While it waits, a note that will remain reserves its line with no pill and no words, and a card that settles without a note reserves nothing. The list paints as soon as it loads. The card waits on the signed-in user and company for at most a second before it reads the remembered flag. When this user has no remembered on, the stored card paints on the first frame. A miss skips that flag and reads the connector: off leaves the stored card approvable, and on waits for the suggestion. A reload remembers whether Jev was on for that user and company, including when לאישור is the first screen. Sign-out clears that flag. An expired session, a sign-out in another tab, and a switch to another user drop the in-memory connector cache as well. A categorised split closes the review and keeps the shares. Change opens 06. A plain אישור does not write a supplier rule. [0069](../decisions/0069-back-and-one-tap-review.md), [0075](../decisions/0075-save-on-tap-and-on-leave.md). High-confidence rows never appear here. [0011](../decisions/0011-auto-approve-high-confidence.md).
- Banner: when rows were assigned today without waiting, "N תנועות שויכו היום בלי להמתין בתור". צפייה opens "שויכו היום". A row opens that transaction. Back returns to the queue. סגירה hides the banner for this visit. [0069](../decisions/0069-back-and-one-tap-review.md). An assistant approval in that count drops the queue clause, a count of 1 is singular, and the empty body covers both sources. [0080](../decisions/0080-mcp-connector.md).
- Back: none on the tab. Change and Split close back to the card.
- Success: the card leaves and the visit meter advances. The queue-done empty state when none remain. A toast, when it shows, sits under the header and does not cover דלג. Approve can still offer ביטול on that toast. [0069](../decisions/0069-back-and-one-tap-review.md).
- Error: save failure toast (`er-05`).

### 04 Add

- Mockups: [04-add-light.png](../../design/screens/04-add-light.png), [04-add-dark.png](../../design/screens/04-add-dark.png).
- Entry: the + button.
- Steps: the sheet opens over the screen that opened it. A direct `/add` still shows Home underneath. Until capture ships ([0020](../decisions/0020-capture-from-the-phone.md)), three quick actions (FLOW-331): פרויקט חדש (the project sheet on Projects), הלוואה חדשה (the new-loan sheet on Loans), חיבור בנק (the Mercury sheet on Connections; "מחובר" as the hint line when connected, "צריך לחבר מחדש" in warning when it needs it). No hints and no line about features to come. A tap replaces the sheet's entry, so Back from the target does not reopen it. Closing returns focus to +.
- Cancel: ✕, scrim, swipe down, or back. Guide §3.3.
- Success: processing screens [ld-05](../../design/states/ld-05-upload-processing-light.png) (bank) and [ld-06](../../design/states/ld-06-invoice-reading-light.png) (invoice), then results or the new row.
- Error: [er-01-bank-file](../../design/states/er-01-bank-file-light.png) wrong file. [er-02-invoice-blurry](../../design/states/er-02-invoice-blurry-light.png) unreadable photo. Each has a dark twin.

### 05 Projects

- Mockups: [05-projects-light.png](../../design/screens/05-projects-light.png), [05-projects-dark.png](../../design/screens/05-projects-dark.png).
- Empty: [es-04](../../design/states/es-04-projects-none-light.png). Search miss: [es-06](../../design/states/es-06-search-none-light.png). Loading: [ld-03](../../design/states/ld-03-list-skeleton-light.png).
- Entry: tab פרויקטים.
- Steps: search, open a project, create, archive (sheet 21). [0009](../decisions/0009-scalable-pickers.md).
- Back: none. This is a tab root.
- Error: list skeleton, then offline notice.

### 06 Change assignment

- Mockups: [06-change-sheet-light.png](../../design/screens/06-change-sheet-light.png), [06-change-sheet-dark.png](../../design/screens/06-change-sheet-dark.png).
- Entry: Change on a review card.
- Steps: pick a project and a category. Remember-for-supplier starts on and previews the rule. Save. [0006](../decisions/0006-confirm-not-type.md), [0009](../decisions/0009-scalable-pickers.md).
- Cancel: ✕, scrim, swipe, or back. Nothing is saved.
- Success: toast, card updated. Error: [er-05](../../design/states/er-05-save-failed-light.png).

### 07 Categories

- Mockups: [07-categories-light.png](../../design/screens/07-categories-light.png), [07-categories-dark.png](../../design/screens/07-categories-dark.png).
- Income empty: [es-07](../../design/states/es-07-categories-income-light.png).
- Entry: Settings → קטגוריות.
- Steps: expense and income segments. Rename, reorder, hide (23), merge (22a then 22b). Delete only when the category has no transactions. [0008](../decisions/0008-flat-categories-hide-or-merge.md).
- Kept out of the P&L: a ⊘ mark in `--color-text-muted` right after the name (`role="img"`, label "לא נספר ברווח"). The name keeps `--color-text`, so the row does not read as hidden, and only the name truncates. A legend line under the list explains ⊘ when the segment has a kept-out row. The row sheet's third button toggles the flag on tap, with a hint line under it and a ביטול toast. The three loan categories show a locked line instead. [0106](../decisions/0106-kept-out-toggle.md).
- Back: chevron to Settings.
- Success: undo toast after hide or merge.

### 08 Upload results

Not a build task. [0065](../decisions/0065-review-round5.md) point 40. The mockups stay for history.

- Mockups: [08-upload-results-light.png](../../design/screens/08-upload-results-light.png), [08-upload-results-dark.png](../../design/screens/08-upload-results-dark.png).
- Entry: end of a bank import (`ld-05`). That path is not built.
- Steps: summary counts. ✕ closes the task. Guide §13, template A with ✕.
- Error: stay on `er-01` if the file was rejected before this screen. That error is not a build task either.

### 09 Onboarding

First-run setup replaces this strip. The files stay. 09, 09c, and 09e are superseded and are not build tasks. 09b is merged into step 0 (פרטי העסק, uncounted) and then retired. 09d is merged into step 3 and then retired. 09a is unchanged. דלג sits in the top bar, not as a ghost under the primary. The counter is "שלב N מתוך 5". [0089](../decisions/0089-setup-runner.md).

- Strip (not a screen), superseded: [09-onboarding-light.png](../../design/screens/09-onboarding-light.png), [09-onboarding-dark.png](../../design/screens/09-onboarding-dark.png).
- 09a sign-in: [09a-onboarding-light.png](../../design/screens/09a-onboarding-light.png), [09a-onboarding-dark.png](../../design/screens/09a-onboarding-dark.png). No top bar, no progress. Wordmark, one value line, "כניסה או הרשמה", Google button, privacy line. [0033](../decisions/0033-google-sign-in.md), guide §7.24.
  - Cancel: [er-03-google-cancelled](../../design/states/er-03-google-cancelled-light.png). Neutral note. The Google button is the retry. No help link.
  - Fail: [er-04-google-failed](../../design/states/er-04-google-failed-light.png). Same note, red icon, and "צריך עזרה בכניסה?". `/help` is [0045](../decisions/0045-phase-0-design-gaps.md).
  - Success: a new account goes to step 0. A returning account goes to the screen it asked for when that screen is on the sign-in return list (FLOW-308), otherwise Home. The callback line names it ("נכנסתם. עוברים לאישור.").
- 09b company, merged into step 0 and retired: [09b-onboarding-light.png](../../design/screens/09b-onboarding-light.png). The live step has no counter and no דלג.
- 09c bank report, superseded: [09c-onboarding-light.png](../../design/screens/09c-onboarding-light.png). Not a build task. [0065](../decisions/0065-review-round5.md) point 40. The drawing shows a Hapoalim export. Do not build it.
- 09d projects, merged into step 3 and retired: [09d-onboarding-light.png](../../design/screens/09d-onboarding-light.png).
- 09e install and notifications, superseded: [09e-onboarding-light.png](../../design/screens/09e-onboarding-light.png). [0015](../decisions/0015-installable-mobile-web-app.md), [0018](../decisions/0018-two-notifications.md). Install is step 5. Notifications are not a step.
- Each of 09b–09e has a `-dark.png`. One primary per step. Guide §3.4.

### 10 Transaction detail

- Mockups: [10-transaction-detail-light.png](../../design/screens/10-transaction-detail-light.png), [10-transaction-detail-dark.png](../../design/screens/10-transaction-detail-dark.png).
- Entry: a transaction row.
- Steps: amount before VAT, VAT beside it, source, links. [0041](../decisions/0041-amounts-before-vat.md). Assumed VAT may show a subtle hint. [0043](../decisions/0043-assumed-vat-on-expenses.md).
- Loan split: "פיצול התשלום" lists ריבית, מסים וביטוח, קרן with a 24px icon each, amounts with a minus in the text colour, and a "סה״כ" row equal to the line. When the P&L counts by parts: "נספר ברווח <amount>" under the heading and "לא נספר ברווח" with an eye-off icon on a kept-out part. Transaction rows add "3 חלקים", or "ממתין לבדיקה" in the warning tone. [0107](../decisions/0107-loan-split-on-the-transaction.md). Mockup: [Loan split breakdown](https://claude.ai/artifact/MSVfZhxN56T2V6epZaQ25v) option A.
- Split (FLOW-325): a "פיצול" section with two rows, "בין פרויקטים" (11) and "לפי קטגוריות" (11a). A line split by category lists its parts instead (category, the project in the hint, the amount and its percent at the end, "השאר · <category>" for the rest) and a "סה״כ" row, as the loan split does; a part row opens 11a. The project and category rows then say "מפוצל · N חלקים · לא נספר כאן". An open review (other than `split_mismatch`) or a loan split keeps "לפי קטגוריות" visible but off, with the reason under it; a line of zero hides it. A viewer sees the parts only.
- Back: chevron. Delete opens 20. What delete removes is still an open question. [0030](../decisions/0030-confirmation-sheets.md).
- Prev and next (FLOW-303): opened from a list, the top bar is Back · title · ˄ ˅ ⋯. ˄ is the row above and ˅ the row below, in the order the list showed; the chevrons are not mirrored. A move replaces the history entry, so Back returns to the list at its scroll spot. At a list end the button stays, `aria-disabled` in `disabled-text`, with a hidden hint. While a card loads or fails, ⋯ keeps its slot and the title sits under the bar. A deep link or a one-row list shows no arrows. No position on screen; screen readers hear "תנועה N מתוך M". Swipe is FLOW-314. Mockup: flow-303 option A.
- Error: save toast `er-05`.

### 11 Split

- Mockups: [11-split-light.png](../../design/screens/11-split-light.png), [11-split-dark.png](../../design/screens/11-split-dark.png). Behaviour is [0069](../decisions/0069-back-and-one-tap-review.md) point 10 (Split v2: presets first). This amends the earlier "divide by amount or percent" rule: presets come first, there is no ₪ typing, and a manual percent sits behind "פיצול ידני".
- Entry: Split on a review card, or from detail.
- Title: "פיצול בין פרויקטים". Then the amount, then "איך לפצל?".
- Nothing is selected until a tap, unless a saved split is being re-edited. Four choices, one tap each: "שווה בין כל הפרויקטים", "שווה בין פרויקטים שאבחר", "לפי הכנסות", "לפרויקט אחד". Chosen opens a checklist of active projects. A ticked row shows its ₪ share. Nothing to type there. Income with no income in the period is disabled, with the reason "אין הכנסות בתקופה הזו". "לפרויקט אחד" opens the project picker. That picker does not offer "פיצול בין פרויקטים". The note above the list uses the hint colour, with space above and below it. [0075](../decisions/0075-save-on-tap-and-on-leave.md), [0076](../decisions/0076-collapse-split-to-one-project.md).
- "פיצול ידני" is a text link, not a default. The fields fit "100%", one decimal, at least 96px wide. The row focuses the input. `inputmode=decimal`, `autocomplete=off`, and the name is `split-pct-<projectId>`. "חזרה לאפשרויות" restores the previous choice.
- There is no שמירה button. A valid choice is saved by leaving. The saving row shows a small spinner in place of the check (`--spinner-radio`), and the other choices are disabled, with the disabled colour and the not-allowed cursor, until the save settles. The hold sentence is the muted hint. ביטול השינוי is the quiet link. One summary line, for example "₪250 לכל אחד מ־4 פרויקטים" when every part is the same amount, or "₪1,000 מתחלק שווה בין 3 פרויקטים" when an even split does not land on equal shekels, or "לפי הכנסות · N פרויקטים". Nothing chosen says "בחרו איך לפצל" in the primary text colour. A short manual split says "נשארו 30% לפצל". Over says "הסך 120%. צריך 100%." with only the total in the bad colour, and each row shows its own percent of the amount. A valid manual split says "הסך 100%" and "פיצול ידני · N פרויקטים". An invalid choice stays open. ביטול השינוי sits next to that sentence, and a second dismiss discards the change and closes. [0072](../decisions/0072-design-review-rulings.md), [0075](../decisions/0075-save-on-tap-and-on-leave.md).
- Displayed shekel parts put the leftover agora on the last project so the line adds up. The save sends those shares reversed, so the stored agorot match the screen. Stored shares still sum to 10000 basis points.
- Cancel: ✕. Guide §13.
- Success: toast "הפיצול נשמר", then close. Error: `er-05`, "הפיצול לא נשמר", with "ניסיון חוזר". Values stay.

### 11a Split by category

- Plan: `flow-325-line-split.md`, option A of its mockup (owner approved). Decisions [0123](../decisions/0123-line-split-percent-rest-reversal.md), [0075](../decisions/0075-save-on-tap-and-on-leave.md).
- Template C, ✕, title "פיצול לפי קטגוריות", the line amount in `display` (income green only here), then supplier · date.
- One parts card with no row hairlines. A part row: the category (and החזר on a reversal) over its project in the muted line ("<line project> · פרויקט השורה" when it has none); at the end a 2-option `%` / `₪` segmented control, the field, and under it the resolved figure (the cents for a percent, the share for an amount). A quiet ✕ removes the part. Tapping the text opens the picker on the category, then straight on the project.
- The rest row is tinted, inside the card, read-only: "השאר · <category>", "<project> · נשאר בשורה", and the live amount and percent. A tap changes its category or project. Over the line it shows the overrun with a minus in the bad colour and "לא נשאר".
- The resolved cents come from the server preview (`save_line_split(..., p_preview => true)`), debounced; nothing on the screen mirrors the per-part rounding. "הוספת חלק" is a text link with a plus, off at 49 parts.
- Refunds: on an inflow the category picker adds "החזר מספק"; a reversal part's project line says "פרויקט · חובה בהחזר" in the error colour until a project is picked, and its project picker does not offer the line's project.
- The sticky footer shows "פוצלו" and "נשאר לשורה" (or "עוברים את השורה" in the bad colour). No שמירה: ✕ and back save a valid change and toast "הפיצול נשמר" with ביטול; an invalid one shows the hold sentence with ביטול השינוי, and a second dismiss discards. "הסרת הפיצול" is a quiet bad-coloured link under the card, behind a confirm sheet.
- Every refusal has Hebrew copy (`app/src/line-split-copy.ts`); a reason about the line (open review, loan split, a line of zero, something changed) is a banner under the amount.

### 12 Unpaid

- Mockups: [12-unpaid-light.png](../../design/screens/12-unpaid-light.png), [12-unpaid-dark.png](../../design/screens/12-unpaid-dark.png).
- Empty: [es-05-unpaid-none-light.png](../../design/states/es-05-unpaid-none-light.png), [es-05-unpaid-none-dark.png](../../design/states/es-05-unpaid-none-dark.png).
- Entry: the unpaid figure on Home.
- Steps: list invoices that are not in the cash P&L until paid or marked paid. [0004](../decisions/0004-cash-basis-for-v1.md), [0007](../decisions/0007-bank-statement-is-primary-input.md).
- Back: chevron.
- Success: one tap marks a row paid (FLOW-330). The row stays listed, reads "סומן כשולם · ממתין לסנכרון" with a muted title, and leaves every unpaid total. Empty state when none remain.

### 13 Notifications reference

- Mockups: [13-notifications-light.png](../../design/screens/13-notifications-light.png), [13-notifications-dark.png](../../design/screens/13-notifications-dark.png).
- This is the lock screen, not an app screen. Guide §3.
- Copy and taps: [0018](../decisions/0018-two-notifications.md). Sunday summary opens Home. The 18:00 nudge opens Review, and only if the queue is not empty.
- Off state inside the product: [es-08-notifications-off-light.png](../../design/states/es-08-notifications-off-light.png), [es-08-notifications-off-dark.png](../../design/states/es-08-notifications-off-dark.png).

### 14 Settings

- Mockups: [14-settings-light.png](../../design/screens/14-settings-light.png), [14-settings-dark.png](../../design/screens/14-settings-dark.png).
- Entry: tab הגדרות.
- Steps: the account row, then one group with no section head (חיבורים and הלוואות, each opening a page), תצוגה (categories and the overhead switch, which starts off), and עוד. Projects stay on `/projects`. Notification times are not on this screen. [0082](../decisions/0082-settings-redesign.md), [0116](../decisions/0116-settings-connections-and-loans-pages.md), [0022](../decisions/0022-after-overhead-starts-off.md), [0033](../decisions/0033-google-sign-in.md).
- With a company, the account area is two rows: the business name, which opens the one-field "שם העסק" sheet for an owner (static for a viewer), and the static Google email. [0108](../decisions/0108-rename-company-row.md).
- The חיבורים hint is "N מתוך M פעילים", or "Mercury: צריך לחבר מחדש" in the warning tone when one connector needs reconnecting, or "2 חיבורים צריכים חיבור מחדש". The הלוואות hint is the count ("2 הלוואות", "הלוואה אחת", "אין הלוואות עדיין"), never a total. Loading is a skeleton hint; a failed read says "לא הצלחנו לטעון" with no retry. הלוואות is hidden with no company. Viewers see and open both rows.
- Back: none. This is a tab root. Back from either page puts focus on the row that opened it.
- Logout clears the session. There is no second confirmation in the approved set.

### 14a Connections

- Mockup: `flow-501-mockup.html` option A (FLOW-501). Route `/settings/connections`, template A with the tab bar (הגדרות stays current).
- Header: Back labelled הגדרות to `/settings`, title חיבורים.
- Steps: "ספרים ובנק" holds SUMIT and Mercury; "עזרים" holds תיוג חכם (Jev) and עוזר AI. Each row is the shared `ConnectorRow`: the one-word status and its one sheet, unchanged from [0082](../decisions/0082-settings-redesign.md) §3–§8. `?sheet=sumit|mercury|assistant` opens that sheet once; the old `/settings?sheet=` links redirect here.
- States: loading keeps the real titles over skeleton hints; an error is the row's inline ניסיון חוזר; the page is never empty. With no company the page stays open and SUMIT and Mercury offer פרטי העסק.
- Viewer: static rows, no chevrons.

### 14b Loans

- Mockup: `flow-501-mockup.html` option A (FLOW-501). Route `/settings/loans`, template A with the tab bar. `/settings/loans/:id` is kept for FLOW-110's detail page.
- Header: Back labelled הגדרות to `/settings`, title הלוואות. No company goes back to Settings.
- Steps: each loan's name, its hint (project, or ממתין לבדיקה in the warning tone), and the balance with small cents (".00" included); then the הלוואה חדשה row. A row tap opens the project sheet (FLOW-119).
- States: two skeleton rows while loading; the error layout "לא הצלחנו לטעון את ההלוואות" with ניסיון חוזר and no new-loan row; the empty state "אין הלוואות עדיין" with one primary הלוואה חדשה.
- Viewer: the balances as static rows, no chevrons and no הלוואה חדשה; the empty state says "כשיתווספו הלוואות הן יופיעו כאן." with no button.

### 15 Date picker

- Field: [15a-date-field-light.png](../../design/screens/15a-date-field-light.png), [15a-date-field-dark.png](../../design/screens/15a-date-field-dark.png).
- Single: [15b-date-single-light.png](../../design/screens/15b-date-single-light.png), [15b-date-single-dark.png](../../design/screens/15b-date-single-dark.png). Shortcuts היום / אתמול.
- Range: [15c-date-range-light.png](../../design/screens/15c-date-range-light.png), [15c-date-range-dark.png](../../design/screens/15c-date-range-dark.png). Shortcuts החודש / חודש קודם / מתחילת השנה.
- Entry: a date field (manual entry, filters).
- Steps: sheet, Sunday-first grid, one confirm button. Future days disabled. [0027](../decisions/0027-date-picker.md), guide §7.17.
- Cancel: ✕ or scrim leaves the previous date.

### 16 Period sheet

- Mockups: [16-period-sheet-light.png](../../design/screens/16-period-sheet-light.png), [16-period-sheet-dark.png](../../design/screens/16-period-sheet-dark.png).
- Entry: the period pill on Home and elsewhere, or the period bar's label on the project band ([0141](../decisions/0141-period-bar.md)).
- Steps: the five presets (חודש · 3 חודשים · 6 חודשים · שנה · הכול) apply on tap. "טווח מותאם" opens 15c; with a custom range no preset is selected and the label shows the dates. [0019](../decisions/0019-home-periods-and-comparison.md), [0028](../decisions/0028-period-sheet-with-custom-range.md).
- Cancel: ✕ or scrim keeps the current period.

### 17 Install prompt

17a stays the later Android offer: the benefit rows, התקנה, and לא עכשיו. That `beforeinstallprompt` path is also step 5, where התקנה appears only after the event. Without it, step 5 shows the three ⋮ rows. 17b stays the later iPhone offer and shares `install-screen.tsx` with step 5. Both use the iOS 26 rows: מקישים ••• בספארי, בוחרים שיתוף ואז ״הוספה למסך הבית״, מקישים הוספה. "ההתקנה באייפון עובדת רק מספארי." and "פותחים את הקישור הזה בספארי" are retired. Step 5's primary is סיום. The later offer keeps הבנתי. The Hebrew labels (•••, שיתוף, הוספה למסך הבית, Open as Web App drawn as פתיחה כאפליקציה, הוספה, and Compact, Bottom, and Top tab layouts) need a check on a real device before release. The host is `location.host`, and in production `https://flow-app-dx5.pages.dev`.

- Android: [17a-install-android-light.png](../../design/screens/17a-install-android-light.png), [17a-install-android-dark.png](../../design/screens/17a-install-android-dark.png). "התקנה" / "לא עכשיו" on the later offer.
- iPhone: [17b-install-iphone-light.png](../../design/screens/17b-install-iphone-light.png), [17b-install-iphone-dark.png](../../design/screens/17b-install-iphone-dark.png). The iOS 26 rows, then "הבנתי" on the later offer.
- Entry: after the first successful report, and only if the app is not installed. Also setup step 5. [0029](../decisions/0029-pwa-install-prompt.md), [0015](../decisions/0015-installable-mobile-web-app.md).
- Dismiss: "לא עכשיו" or "הבנתי". Do not show it again inside the installed app.

### 20–23 Confirmation sheets

| Action | Light | Dark | Flow |
|---|---|---|---|
| Delete | [20-confirm-delete-light.png](../../design/screens/20-confirm-delete-light.png) | [20-confirm-delete-dark.png](../../design/screens/20-confirm-delete-dark.png) | Question, item, consequence, bad-tint confirm, ביטול, then undo toast |
| Archive | [21-confirm-archive-light.png](../../design/screens/21-confirm-archive-light.png) | [21-confirm-archive-dark.png](../../design/screens/21-confirm-archive-dark.png) | Same pattern. Entry from the project menu |
| Merge pick | [22a-merge-pick-light.png](../../design/screens/22a-merge-pick-light.png) | [22a-merge-pick-dark.png](../../design/screens/22a-merge-pick-dark.png) | Pick the surviving category |
| Merge confirm | [22b-merge-confirm-light.png](../../design/screens/22b-merge-confirm-light.png) | [22b-merge-confirm-dark.png](../../design/screens/22b-merge-confirm-dark.png) | "X תנועות יעברו ל…", then confirm |
| Hide | [23-confirm-hide-light.png](../../design/screens/23-confirm-hide-light.png) | [23-confirm-hide-dark.png](../../design/screens/23-confirm-hide-dark.png) | Hide, not delete. [0008](../decisions/0008-flat-categories-hide-or-merge.md) |

Cancel on every sheet is ביטול, ✕, or the scrim. [0030](../decisions/0030-confirmation-sheets.md).

### Empty, loading, and error files

Every file has `-light.png` and `-dark.png`. [0026](../decisions/0026-empty-loading-error-states.md).

| Id | Path prefix | When |
|---|---|---|
| es-01 | `design/states/es-01-home-first-run` | Home before any data |
| es-02 | `design/states/es-02-project-empty` | Project with no transactions |
| es-03 | `design/states/es-03-review-done` | Queue cleared |
| es-04 | `design/states/es-04-projects-none` | No projects |
| es-05 | `design/states/es-05-unpaid-none` | No unpaid invoices |
| es-06 | `design/states/es-06-search-none` | Search with no hits |
| es-07 | `design/states/es-07-categories-income` | No income categories |
| es-08 | `design/states/es-08-notifications-off` | Notifications off |
| ld-01 | `design/states/ld-01-home-skeleton` | Home loading |
| ld-02 | `design/states/ld-02-project-skeleton` | Project loading |
| ld-03 | `design/states/ld-03-list-skeleton` | List loading |
| ld-04 | `design/states/ld-04-button-loading` | Primary button busy |
| ld-05 | `design/states/ld-05-upload-processing` | Not a build task. Bank file processing was dropped ([0065](../decisions/0065-review-round5.md) point 40) |
| ld-06 | `design/states/ld-06-invoice-reading` | Invoice photo reading |
| ld-07 | `design/states/ld-07-pull-to-refresh` | Pull to refresh |
| ld-08 | `design/states/ld-08-offline` | Offline, nothing cached |
| ld-09 | `design/states/ld-09-offline-cached` | Offline, cached data kept |
| er-01 | `design/states/er-01-bank-file` | Wrong or unreadable bank file |
| er-02 | `design/states/er-02-invoice-blurry` | Photo cannot be read |
| er-03 | `design/states/er-03-google-cancelled` | Google window closed |
| er-04 | `design/states/er-04-google-failed` | Google sign-in failed |
| er-05 | `design/states/er-05-save-failed` | Save failed. Toast with "ניסיון חוזר" |

### Design-system boards

| Board | Light | Dark |
|---|---|---|
| Colours | [ds-1-colours-light.png](../../design/system/ds-1-colours-light.png) | [ds-1-colours-dark.png](../../design/system/ds-1-colours-dark.png) |
| Type | [ds-2-type-light.png](../../design/system/ds-2-type-light.png) | [ds-2-type-dark.png](../../design/system/ds-2-type-dark.png) |
| Spacing | [ds-3-spacing-light.png](../../design/system/ds-3-spacing-light.png) | [ds-3-spacing-dark.png](../../design/system/ds-3-spacing-dark.png) |
| Controls | [ds-4-controls-light.png](../../design/system/ds-4-controls-light.png) | [ds-4-controls-dark.png](../../design/system/ds-4-controls-dark.png) |
| Content | [ds-5-content-light.png](../../design/system/ds-5-content-light.png) | [ds-5-content-dark.png](../../design/system/ds-5-content-dark.png) |
| Band | [ds-6-band-light.png](../../design/system/ds-6-band-light.png) | [ds-6-band-dark.png](../../design/system/ds-6-band-dark.png) |
| Empty and loading | [ds-7-empty-loading-light.png](../../design/system/ds-7-empty-loading-light.png) | [ds-7-empty-loading-dark.png](../../design/system/ds-7-empty-loading-dark.png) |
| Pickers and sheets | [ds-8-pickers-sheets-light.png](../../design/system/ds-8-pickers-sheets-light.png) | [ds-8-pickers-sheets-dark.png](../../design/system/ds-8-pickers-sheets-dark.png) |

---

## 5. Do and don't

Distilled from the owner's choices in [0023](../decisions/0023-violet-coloured-top-band.md), the superseded explorations in [docs/module-1-project-pnl/design/README.md](../module-1-project-pnl/design/README.md), and the principles in [design-system.md](../../design/system/design-system.md). The rejected boards stay in the repo. Do not build from them.

**Do**

- Keep the page white in light mode (`#FFFFFF`) and a clear violet-black in dark mode (`#15111E`). [0023](../decisions/0023-violet-coloured-top-band.md).
- Use few numbers. Home's budget is the profit, one change, income, expenses, the pending summary, and at most five projects (FLOW-411). A project row reads name, then "▲ ברווח" (`text-muted`) or "▼ הפסד" (`bad`), then the amount. Guide §1 P2.
- Use Rubik at 400 / 500 / 600 / 700, with body at 500 and titles at 600. [0023](../decisions/0023-violet-coloured-top-band.md).
- Use the violet band only on Home and the Project header. [0024](../decisions/0024-design-system-approved.md).
- Leave the after-overhead switch off until the owner turns it on. [0022](../decisions/0022-after-overhead-starts-off.md).
- Ask before delete, archive, hide, and merge. [0030](../decisions/0030-confirmation-sheets.md).
- Let the owner confirm. Do not make them type a classification for every row. [0006](../decisions/0006-confirm-not-type.md).

**Don't**

- Don't design busy, data-dense screens. Mercury-like P1 Graphite, P2 Cobalt, and P3 Petrol were rejected as too busy. [0023](../decisions/0023-violet-coloured-top-band.md).
- Don't add hints, legends, "usually" figures or status chips to every row. The owner rejected a project page that did (FLOW-401, 2026-10-08). Show the one thing that needs attention, and keep the rest on the next screen.
- Don't pile extra figures, charts, or breakdowns onto Home or Project. Put them on the next screen. Guide §1 P3.
- Don't use a faint off-white tinted background. Styles A (`#F5F7F9`) and C (`#F3ECE1`) and the "faint off-white" alternative were rejected. The page is clean white, or a clear colour. [0023](../decisions/0023-violet-coloured-top-band.md), [design README](../module-1-project-pnl/design/README.md).
- Don't use a stiff or thin face. IBM Plex was too stiff. Assistant and Varela Round were too thin. [0023](../decisions/0023-violet-coloured-top-band.md).
- Don't revive styles A, B, or C, or the muted and other-bright palettes listed in 0023.
- Don't use gradients, emoji, or heavy shadows. [design-system.md](../../design/system/design-system.md).
- Don't colour a number red or green without ▼, ▲, or a minus sign.
- Don't show more than about two filled-violet shapes in one view.
- Don't build a desktop layout or an SMS sign-in. [0015](../decisions/0015-installable-mobile-web-app.md), [0033](../decisions/0033-google-sign-in.md).

---

## 6. General mobile principles

**These are general practice the project has adopted. They are not a separate owner decision.** Where a project record is stricter, follow the record.

| General principle | How Flow uses it |
|---|---|
| Nielsen: visibility of system status | Skeletons, busy buttons, processing steps, offline notices, pending count. [0026](../decisions/0026-empty-loading-error-states.md), guide §8 |
| Nielsen: match the real world | Hebrew, cash language, Sunday-first calendar, dd/mm/yyyy. [0016](../decisions/0016-hebrew-only.md), [0027](../decisions/0027-date-picker.md) |
| Nielsen: user control and freedom | Sheet dismiss, ביטול, undo toast, reopen an auto-approved row. [0030](../decisions/0030-confirmation-sheets.md), [0011](../decisions/0011-auto-approve-high-confidence.md) |
| Nielsen: consistency | One template per screen, one token set, one primary button pattern. Guide §3 and §7 |
| Nielsen: error prevention | Confirmation sheets, remember-rule preview, VAT hint only where it matters. [0030](../decisions/0030-confirmation-sheets.md), [0043](../decisions/0043-assumed-vat-on-expenses.md) |
| Nielsen: recognition rather than recall | Suggestions, chips, recent projects. The owner confirms. [0006](../decisions/0006-confirm-not-type.md) |
| Nielsen: flexibility and efficiency | Auto-approve for high confidence, shortcuts on date and period sheets. [0011](../decisions/0011-auto-approve-high-confidence.md), [0028](../decisions/0028-period-sheet-with-custom-range.md) |
| Nielsen: aesthetic and minimalist design | Few numbers, white space, no dense dashboards. Guide §1. This is also an owner rule (§5) |
| Nielsen: help users recover from errors | What happened, nothing was lost, one next action. Guide §7.20 |
| Nielsen: help and documentation | One-line "why" on a suggestion. Guide §11.1 |
| WCAG AA contrast, 4.5:1 text and 3:1 non-text | Token pairs are pre-checked. [0024](../decisions/0024-design-system-approved.md), guide §9 |
| 44×44px targets | `--touch-min`. Guide §4. General fitts-law practice, adopted as a MUST |
| Thumb zone | Tab bar and the sheet's primary action sit at the bottom. Guide §3 |
| Progressive disclosure | Overview screens link inward instead of showing every figure. Guide §1 P3 |
| One primary action per screen | Guide §7.1 and §3.4 |
| Consistent patterns | The same sheet, toast, empty state, and error note everywhere. [0026](../decisions/0026-empty-loading-error-states.md) |
| Reduced motion | `prefers-reduced-motion` zeroes the durations. Guide §10. General WCAG 2.3 practice |

---

## Review checklist

Use guide §12.2. In short: light and dark screenshots at 390px next to the board, no raw hex in screen code, logical properties only, one primary, band only on Home and Project, overhead switch default off, formatters for money and dates, empty / loading / error present, Hebrew copy gender-neutral.
