# Flow · design

This folder holds the approved Flow design: V1 Violet with the coloured top band, in light and dark. The files were exported byte-for-byte from the design box on 26 Sep 2026. The reviewer reference that cites these files and the decision records is [DESIGN-RULES.md](../docs/design/DESIGN-RULES.md).

| Folder | Contents |
|---|---|
| `system/` | `design-system.md` (short spec), `implementation-guide.md` (**mandatory** for every screen implementation), `design-tokens.json`, `implementation-tokens.css`, and the boards `ds-1` to `ds-8` (light and dark PNG) |
| `screens/` | Screens `01`–`23`, including `09a`–`09e`, `15a`–`15c` and `22a`/`22b`, plus the `overview` and `overview-more` grids. Light and dark PNGs at 390×844 @2x. |
| `states/` | Empty states `es-01`…`es-08`, loaders and offline `ld-01`…`ld-09`, errors `er-01`…`er-05`, and `overview-states` |
| `logo/` | Final logo package: the wordmark (outlines), the S1 app icon (light, dark, brand), PWA icons and manifest block, the favicon, the usage board `board/flow-logo-usage.png`, and `LOGO.md`. `explorations/` holds only the overviews of the rejected rounds. |
| `src/` | Generators and every HTML source: `tokens.py`, `flow.py`, `ds.py`, `states.py`, `more.py`, `crop.py`, `render*.sh`, and `gen_implementation_tokens.py` |

**Rebuilding.** You need Google Chrome, the Rubik font and Python 3, plus Pillow for `crop.py`.
1. Run the render scripts inside `design/src/`, e.g. `bash render.sh`, `render-more.sh`, `render-states.sh`, `render-ds.sh`, or `render-logo.sh` (logo-affected screens only). The HTML iframes reference each other, so the HTML stays together in `src/`. The PNGs are written next to it; copy them into `system/`, `screens/` or `states/`.
2. `tokens.py` is the source of truth. `flow.py` writes `design-tokens.json`. Then run `python3 gen_implementation_tokens.py` to write `implementation-tokens.css`. After regenerating, copy both into `system/`.

The logo build scripts (`logo/build_final.py`, `logo/board.py`, `logo/src/`) are included for reference. They use absolute paths from the design box, so regenerate from them only after adjusting those paths.
