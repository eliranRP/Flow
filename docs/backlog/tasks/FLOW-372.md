<a id="flow-372"></a>
# FLOW-372 · Redesign: light theme and the מראה setting
- **Type:** UI (design approved) · **Status:** done (#611) · **Depends on:** [FLOW-363](FLOW-363.md) · **Related:** [FLOW-512](FLOW-512.md) (Settings menu), [FLOW-371](FLOW-371.md) (skeleton and toast colours) · **Source:** the owner's approved redesign, light theme approved 2026-10-12. Design: [Design canvas](https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD), page "Light theme · ready for dev" (every Ready screen in light, laid out like "Ready for dev"), board "Settings · מראה" at the end of the Settings row on both pages; tokens on "Design guide", section "Light theme".
- **Files:** `design/system/implementation-tokens.css` (light values only), `app/src/styles/app.css` (only if a token alias is missing), `app/src/components/ThemeColor.tsx`, a small theme store under `app/src/` that sets `data-theme` on `<html>`, the Settings menu row and its sheet (FLOW-512's files), their stories and tests.

**Light values (same token names; dark values do not change)**
- [ ] Background #F6F4FA; surface and raised #FFFFFF; inner box / input #F1EEF6; tint #EEE6FD; line #E7E2F0; strong line #DAD3E6; selected outline #D9CBF6.
  - #611: all done, except raised. The board gives raised the inner-box value #F1EEF6 (dark raised is the inner box, DESIGN-RULES 2.2), so raised is #F1EEF6. Owner to confirm (see the design log).
- [x] Text #1D1728; secondary #5B536E; muted #746C88 (4.5:1 on white).
- [x] Accent for buttons and links #6C2ED6 with on-accent #F6F4FA; money in #1A8048; signal #D23B2F (soft #B9503F).
- [ ] Shadows rgba(40,20,90,.12); sheet scrim rgba(29,23,40,.38); skeleton blocks use the inner-box value.
  - #611: shadow (the sync pill token) and skeleton are done. The sheet scrim is left to PR #609, as the brief says.
- [ ] Unchanged in both themes: the purple band (#7B3FE4, past month #5A2DB0) with white text and its change pills, the camera view, the receipt.
- [x] Toasts invert: dark toast on light, light toast on dark.
- [ ] Remove any light value these replace; no screen sets its own hex.
  - #611: the replaced light values are gone. Screen CSS still has raw hex in its baseline (`scripts/css-tokens-baseline.json`), so this stays open.

**Settings › מראה**

_Done in #611, after #609 merged (87cbb184). See the design log for the placement and the sheet subtitle._
- [x] A row "מראה" in Settings' second card, with an icon and the current value (לפי המכשיר / בהיר / כהה). The app has no החלפת עסק row, so the row sits before the install row, the card's next row on the board.
- [x] It opens a sheet "מראה" · "רק בטלפון הזה" with three radio rows: לפי המכשיר ("עובר בין בהיר לכהה יחד עם הטלפון"), בהיר ("רקע לבן, נוח באור יום"), כהה ("רקע כהה, נוח בערב ובחושך").
- [x] Default for a new device: לפי המכשיר (no `data-theme`, follows `prefers-color-scheme`). בהיר and כהה set `data-theme`. Saved per device (local storage), not per business; applied before first paint so a reload never flashes the other theme.
  - The write is `writeThemeChoice` in `theme-store.ts`, called by the Settings sheet.
- [x] The change applies at once, closes the sheet and shows the undo toast (3s). The status-bar colour (`ThemeColor`) follows.
- **MCP:** none (a device setting).
- **Acceptance:** stories of every redesign screen in both themes come from tokens only (a test fails on a raw hex in screen CSS); a test that each choice sets or clears `data-theme`, survives a reload with no flash, and that undo restores the previous choice; contrast check of the light text and accent tokens (AA); design review of the light boards against the approved canvas.
