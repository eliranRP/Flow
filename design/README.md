# Flow · design

The design source is the live design board: https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD. Change the design there. This folder keeps only what the repo still builds from or links to.

| Folder | Contents |
|---|---|
| `system/` | `design-system.md` (short spec), `implementation-guide.md` (**mandatory** for every screen implementation), and `implementation-tokens.css` (the hand-edited token file) |
| `logo/` | Final logo package: the wordmark (outlines), the S1 app icon (light, dark, brand), PWA icons and manifest block, the favicon, the usage board `board/flow-logo-usage.png`, and `LOGO.md`. `explorations/` holds only the overviews of the rejected rounds. |

The old screen PNGs, state PNGs, `ds-*` boards and the HTML mockup sources were deleted in T-03. Each screen's board artboard is named in [DESIGN-RULES.md](../docs/design/DESIGN-RULES.md) §4.

`implementation-tokens.css` is edited directly, in `system/`. Nothing generates it, so a token change is a plain edit to that file ([0181](../docs/decisions/0181-redesign-foundation.md)).

The logo build scripts (`logo/build_final.py`, `logo/board.py`, `logo/src/`) are included for reference. They use absolute paths from the design box, so regenerate from them only after adjusting those paths.
