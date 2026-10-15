# Flow · design

The design source is the live design board: https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD. Change the design there. This folder keeps the approved V1 Violet files (light and dark) that the repo still cites. They were exported byte-for-byte from the design box on 26 Sep 2026. The reviewer reference that cites these files and the decision records is [DESIGN-RULES.md](../docs/design/DESIGN-RULES.md).

| Folder | Contents |
|---|---|
| `system/` | `design-system.md` (short spec), `implementation-guide.md` (**mandatory** for every screen implementation), `implementation-tokens.css` (the hand-edited token file), and the boards `ds-4` to `ds-8` (light and dark PNG) |
| `screens/` | The screen PNGs that the docs cite, light and dark at 390×844 @2x: screens `01`–`23` (with `09a`, `15a`–`15c`, `22a`/`22b`) and the `overview` grids. The uncited dark onboarding variants `09b`–`09d` are not kept. |
| `states/` | The state PNGs that DESIGN-RULES.md cites: empty states, loaders and offline, errors, and `overview-states`. Uncited variants are not kept. |
| `logo/` | Final logo package: the wordmark (outlines), the S1 app icon (light, dark, brand), PWA icons and manifest block, the favicon, the usage board `board/flow-logo-usage.png`, and `LOGO.md`. `explorations/` holds only the overviews of the rejected rounds. |
| `src/` | Only the files that other files name: the generators `flow.py`, `more.py`, `states.py`, `tokens.py`, `ds.py`, `crop.py` and the render scripts they use, plus the HTML sources that the docs name: `01-home` (light and dark), `09-onboarding` dark (`09` to `09e`) and `14-settings` (light and dark). The other HTML mockups were deleted in FLOW-834. |

**Rebuilding.** The old mockup set can no longer be rebuilt from this folder: most of its HTML sources were deleted in FLOW-834. The render scripts left in `src/` stay only because other files name them. Make design changes on the live board, then export the PNG into `screens/` or `states/`.

`implementation-tokens.css` is edited directly, in `system/`. Nothing generates it, so a token change is a plain edit to that file ([0181](../docs/decisions/0181-redesign-foundation.md)).

The logo build scripts (`logo/build_final.py`, `logo/board.py`, `logo/src/`) are included for reference. They use absolute paths from the design box, so regenerate from them only after adjusting those paths.
