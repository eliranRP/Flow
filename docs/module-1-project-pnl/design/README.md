# UI directions — Module 1

Three treatments of the same Home. The owner's choice is **pending**. Low-fi wireframes in [../wireframes](../wireframes/README.md) stay the screen spec until a direction is accepted.

Every number is example data for September 2026. The after-overhead switch is off, which is the default ([0022](../../decisions/0022-after-overhead-starts-off.md)), so the rows are stored project profit and the overhead row is still its own line. Company tiles are ₪1,310,000 / ₪1,110,000 / ₪200,000.

The English caption above each phone is a design label. It is not product copy.

| File | Direction | Palette | Font |
| --- | --- | --- | --- |
| [style-a-calm.png](style-a-calm.png) | A · Calm fintech | Background `#F5F7F9`, card `#FFFFFF`, accent teal `#0F4C5C`, good `#12875A`, bad `#D14343` | IBM Plex Sans Hebrew |
| [style-b-dark.png](style-b-dark.png) | B · Bold dark | Background `#07090C`, card `#12171E`, accent cyan `#22E4F0`, good `#35E07D`, bad `#FF5D5D` | Heebo |
| [style-c-warm.png](style-c-warm.png) | C · Warm practical | Background `#F3ECE1`, card `#FFFBF4`, accent amber `#F2A516`, text `#2A2019`, good `#2E8A4E`, bad `#C73B2C` | Rubik |
| [style-overview.png](style-overview.png) | A, B, and C together | | |

Direction C is the only one with a specified text color. A and B use a dark teal ink and a near-white ink so the type stays readable on those backgrounds.

## Source

[../wireframes/source/hifi.py](../wireframes/source/hifi.py) writes the HTML. [../wireframes/source/render.sh](../wireframes/source/render.sh) screenshots `style-a-calm`, `style-b-dark`, `style-c-warm`, and `style-overview` into this folder.

```bash
cd docs/module-1-project-pnl/wireframes/source
python3 hifi.py
bash render.sh style-a-calm style-b-dark style-c-warm style-overview
```
