# UI directions — Module 1

The current direction is Mercury-inspired. The palette is **pending**: Graphite, Cobalt, or Petrol. Low-fi wireframes in [../wireframes](../wireframes/README.md) stay the screen spec until a direction is accepted.

Every number on these boards is example data for September 2026. The after-overhead switch is off, which is the default ([0022](../../decisions/0022-after-overhead-starts-off.md)), so the rows are stored project profit and overhead is still its own line. Company profit on the headline is ₪200,000.

The English caption above each phone is a design label. It is not product copy.

## Current direction

| File | What it is |
| --- | --- |
| [ui-mercury-p1.png](ui-mercury-p1.png) | Home in P1 Graphite |
| [ui-mercury-p2.png](ui-mercury-p2.png) | Home in P2 Cobalt |
| [ui-mercury-p3.png](ui-mercury-p3.png) | Home in P3 Petrol |
| [ui-mercury-overview.png](ui-mercury-overview.png) | The three palettes together |
| [ui-refs.png](ui-refs.png) | Reference fonts. Not those products' UI. |

Cards sit on white (`#FFFFFF`). The hairline is the palette's line color. Radius 12 on the list card, radius 8 on the add button.

### Font

IBM Plex Sans Hebrew, plus IBM Plex Sans for tabular numerals and the shekel sign. Both are free under the SIL Open Font License.

Alternative: Assistant.

### Scales

- Type: 12 / 13 / 15 / 17 / 20 / 40.
- Spacing: 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40.
- Radius: 4 / 8 / 12 / 16 / full. Cards use 12. Buttons use 8.

### Palettes

Choice pending. Each text color below meets WCAG AA (4.5:1) on that palette's background and on white.

**P1 Graphite.** Accent `#1D1E26`, ink `#1D1E26`, secondary `#565866`, muted `#6E7080`, background `#F6F6F8`, line `#E6E6EC`, good `#12733D`, bad `#C0312B`, warning `#8F5A00`.

**P2 Cobalt.** Accent `#2346B8`, ink `#161A26`, secondary `#4F5566`, muted `#666C7E`, background `#F5F6F9`, line `#E3E6EE`, good `#11743F`, bad `#C2302A`, warning `#8C5800`.

**P3 Petrol.** Accent `#0C4A5A`, ink `#1B1D1C`, secondary `#555954`, muted `#6B6F69`, background `#F6F6F4`, line `#E5E5E0`, good `#2B7A1F`, bad `#BF3326`, warning `#8E5700`.

On P1 the accent and the ink are the same color.

### Reference fonts

Recorded from live CSS. Flow does not ship these faces. [ui-refs.png](ui-refs.png) is a note, not a copy of those products.

| Product | Faces named in CSS |
| --- | --- |
| Mercury | Arcadia |
| Morning | Ploni and Ping. Assistant is the fallback. |
| RiseUp | Simpler Pro |

### Rules

Taken from Design Motion's public patterns, so the screens do not drift into generic generated UI:

- No decorative gradients.
- No emoji.
- No row of identical stat cards. Profit is the headline. Income and expenses are a line under it.
- One accent, about twice on a screen. Here that is the selected period and the pending line.
- Hairline borders. No heavy shadow.
- An arrow or a sign sits with the color. A loss uses the minus and the bad color.
- A positive profit is ink. Green is only for a good delta.
- A takeaway headline sits above the list.

## Superseded

Styles A, B, and C are superseded by the Mercury direction. The files stay.

| File | Direction | Status |
| --- | --- | --- |
| [style-a-calm.png](style-a-calm.png) | A · Calm fintech. Background `#F5F7F9`, card `#FFFFFF`, accent `#0F4C5C`, good `#12875A`, bad `#D14343`. IBM Plex Sans Hebrew. | Superseded |
| [style-b-dark.png](style-b-dark.png) | B · Bold dark. Background `#07090C`, card `#12171E`, accent `#22E4F0`, good `#35E07D`, bad `#FF5D5D`. Heebo. | Superseded |
| [style-c-warm.png](style-c-warm.png) | C · Warm practical. Background `#F3ECE1`, card `#FFFBF4`, accent `#F2A516`, text `#2A2019`, good `#2E8A4E`, bad `#C73B2C`. Rubik. | Superseded |
| [style-overview.png](style-overview.png) | A, B, and C together. | Superseded |

## Source

[../wireframes/source/palettes.py](../wireframes/source/palettes.py) holds the type scale, spacing, radii, and the three palettes. [../wireframes/source/hifi.py](../wireframes/source/hifi.py) writes the HTML. [../wireframes/source/render.sh](../wireframes/source/render.sh) screenshots it into this folder.

```bash
cd docs/module-1-project-pnl/wireframes/source
python3 hifi.py
bash render.sh ui-mercury-p1 ui-mercury-p2 ui-mercury-p3 ui-mercury-overview ui-refs
```
