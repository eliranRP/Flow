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
| [0019](../decisions/0019-home-periods-and-comparison.md) | Home periods: this month, last month, year to date, each with a comparison arrow. The project screen defaults to project to date. |
| [0020](../decisions/0020-capture-from-the-phone.md) | Capture is multi-photo and files on the phone. Android may share in. iPhone cannot. |
| [0021](../decisions/0021-shared-costs-and-overhead.md) | Shared project costs are split. True overhead stays overhead. The overhead share is a view, not a rewrite of transactions. |
| [0022](../decisions/0022-after-overhead-starts-off.md) | The after-overhead switch starts **off**. Home, the project screen, and Settings share one preference. |
| [0023](../decisions/0023-violet-coloured-top-band.md) | Violet `#7B3FE4`, solid top band, white page below, Rubik at the heavier weights. See §6 for what was rejected. |
| [0024](../decisions/0024-design-system-approved.md) | Light and dark, one violet band in both modes, Rubik 400/500/600/700, spacing and radius scales, WCAG AA text. |
| [0025](../decisions/0025-implementation-guide-is-mandatory.md) | [implementation-guide.md](../../design/system/implementation-guide.md) is the definition of done. |
| [0026](../decisions/0026-empty-loading-error-states.md) | Every screen has empty, loading, and error states, in light and in dark. |
| [0027](../decisions/0027-date-picker.md) | Week starts Sunday. Dates are dd/mm/yyyy. Single-date and range pickers, both with shortcuts. |
| [0028](../decisions/0028-period-sheet-with-custom-range.md) | The period is a sheet opened from the band pill, including a custom range. This replaces only the "no custom range" sentence in 0019. |
| [0029](../decisions/0029-pwa-install-prompt.md) | After the first successful report, offer install. Android uses `beforeinstallprompt`. iPhone shows three Safari steps. Do not show it inside the installed app. |
| [0030](../decisions/0030-confirmation-sheets.md) | Delete, archive, hide, and merge use a confirmation sheet. Merge is two steps. The confirm control is a soft bad-tint button, then an undo toast. |
| [0031](../decisions/0031-logo.md) | Wordmark "Flow", Rubik 700, letter-spacing −0.01em. App icon is S1, the straight F. |
| [0032](../decisions/0032-home-hero-stays-company-net-profit.md) | With the after-overhead switch **on**, Home's big number stays company net profit. Overhead is already inside it. The switch changes the small band figures and the project rows, not the hero. |
| [0033](../decisions/0033-google-sign-in.md) | Google account sign-in. Supersedes 0017. The button label is "המשך עם Google". |
| [0040](../decisions/0040-tailwind-v4.md) | Tailwind CSS v4. Tokens map into `@theme`. No component kit with its own look. Vaul stays for sheets. |
| [0041](../decisions/0041-amounts-before-vat.md) | P&L amounts are before VAT. VAT is stored beside the amount and kept out of profit. |
| [0043](../decisions/0043-assumed-vat-on-expenses.md) | An expense with no VAT split assumes 18% (`vat_status='assumed'`), unless the supplier is VAT-exempt (`net = gross`). A subtle hint may appear on the detail screen. Home has no warning banner. |

Records that are not visual rules but change what a screen may show: [0004](../decisions/0004-cash-basis-for-v1.md) cash basis, [0007](../decisions/0007-bank-statement-is-primary-input.md) unpaid invoices stay out of the P&L until paid (amended in role by [0042](../decisions/0042-sumit-primary-income-and-expenses.md) and [0065](../decisions/0065-review-round5.md) point 40: SUMIT is the source, and there is no Hapoalim import).

---

## 2. Design system

Sources: [design-system.md](../../design/system/design-system.md), [implementation-tokens.css](../../design/system/implementation-tokens.css), [design-tokens.json](../../design/system/design-tokens.json). `tokens.py` is the generator. Do not edit the CSS by hand. [implementation guide §2.1](../../design/system/implementation-guide.md).

### 2.1 Principles

From [design-system.md](../../design/system/design-system.md) and guide §1:

- Calm and airy. White page, lots of space, few numbers, detail on the next screen.
- One accent, violet. Filled violet at most about twice per screen area (normally the + button and one primary button).
- The coloured band is only the top of Home and the Project header.
- Figures use the main text colour. Red and green only together with ▼ / ▲ or a minus sign.
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

Rubik. Weights mean something: 400 hints, 500 body and labels, 600 titles and amounts, 700 wordmark only. Do not use 300, 800, or 900. [0023](../decisions/0023-violet-coloured-top-band.md), [0024](../decisions/0024-design-system-approved.md), guide §5.

| Style | Size | Line | Weight | Use |
|---|---|---|---|---|
| hero | 52px | 1.15 | 600 | Home profit only. Letter-spacing −0.02em |
| display | 36px | 1.2 | 600 | Main amount on inner screens |
| title-1 | 28px | 1.3 | 600 | Page titles |
| title-2 | 22px | 1.35 | 600 | Sheet titles, project name |
| title-3 | 17px | 1.45 | 600 | Section heads, amounts in lists |
| body | 16px | 1.5 | 500 | Rows, input values. Inputs stay at least 16px so iOS does not zoom |
| label | 15px | 1.5 | 500 | Labels, secondary lines |
| hint | 13px | 1.45 | 400 | Dates, helper text, field labels |
| micro | 11px | 1.3 | 500 | Tab labels and badges only |
| wordmark | 22px | 1.2 | 700 | "Flow" only. Letter-spacing −0.01em. LTR |

CSS names are `--type-<style>-size`, `--type-<style>-line`, `--type-<style>-weight`, and `--font-family`. Numbers use `tabular-nums` and `lining-nums`. [implementation-tokens.css](../../design/system/implementation-tokens.css), guide §5.

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
| `--toast-duration` | 4000ms | A plain confirmation. A toast with an action (ניסיון חוזר, ביטול, לחלוקה) stays 5000ms. An error stays 4000ms. A preview notice uses the info tone, not the error tone, and also stays 4000ms when it has no action. Hover, focus, and a press pause it. The two-line minimum applies only when the text shrinks or wraps, not to the container. Toast text uses `text-wrap: balance`. A tap on the toast does not close a sheet underneath. Over an open sheet the toast sits just above the sheet. When that gap is too small it keeps its full height `--space-2` below the safe area. The same `--space-2` is the gap at every size and safe area, so the toast does not sit at y=1.5. It may cover the grabber and the empty top of the sheet. It never covers a header control. The height is measured once before the toast is visible, from the sheet's resting top, not from a rect taken while the sheet is opening. The sheet pads nothing unless a control would be covered. At safe area 0 the sheet keeps its own padding. A 320 two-line refusal pads to 20 at safe area 20 and to 47 at safe area 47, and ✕ finishes at the toast bottom plus `--space-2`. The content moves once, for `--dur-base` with `--ease-standard`, and the toast fades in after that move. No frame shows the toast except at the position it settles at. Above a short sheet the gap is `--space-2`, measured after the pad is gone. A change of the sheet's own layout places the toast and the pad before the next paint. A later toast keeps that pad instead of easing it through 0. Resize, rotation, and the keyboard place a visible toast again, and they wait while the pad or the fade is running. The timer starts when the toast is visible. The pad returns in one `--dur-base` move after the toast leaves. The text is never clipped. [0069](../decisions/0069-back-and-one-tap-review.md), [0072](../decisions/0072-design-review-rulings.md), [0074](../decisions/0074-toast-and-remembered-supplier.md), [0075](../decisions/0075-save-on-tap-and-on-leave.md) |

Screen push is 250ms from the start side. Toast in 200ms / out 150ms.

### 2.8 Component inventory and states

Boards: [ds-4](../../design/system/ds-4-controls-light.png) controls, [ds-5](../../design/system/ds-5-content-light.png) content, [ds-6](../../design/system/ds-6-band-light.png) band, [ds-7](../../design/system/ds-7-empty-loading-light.png) empty and loading, [ds-8](../../design/system/ds-8-pickers-sheets-light.png) pickers and sheets. Each has a `-dark.png` twin. [design-system.md](../../design/system/design-system.md), guide §7 and §8.5.

Every control has pressed, disabled, focus, and selected or busy where it applies. Pressed is instant, 100ms. Focus is a 2px ring, `--color-focus`, offset 2px. Inside the band the ring is white. A screen-reader title (`tabindex=-1`) draws no ring. A sheet panel (`role=dialog`, `tabindex=-1`) draws no ring either. The 2px ring stays on real controls for `:focus-visible`.

A viewer cannot take an action that would not apply, so that action is hidden. When the layout depends on the slot, the slot stays empty. A stateful switch stays on screen, disabled, with the label and the hint at full strength. The disabled off track keeps a 3:1 edge against the row. The disabled on track is a muted accent, so it stays distinct from an enabled off track. A settings row that would open a write becomes static, with no chevron.

| Component | States | Rule |
|---|---|---|
| Button | primary, secondary (tint), ghost, destructive. Default, pressed, disabled | One primary per screen. Destructive confirm is `bad` text on `bad-tint`, never a solid red block |
| + button | 48px circle. Default, pressed | Opens Add. Sits in the tab bar |
| Period pill | tinted, or white/dark on the band | Opens the period sheet |
| Chips | suggested (tint + ✦), outlined choice, selected (violet + check), disabled, status | Hit area 44px even if drawn 36px |
| Segmented tabs | track tint, selected `seg-on` | |
| Switch and checkbox | off / on / disabled | Overhead switch starts off. [0022](../decisions/0022-after-overhead-starts-off.md) |
| Text input | default, focused, filled, error, disabled | Label above. Error is red border plus a message |
| Search | default, typing (violet ring) | |
| Pending card | default, pressed | The one tinted block on Home |
| Project row | profit in `text`, loss in `bad` with a minus | Name and margin on the start side |
| Transaction row | amount in `text` with an explicit sign | Grey source icon |
| Change pill | ▼ / ▲ plus % | On the band it sits in a solid pill |
| Tab bar | בית, פרויקטים, +, לאישור (neutral badge), הגדרות | Active tab is violet icon and label |
| Bottom sheet | scrim, grab handle, title, ✕ | ✕, scrim, swipe, and Android back save a valid pending change, then close. An incomplete change stays open and says why, with ביטול השינוי beside that sentence. A second dismiss discards it and closes. A dismiss during a save waits for the save, then closes. Push a history entry. [0075](../decisions/0075-save-on-tap-and-on-leave.md) |
| Empty state | icon, title, one line, at most one button | No emoji. Positive wording when the work is done |
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
| B sheet | Add, Change, mark as paid, period, date, confirms | underneath, dimmed | no |
| C full screen | Onboarding, Transaction detail, Split, install | no | no |

Notifications (`13`) is a lock-screen reference, not an app screen. Guide §3.

The band holds only the summary. Home: one quiet period pill, one label, the hero number, and one explanation ("הכנסות פחות הוצאות, מ־…"). The label says "הפסד" when the figure is negative, and "החודש" when that period is selected. נכנס and יצא sit below the band, and the comparison sits under those rows. No greeting and no wordmark on Home. Project: back, project name, profit, income and expenses. Do not put the band on sheets, onboarding, or for emphasis. [0069](../decisions/0069-back-and-one-tap-review.md). Guide §3.2.

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
- A row toggles or navigates across its full width.
- Primary actions sit at the bottom of sheets and full-screen flows, in the thumb zone. The tab bar is the persistent thumb-zone navigation. Guide §3 and §4.

### 3.4 RTL

- `<html lang="he" dir="rtl">`.
- Logical properties only. Start is the right. Do not reverse flex rows by hand.
- The design chevron `back` already points right. Do not flip it again. Do not mirror +, ✓, ✕, search, calendar, or ▼/▲.
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
| Row sign | `+` or `−`, amount stays `text` |
| Percent | `27%`, whole numbers |
| Change | `▼ 10%` or `▲ 8%` in a pill |
| Date | `22/09` this year, `21/09/2026` full, range `01–30/09` |
| Week | Sunday first. Gregorian. [0027](../decisions/0027-date-picker.md) |
| Time | 24-hour `18:00` |
| Relative | `היום`, `אתמול`, `לפני 3 ימים` |

Home rounding: whole shekels, never "1.3M" or "אלף". The visible profit is rounded income minus rounded expenses, so the line adds up. If the hero does not fit, step to `display` (36px). Do not scale continuously. The hero number stays the on-band white, including a minus. A loss is named "הפסד" in the label, because red on the violet band does not read. Figure budget on Home: the label, the profit, one explanation, נכנס, יצא, the comparison under those rows, the pending count, the unpaid total, and up to 3 projects. [0069](../decisions/0069-back-and-one-tap-review.md). [guide §1 P2](../../design/system/implementation-guide.md), §11.3.

P&L figures are before VAT. [0041](../decisions/0041-amounts-before-vat.md), [0043](../decisions/0043-assumed-vat-on-expenses.md).

### 3.6 Copy tone

Guide §11.1.

- Short, friendly, direct, second person. One line where possible.
- Gender-neutral: plural imperatives ("העלו") and noun buttons ("אישור", "שמירה", "ביטול"). Avoid "אתה" / "את".
- Plain words: רווח, הכנסות, הוצאות, לא שולמו, כלליות.
- No exclamation marks, no emoji, no ALL-CAPS English.
- Hebrew punctuation: ״ ׳, en dash with spaces, middle dot.
- Errors say what happened and what to do, without blame.
- English only in the wordmark "Flow" and the example-data tag.
- Sample figures must show **נתוני דוגמה · Example data**. Real data must not. Guide §11.2.

---

## 4. Screen index

Mockups are 390×844 at 2×, light and dark. Paths are under `design/`. HTML sources live in `design/src/` and are not the review images. Flows below are the approved behaviour from the guide §13 and the decisions. They are not a second spec.

Grids: [screens/overview-light.png](../../design/screens/overview-light.png), [screens/overview-dark.png](../../design/screens/overview-dark.png), [screens/overview-more-light.png](../../design/screens/overview-more-light.png), [screens/overview-more-dark.png](../../design/screens/overview-more-dark.png), [states/overview-states-light.png](../../design/states/overview-states-light.png), [states/overview-states-dark.png](../../design/states/overview-states-dark.png).

### 01 Home

- Mockups: [01-home-light.png](../../design/screens/01-home-light.png), [01-home-dark.png](../../design/screens/01-home-dark.png). Overhead on: [18-home-overhead-on-light.png](../../design/screens/18-home-overhead-on-light.png), [18-home-overhead-on-dark.png](../../design/screens/18-home-overhead-on-dark.png).
- Empty: [es-01-home-first-run-light.png](../../design/states/es-01-home-first-run-light.png), [es-01-home-first-run-dark.png](../../design/states/es-01-home-first-run-dark.png).
- Loading: [ld-01-home-skeleton-light.png](../../design/states/ld-01-home-skeleton-light.png), [ld-01-home-skeleton-dark.png](../../design/states/ld-01-home-skeleton-dark.png). Refresh: [ld-07](../../design/states/ld-07-pull-to-refresh-light.png).
- Entry: tab בית. Sunday notification. Returning sign-in. [0018](../decisions/0018-two-notifications.md), guide §7.24.
- Steps: period pill opens 16. The hero is the label, the number, and one line that says income minus expenses. נכנס and יצא sit below the band. Pending card opens Review. A project row opens 02. + opens 04. Overhead switch starts off ([0022](../decisions/0022-after-overhead-starts-off.md)). On, the hero stays company net profit ([0032](../decisions/0032-home-hero-stays-company-net-profit.md)).
- Back: none. This is a tab root.
- Success: the summary. Empty first run follows [0044](../decisions/0044-phase-0-shell-calls.md): the button is "חיבור SUMIT", and the line says the profit appears once SUMIT is connected. No greeting and no wordmark ([0069](../decisions/0069-back-and-one-tap-review.md)).
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
- Steps: one card. Project and category are two short rows, with no confidence number. הצעה sits on a line that is a real suggestion. A split line is not one, and a card that only needs a category has no הצעה heading. אישור accepts a complete card. It stays disabled, with a not-allowed cursor, while a remembered Jev on is still unconfirmed or a known-on read is still settling, and when the card says אין הצעה. That read ends within a second, and the card then keeps today's values. A failed read is off. While it waits, a note that will remain reserves its line with no pill and no words, and a card that settles without a note reserves nothing. The list paints as soon as it loads. The card waits on the signed-in user and company for at most a second before it reads the remembered flag. When this user has no remembered on, the stored card paints on the first frame. A miss skips that flag and reads the connector: off leaves the stored card approvable, and on waits for the suggestion. A reload remembers whether Jev was on for that user and company, including when לאישור is the first screen. Sign-out clears that flag. An expired session, a sign-out in another tab, and a switch to another user drop the in-memory connector cache as well. A categorised split closes the review and keeps the shares. Change opens 06. A plain אישור does not write a supplier rule. [0069](../decisions/0069-back-and-one-tap-review.md), [0075](../decisions/0075-save-on-tap-and-on-leave.md). High-confidence rows never appear here. [0011](../decisions/0011-auto-approve-high-confidence.md).
- Banner: when rows were assigned today without waiting, "N תנועות שויכו היום בלי להמתין בתור". צפייה opens "שויכו היום". A row opens that transaction. Back returns to the queue. סגירה hides the banner for this visit. [0069](../decisions/0069-back-and-one-tap-review.md). An assistant approval in that count drops the queue clause, a count of 1 is singular, and the empty body covers both sources. [0080](../decisions/0080-mcp-connector.md).
- Back: none on the tab. Change and Split close back to the card.
- Success: the card leaves and the visit meter advances. The queue-done empty state when none remain. A toast, when it shows, sits under the header and does not cover דלג. Approve can still offer ביטול on that toast. [0069](../decisions/0069-back-and-one-tap-review.md).
- Error: save failure toast (`er-05`).

### 04 Add

- Mockups: [04-add-light.png](../../design/screens/04-add-light.png), [04-add-dark.png](../../design/screens/04-add-dark.png).
- Entry: the + button.
- Steps: the sheet opens over the screen that opened it. A direct `/add` still shows Home underneath. Photo, bank report, or manual entry. [0020](../decisions/0020-capture-from-the-phone.md). Phase 0 shows only the title and one hint ([0045](../decisions/0045-phase-0-design-gaps.md)). Closing returns focus to +.
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
- Kept out of the P&L: a ⊘ mark in `--color-text-muted` right after the name (`role="img"`, label "מחוץ לרווח והפסד"). The name keeps `--color-text`, so the row does not read as hidden, and only the name truncates. A legend line under the list explains ⊘ when the segment has a kept-out row. The row sheet's third button toggles the flag on tap, with a hint line under it and a ביטול toast. The three loan categories show a locked line instead. [0104](../decisions/0104-kept-out-toggle.md).
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
  - Success: a new account goes to step 0. A returning account goes to Home.
- 09b company, merged into step 0 and retired: [09b-onboarding-light.png](../../design/screens/09b-onboarding-light.png). The live step has no counter and no דלג.
- 09c bank report, superseded: [09c-onboarding-light.png](../../design/screens/09c-onboarding-light.png). Not a build task. [0065](../decisions/0065-review-round5.md) point 40. The drawing shows a Hapoalim export. Do not build it.
- 09d projects, merged into step 3 and retired: [09d-onboarding-light.png](../../design/screens/09d-onboarding-light.png).
- 09e install and notifications, superseded: [09e-onboarding-light.png](../../design/screens/09e-onboarding-light.png). [0015](../decisions/0015-installable-mobile-web-app.md), [0018](../decisions/0018-two-notifications.md). Install is step 5. Notifications are not a step.
- Each of 09b–09e has a `-dark.png`. One primary per step. Guide §3.4.

### 10 Transaction detail

- Mockups: [10-transaction-detail-light.png](../../design/screens/10-transaction-detail-light.png), [10-transaction-detail-dark.png](../../design/screens/10-transaction-detail-dark.png).
- Entry: a transaction row.
- Steps: amount before VAT, VAT beside it, source, links. [0041](../decisions/0041-amounts-before-vat.md). Assumed VAT may show a subtle hint. [0043](../decisions/0043-assumed-vat-on-expenses.md).
- Back: chevron. Delete opens 20. What delete removes is still an open question. [0030](../decisions/0030-confirmation-sheets.md).
- Error: save toast `er-05`.

### 11 Split

- Mockups: [11-split-light.png](../../design/screens/11-split-light.png), [11-split-dark.png](../../design/screens/11-split-dark.png). Behaviour is [0069](../decisions/0069-back-and-one-tap-review.md) point 10 (Split v2: presets first). This amends the earlier "divide by amount or percent" rule: presets come first, there is no ₪ typing, and a manual percent sits behind "חלוקה ידנית".
- Entry: Split on a review card, or from detail.
- Title: "חלוקה בין פרויקטים". Then the amount, then "איך לחלק?".
- Nothing is selected until a tap, unless a saved split is being re-edited. Four choices, one tap each: "שווה בין כל הפרויקטים", "שווה בין פרויקטים שאבחר", "לפי הכנסות", "לפרויקט אחד". Chosen opens a checklist of active projects. A ticked row shows its ₪ share. Nothing to type there. Income with no income in the period is disabled, with the reason "אין הכנסות בתקופה הזו". "לפרויקט אחד" opens the project picker. That picker does not offer "פיצול בין פרויקטים". The note above the list uses the hint colour, with space above and below it. [0075](../decisions/0075-save-on-tap-and-on-leave.md), [0076](../decisions/0076-collapse-split-to-one-project.md).
- "חלוקה ידנית" is a text link, not a default. The fields fit "100%", one decimal, at least 96px wide. The row focuses the input. `inputmode=decimal`, `autocomplete=off`, and the name is `split-pct-<projectId>`. "חזרה לאפשרויות" restores the previous choice.
- There is no שמירה button. A valid choice is saved by leaving. The saving row shows a small spinner in place of the check (`--spinner-radio`), and the other choices are disabled, with the disabled colour and the not-allowed cursor, until the save settles. The hold sentence is the muted hint. ביטול השינוי is the quiet link. One summary line, for example "₪250 לכל אחד מ־4 פרויקטים" when every part is the same amount, or "₪1,000 מתחלק שווה בין 3 פרויקטים" when an even split does not land on equal shekels, or "לפי הכנסות · N פרויקטים". Nothing chosen says "בחרו איך לחלק" in the primary text colour. A short manual split says "נשארו 30% לחלק". Over says "הסך 120%. צריך 100%." with only the total in the bad colour, and each row shows its own percent of the amount. A valid manual split says "הסך 100%" and "חלוקה ידנית · N פרויקטים". An invalid choice stays open. ביטול השינוי sits next to that sentence, and a second dismiss discards the change and closes. [0072](../decisions/0072-design-review-rulings.md), [0075](../decisions/0075-save-on-tap-and-on-leave.md).
- Displayed shekel parts put the leftover agora on the last project so the line adds up. The save sends those shares reversed, so the stored agorot match the screen. Stored shares still sum to 10000 basis points.
- Cancel: ✕. Guide §13.
- Success: toast "החלוקה נשמרה", then close. Error: `er-05`, "החלוקה לא נשמרה", with "ניסיון חוזר". Values stay.

### 12 Unpaid

- Mockups: [12-unpaid-light.png](../../design/screens/12-unpaid-light.png), [12-unpaid-dark.png](../../design/screens/12-unpaid-dark.png).
- Empty: [es-05-unpaid-none-light.png](../../design/states/es-05-unpaid-none-light.png), [es-05-unpaid-none-dark.png](../../design/states/es-05-unpaid-none-dark.png).
- Entry: the unpaid figure on Home.
- Steps: list invoices that are not in the cash P&L until paid or marked paid. [0004](../decisions/0004-cash-basis-for-v1.md), [0007](../decisions/0007-bank-statement-is-primary-input.md).
- Back: chevron.
- Success: mark-as-paid sheet, then the row leaves. Empty state when none remain.

### 13 Notifications reference

- Mockups: [13-notifications-light.png](../../design/screens/13-notifications-light.png), [13-notifications-dark.png](../../design/screens/13-notifications-dark.png).
- This is the lock screen, not an app screen. Guide §3.
- Copy and taps: [0018](../decisions/0018-two-notifications.md). Sunday summary opens Home. The 18:00 nudge opens Review, and only if the queue is not empty.
- Off state inside the product: [es-08-notifications-off-light.png](../../design/states/es-08-notifications-off-light.png), [es-08-notifications-off-dark.png](../../design/states/es-08-notifications-off-dark.png).

### 14 Settings

- Mockups: [14-settings-light.png](../../design/screens/14-settings-light.png), [14-settings-dark.png](../../design/screens/14-settings-dark.png).
- Entry: tab הגדרות.
- Steps: the account row, חיבורים, תצוגה (categories and the overhead switch, which starts off), and עוד. Projects stay on `/projects`. Notification times are not on this screen. [0082](../decisions/0082-settings-redesign.md), [0022](../decisions/0022-after-overhead-starts-off.md), [0033](../decisions/0033-google-sign-in.md).
- Back: none. This is a tab root.
- Logout clears the session. There is no second confirmation in the approved set.

### 15 Date picker

- Field: [15a-date-field-light.png](../../design/screens/15a-date-field-light.png), [15a-date-field-dark.png](../../design/screens/15a-date-field-dark.png).
- Single: [15b-date-single-light.png](../../design/screens/15b-date-single-light.png), [15b-date-single-dark.png](../../design/screens/15b-date-single-dark.png). Shortcuts היום / אתמול.
- Range: [15c-date-range-light.png](../../design/screens/15c-date-range-light.png), [15c-date-range-dark.png](../../design/screens/15c-date-range-dark.png). Shortcuts החודש / חודש קודם / מתחילת השנה.
- Entry: a date field (manual entry, filters).
- Steps: sheet, Sunday-first grid, one confirm button. Future days disabled. [0027](../decisions/0027-date-picker.md), guide §7.17.
- Cancel: ✕ or scrim leaves the previous date.

### 16 Period sheet

- Mockups: [16-period-sheet-light.png](../../design/screens/16-period-sheet-light.png), [16-period-sheet-dark.png](../../design/screens/16-period-sheet-dark.png).
- Entry: the band pill on Home (and the project period control).
- Steps: החודש, חודש קודם, מתחילת השנה apply on tap. "טווח מותאם" opens 15c. [0019](../decisions/0019-home-periods-and-comparison.md), [0028](../decisions/0028-period-sheet-with-custom-range.md).
- Cancel: ✕ or scrim keeps the current period.

### 17 Install prompt

17a stays the later Android offer: the benefit rows, התקנה, and לא עכשיו. That `beforeinstallprompt` path is also step 5, where התקנה appears only after the event. Without it, step 5 shows the three ⋮ rows. 17b stays the later iPhone offer and shares `install-screen.tsx` with step 5. Both use the iOS 26 rows: מקישים ••• בספארי, שיתוף ואז הוספה למסך הבית, מקישים הוספה. "ההתקנה באייפון עובדת רק מספארי." and "פותחים את הקישור הזה בספארי" are retired. Step 5's primary is סיום. The later offer keeps הבנתי. The Hebrew labels (•••, שיתוף, הוספה למסך הבית, Open as Web App drawn as פתיחה כאפליקציה, הוספה, and Compact, Bottom, and Top tab layouts) need a check on a real device before release. The host is `location.host`, and in production `https://flow-app-dx5.pages.dev`.

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
- Use few numbers. Home's budget is the profit, one change, income, expenses, the pending summary, and at most three projects. Guide §1 P2.
- Use Rubik at 400 / 500 / 600 / 700, with body at 500 and titles at 600. [0023](../decisions/0023-violet-coloured-top-band.md).
- Use the violet band only on Home and the Project header. [0024](../decisions/0024-design-system-approved.md).
- Leave the after-overhead switch off until the owner turns it on. [0022](../decisions/0022-after-overhead-starts-off.md).
- Ask before delete, archive, hide, and merge. [0030](../decisions/0030-confirmation-sheets.md).
- Let the owner confirm. Do not make them type a classification for every row. [0006](../decisions/0006-confirm-not-type.md).

**Don't**

- Don't design busy, data-dense screens. Mercury-like P1 Graphite, P2 Cobalt, and P3 Petrol were rejected as too busy. [0023](../decisions/0023-violet-coloured-top-band.md).
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
