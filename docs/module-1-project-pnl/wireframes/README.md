# Wireframes — Module 1, Project P&L

Low-fidelity phone wireframes, Hebrew right to left. **Every number in these files is example data** for a fictional contractor in September 2026. The English column beside a phone is design annotation. It is not product copy.

Build the **Approved** files. **Superseded** files stay so the earlier layout is still readable.

| File | Screen | Version | Status |
| --- | --- | --- | --- |
| [01-home.png](01-home.png) | Home, few projects | v1 | Superseded by [01-home-v2.png](01-home-v2.png) |
| [01-home-v2.png](01-home-v2.png) | Home, many projects | v2 | Approved |
| [02-project.png](02-project.png) | Project | v1 | Approved |
| [03-review.png](03-review.png) | Review queue | v1 | Approved |
| [04-add.png](04-add.png) | Add sheet | v1 | Approved |
| [05-projects.png](05-projects.png) | Projects list and create | v1 | Approved |
| [06-change-sheet.png](06-change-sheet.png) | Change sheet, all chips | v1 | Superseded by [06-change-sheet-v2.png](06-change-sheet-v2.png) |
| [06-change-sheet-v2.png](06-change-sheet-v2.png) | Change sheet, scalable picker | v2 | Approved |
| [07-categories.png](07-categories.png) | Categories | v1 | Approved |
| [08-upload-results.png](08-upload-results.png) | Statement upload results | v1 | Approved |
| [overview.png](overview.png) | Board of screens 01–05 | v1 | Approved composite. The Home phone on this board is the superseded [01-home](01-home.png). |
| [overview-2.png](overview-2.png) | Board of screens 06–08 | v1 | Approved composite. The change-sheet phone on this board is the superseded [06-change-sheet](06-change-sheet.png). |
| [overview-3.png](overview-3.png) | Board of Home v2 and change sheet v2 | v2 | Approved composite. Both phones are current. |

What each file shows, and how it behaves, is in [screens.md](../screens.md).

## Versions

A replacement keeps the stem and adds `-v2`, `-v3`, and so on. Do not overwrite a PNG. Mark the previous row `Superseded` here and in `screens.md`. The rule is in [CONTRIBUTING.md](../../../CONTRIBUTING.md).

## Source

| File | Role |
| --- | --- |
| [source/gen.py](source/gen.py) | Writes one HTML file per screen into `source/`. |
| [source/render.sh](source/render.sh) | Screenshots those HTML files with headless Chrome and writes PNGs into this folder. |

From `source/`:

```bash
python3 gen.py
bash render.sh
```

`render.sh` with no arguments renders every name. Pass names to render a subset (`bash render.sh 01-home-v2`). Phone pages are captured at 794×920 CSS pixels; the overview boards at 2274×1100, 1358×1100, and 916×1100. Device scale is 2.

`gen.py` is the generator that produced this set. `render.sh` writes into the parent `wireframes/` directory so the script runs from this repo. The copy it was adapted from wrote PNGs into `/workspace/wireframes-pnl`.
