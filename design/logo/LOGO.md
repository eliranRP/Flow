# Flow · logo

**Main logo:** the app wordmark **“Flow”**, set in Rubik 700 with letter-spacing −0.01em, exactly as it appears in the app. It's delivered as outlines, so no font is needed.
**App icon:** **S1**, the Rubik 700 capital **F** taken from that same wordmark. It is made of straight lines only. Earlier cursive and calligraphic directions were explored and rejected (see `explorations/`).

## Colours (brand)
| Use | Wordmark | Icon |
|---|---|---|
| Light pages (white) | violet `#7B3FE4` (5.7:1) | Light: violet F on white |
| Dark pages (`#15111E`) | lilac `#B894FF` (7.7:1) | Dark: `#B894FF` F on `#15111E` |
| Violet top band | white `#FFFFFF` (5.7:1) | Brand: white F on violet `#7B3FE4` |
| One-colour / print | ink `#1D1728` | n/a |

In the app, the wordmark uses the `logo` token: `--logo` is `#7B3FE4` in light mode and `#B894FF` in dark mode. It no longer uses `accent-text`. On the band it stays `on-band` (white).

**Brand icon (white F on violet)** is used for:
- the installed PWA icon (apple-touch-icon and manifest)
- in-app icon spots (install prompt, notifications)
- the favicon

**Light and dark icons** are for appearance-aware contexts: docs, marketing, a future native app or store listing.

## Rules
- **Clear space:** at least ½ the cap height of the F on every side of the wordmark.
- **Icon:** the F is fixed at 50% of the tile height, optically centred (+1.5% to the right). Never enlarge the F or add anything to the tile.
- **Minimum size:**
  - wordmark 12 px tall on screen (the app header uses 22 px font, which is about 16 px tall); 6 mm tall in print
  - icon 16 px
  - below 48 px, use the pixel-snapped PNGs, not a scaled SVG
- **Don't:**
  - recolour
  - stretch
  - add shadows or effects
  - retype, italicise or re-space
  - put it on a low-contrast background
  - rotate the F or restyle it (no curves, script or waves)

## Files
- `wordmark/flow-wordmark-{violet,lilac,white,ink}.svg` plus `@2x.png` / `@4x.png` (1x = 32 px tall, transparent)
- `icon/flow-icon-{light,dark,brand}.svg`: full-bleed square masters. The OS applies the rounded mask.
- `icon/flow-icon-{light,dark,brand}-rounded.svg`: rounded previews for docs
- `icon/flow-icon-{light,dark,brand}-{1024,512,192,180,167,152,120,48,32,16}.png`: full-bleed. Sizes ≤48 are pixel-snapped.
- `icon/flow-glyph-F.svg`: the F alone
- `pwa/`:
  - `icon-192/512.png`
  - `maskable-192/512.png` (the F sits inside the 80% safe zone)
  - `monochrome-192/512.png` (Android themed icons)
  - `apple-touch-icon.png` (180)
  - `manifest.webmanifest` (icons block)
  - `head-snippet.html`
- `favicon/favicon.svg`, `favicon.ico` (16/32/48), `favicon-{16,32,48}.png`: white F on a rounded violet tile
- `board/flow-logo-usage.png`: the one-page usage board

## Sample manifest icons block
```json
"icons": [
  {"src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
  {"src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
  {"src": "/icons/maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable"},
  {"src": "/icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
  {"src": "/icons/monochrome-512.png", "sizes": "512x512", "type": "image/png", "purpose": "monochrome"}
]
```
Rebuild: `python3 build_final.py && python3 board.py`. The wordmark outlines come from Rubik-VariableFont at wght 700, shaped with HarfBuzz; see `src/wordmark.py`.
