# Flow design system (v1 · for review)

Approved direction: **V1 Violet with the coloured top band** (ui5-v1-color). Hebrew, right-to-left, mobile-first PWA.
Tokens live in `design-tokens.json`. The boards are `ds-1…ds-6` (light and dark). Every text colour passes WCAG AA (4.5:1). The contrast values are listed in the JSON.

## Principles
- Calm and airy: white page, lots of space, few numbers per screen, detail on inner screens.
- One accent, violet. It's used on the + button, the primary button, links and the active tab. Filled violet appears at most about twice per screen area.
- The coloured band is used only at the top of Home and the Project header. All other screens are white with violet accents.
- Figures always use the main text colour. Red and green carry meaning only together with ▼ / ▲ or a minus sign.
- No gradients, no emoji, no heavy shadows. Depth comes from the violet tint and hairlines.

## Colour (light / dark)
| Role | Token | Light | Dark |
|---|---|---|---|
| Page | bg | #FFFFFF | #15111E |
| Card, tab bar | surface | #FFFFFF | #1E1929 |
| Tinted fill (pending card, pills, secondary button) | tint | #F3ECFE | #2A2045 |
| Tinted fill, pressed | tint-pressed | #E7DAFD | #382A5E |
| Hairline | line | #EEE8FA | #2E2740 |
| Main text and figures | text | #1D1728 | #F1EDF8 |
| Secondary text, labels | text-secondary | #564E66 | #B1A8C4 |
| Hints | text-muted | #6A627A | #978EAB |
| Accent (+, primary button) | accent | #7B3FE4 | #B894FF |
| Accent, pressed | accent-pressed | #6631C9 | #A47FF0 |
| Accent text and icons, active tab | accent-text | #6C2ED6 | #C3A5FF |
| Logo: the "Flow" wordmark off the band | logo | #7B3FE4 | #B894FF |
| Text on accent | on-accent | #FFFFFF | #1E0B45 |
| Top band | band | #7B3FE4 | #7B3FE4 |
| Text on band | on-band | #FFFFFF | #FFFFFF |
| Labels on band | on-band-secondary | #F0E8FF | #F0E8FF |
| Pill / chip on band | band-chip | #FFFFFF | #1E1929 |
| Good (with ▲) | good | #15733F | #62CB8D |
| Bad (with ▼, minus) | bad | #C3302B | #FF8A80 |
| Warning | warning | #8A5700 | #EDB866 |
| Error (inputs) | error | #C3302B | #FF8A80 |
| Disabled fill / text | disabled-bg / disabled-text | #F1EEF6 / #8F889C | #2A2438 / #7A7290 |
| Switch track (off), unchecked checkbox border | control-off | #8F86A3 | #736A8C |
| Input, search, outlined-chip, radio and code-box border | control-border | #8F86A3 | #736A8C |
| Switch knob (off / on) | knob / knob-on | #FFFFFF / #FFFFFF | #FFFFFF / #1E0B45 |
| Destructive button fill | bad-tint | #FCEDEC | #3A1E24 |
| Focus ring / on the band | focus / focus-on-band | #6C2ED6 / #FFFFFF | #C3A5FF / #FFFFFF |
| Tab badge | badge-bg / badge-text | #1D1728 / #FFFFFF | #F1EDF8 / #1E1929 |
| Error icon in the (inverted) toast | toast-bad | #FF8A80 | #C3302B |
| Skeleton / shimmer | skeleton / skeleton-shine | #F3ECFE / #FAF6FF | #2A2045 / #33285A |
| Skeleton / shimmer on the band | skeleton-band / skeleton-band-shine | #9565E9 / #A57CED | #9565E9 / #A57CED |

**Non-text contrast (WCAG 1.4.11).** Switch tracks, checkbox borders and input borders are at least 3:1: control-off / control-border are 3.4:1 on white (light) and 3.4:1 on cards / 3.7:1 on the page (dark). The white knob is 3.4:1 on the light off-track and 5.0:1 on the dark one; when on, the knob is white on #7B3FE4 (5.7:1) in light and dark #1E0B45 on #B894FF (7.3:1) in dark. `bad` on `bad-tint` is 4.9:1 / 6.6:1. Focus rings are 7.0:1 (light) and 9.0:1 (dark). Skeleton colours are decorative and exempt. `tokens.py` checks these against 3:1 and all text against 4.5:1.

Dark mode uses a violet-tinted near-black, never pure black. The band keeps the same violet as light mode (#7B3FE4), with white text (5.7:1) and #F0E8FF labels (4.8:1). The accent brightens to #B894FF and takes dark text on it. The period pill and change pill on the band become dark surfaces (#1E1929); red #FF8A80 inside is 7.5:1 and green #62CB8D is 8.5:1.

## Type: Rubik (Google Fonts, free, OFL)
Weights: 400 hints only · 500 body and labels · 600 titles, amounts and hero · 700 wordmark only. Numbers use equal-width (tabular) digits and are kept left-to-right inside Hebrew.

| Style | Size / line height / weight | Use |
|---|---|---|
| hero | 52 / 1.15 / 600 | Main profit on Home |
| display | 36 / 1.2 / 600 | Amount on detail screens |
| title-1 | 28 / 1.3 / 600 | Page titles |
| title-2 | 22 / 1.35 / 600 | Sheet titles, project name |
| title-3 | 17 / 1.45 / 600 | Section heads, amounts in lists |
| body | 16 / 1.5 / 500 | Rows, main text |
| label | 15 / 1.5 / 500 | Labels, secondary lines |
| hint | 13 / 1.45 / 400 | Dates, percentages, helper text |
| micro | 11 / 1.3 / 500 | Tab bar, badges |
| wordmark | 22 / 1.2 / 700 | "Flow" logo (`logo` colour; `on-band` on the band) |

## Spacing and corners
- 4-point scale: 4, 8, 12, 16, 20, 24, 32, 40.
- Page sides are 24. Cards sit 16 in from the screen edge. Sections are 36–40 apart.
- Minimum touch target is 44. Buttons and inputs are 52 tall. The tab bar is 86, including the home indicator.
- Corners: chips, pills and switches are fully round; inputs and segmented tabs 12; buttons 14; cards 16; bottom sheet 24 (top corners); band 28 (bottom corners).

## Components (states shown on boards 4, 5, 7 and 8)
- **Buttons.** Four kinds: primary (violet fill), secondary (tint), ghost (text only) and destructive (red text). Each has default, pressed and disabled states. Use one primary button per screen.
- **+ button (FAB).** 48px violet circle in the tab bar that opens "Add". States: default, pressed.
- **Period pill.** Tinted pill with a dropdown arrow. On the band it is white in light mode and dark in dark mode.
- **Chips.**
  - Suggested (AI or recent) chips are tinted, with a ✦ icon.
  - Choice chips are outlined in control-border (≥ 3:1).
  - The selected chip is violet-filled with a check.
  - Disabled chips use muted text.
  - Status chips (e.g. "שולם") are small and tinted.
- **Segmented tabs.** Tinted track. The selected segment is white in light mode and raised violet in dark mode.
- **Switch and checkbox.** Violet when on; the knob is knob-on when on (dark knob in dark mode). The overhead switch ("אחרי חלק בכלליות") is **off** by default.
- **Text input.** Label above the field (hint size 13, text-secondary, weight 400). 1px control-border (≥ 3:1), 2px violet when focused. States: default, focused, filled, error (red border and message) and disabled.
- **Search.** Surface field with a 1px control-border (≥ 3:1); a violet ring shows while typing.
- **Pending card.** The one tinted block on Home. States: default, pressed.
- **Project row.** Name and margin on the right, profit on the left. A loss is shown in red with a minus sign.
- **Transaction row.** A grey source icon (invoice or bank), and the amount in the main text colour with its sign.
- **Change pill.** Shows the month-over-month change as ▼/▲ plus a %. On the band it sits in a solid pill so the red or green stays readable.
- **Tab bar.** בית, פרויקטים, +, לאישור (with a neutral badge: badge-bg / badge-text, 11px), הגדרות. The active tab has a violet icon and label.
- **Bottom sheet.** Dimmed backdrop, grab handle, title, ✕ to close, and one primary action.
- **Empty state.** A line icon in text-muted (full-screen version: 36px icon in an 80px tint circle), a short title (title-2), one line (label size, text-secondary) and at most one button. No emoji or illustrations. Positive wording when the list is empty because the work is done ("הכל מאושר"). Screens: `es-01`…`es-08`.
- **Skeleton.** Bars in skeleton colour shaped like the real content; known chrome (logo, headings, search, tab bar) stays real. A shimmer (skeleton-shine) sweeps every 1.4 s and stops under reduced motion. On the band use skeleton-band. Screens: `ld-01`…`ld-03`.
- **Busy button.** Same size, spinner plus a verb in progress ("מאשר…"); the other actions on the screen go disabled. `ld-04`.
- **File processing.** Progress bar, step list (done ✓ / now spinner / waiting ○), a calm time estimate, "המשך ברקע". Bank report `ld-05`, invoice photo `ld-06` (fields fill in as they are read).
- **Pull to refresh.** Spinner in a band-pill circle at the top of the band; content stays. `ld-07`.
- **Error / offline.** Nothing cached: full-screen empty-state layout with "ניסיון חוזר" (`ld-08`). Cached data: keep the screen and add a tinted notice line with the time of the data and "ניסיון חוזר" (`ld-09`). A failed action uses the toast with the toast-bad icon.
- **Date picker** (`15a`–`15c`, board 8). The field shows dd/mm/yyyy with a calendar icon and opens a sheet with quick chips (היום / אתמול, or החודש / חודש קודם / מתחילת השנה for a range), a Hebrew month header with ‹ ›, a Sunday-first grid (א׳ on the right), today ringed, the selection in accent, a range as a tint strip between two accent circles, future days disabled, and one confirm button.
- **Period sheet** (`16`). Opens from the band pill: החודש / חודש קודם / מתחילת השנה as radio rows (tapping applies), plus "טווח מותאם", which opens the range picker.
- **Confirmation sheet** (`20`–`23`). The question is the title, the item the subtitle, one line on the consequence, the action and a quiet ביטול. Destructive actions use a bad-tint button with red text (never a solid red block), then the undo toast. Merge takes two steps: pick the target, then confirm "X תנועות יעברו ל…".
- **Error pattern** (`er-01`–`er-05`). What happened, that nothing was lost, one action. Red only on a field border and its message. Six LTR code boxes for SMS, with a resend countdown. Save failures use the error toast with "ניסיון חוזר".
- **Install prompt** (`17a`, `17b`). The S1 app icon (white F on violet), title, one line. Android: benefits plus "התקנה" / "לא עכשיו". iPhone: three numbered Safari steps with the icons in tint tiles, plus "הבנתי".
- **Overhead breakdown** (`18`, `19`). With the switch on: the band shows profit after overhead; an "איך מחושב" block lists before, the share (by income share), and after.
- **Toast.** Dark pill above the tab bar (light pill in dark mode). It stays 4 seconds and offers undo.

## Logo
- **Main logo:** the "Flow" wordmark: Rubik 700, letter-spacing −0.01em, LTR.
  - On white and dark pages it uses the `logo` token: brand violet #7B3FE4 (5.7:1) in light mode and #B894FF (7.7:1) in dark mode. It no longer uses `accent-text`.
  - On the violet band it stays `on-band` (white).
- **App icon: S1.** The Rubik 700 capital F from the wordmark: straight lines, 50% of the tile height, optically centred.
  - In the app (install prompt `17a`/`17b`, onboarding step `09e`, notifications `13`, board 8) it's white on the violet `band` colour. `flow.py` provides this as `appic(px, radius)`, with the path in `APP_F_PATH`.
  - The same white-on-violet version is the installed PWA icon and the favicon.
  - Light (violet F on white) and dark (#B894FF F on #15111E) versions exist for appearance-aware contexts.
- **Logo files:** `design/logo/` in the repo (`flow-logo/final/` on the design box). It holds the wordmark SVG/PNG, icon PNGs at 1024–16, maskable and monochrome icons, the favicon, the manifest block, the usage board and `LOGO.md`. Decision 0031.

## Files
- `tokens.py`: the source of truth for tokens (also runs the contrast checks).
- `design-tokens.json`: generated from `tokens.py`.
- `ds.py` + `render-ds.sh`: regenerate the boards. Cropping the tall pages needs Pillow (`/workspace/.venv/bin/python`).
- `flow.py` + `render.sh`: shared component CSS (logical properties only), icons, and the 14 screens.
- `states.py` + `render-states.sh`: empty states (`es-NN`), loaders (`ld-NN`) and the `overview-states` grid. PNGs are frozen frames; open an HTML file with `#live` to see the shimmer and spinners move.
- `render-logo.sh`: re-renders only the screens touched by the logo decision (09a, 09e, 13, 17a/b, the overviews and boards 1–8).
- `more.py` + `render-more.sh`: screens 15–23, er-01…05 and `overview-more`. Board 8 (`ds-8-pickers-sheets`) shows the date picker, period sheet, confirmation sheet, error pattern, install prompt, overhead breakdown and the fixed switch.
- Board 7 (`ds-7-empty-loading`) shows skeleton tokens, skeletons, busy button, spinner, file processing, empty states and error/offline.
- `implementation-tokens.css`: generated from `design-tokens.json` by `../gen_implementation_tokens.py`.
