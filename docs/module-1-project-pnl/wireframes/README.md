# Wireframes — Module 1, Project P&L

Low-fidelity phone wireframes, Hebrew right to left. **Every number in these files is example data** for a fictional contractor in September 2026. The English column beside a phone is design annotation. It is not product copy.

Build the **Approved** files. **Superseded** files stay so the earlier layout is still readable. **Pending owner approval** means the PNG is in the repo and described in `screens.md`, and it is not approved yet.

| File | Screen | Version | Status |
| --- | --- | --- | --- |
| [01-home.png](01-home.png) | Home, few projects | v1 | Superseded by [01-home-v2.png](01-home-v2.png) |
| [01-home-v2.png](01-home-v2.png) | Home, many projects, two periods | v2 | Superseded by [01-home-v3.png](01-home-v3.png) |
| [01-home-v3.png](01-home-v3.png) | Home, three periods, comparison arrows, unpaid line | v3 | Superseded by [01-home-v4.png](01-home-v4.png). Was pending owner approval. |
| [01-home-v4.png](01-home-v4.png) | Home, after overhead share | v4 | Pending owner approval. Example data. |
| [02-project.png](02-project.png) | Project | v1 | Superseded by [02-project-v2.png](02-project-v2.png) |
| [02-project-v2.png](02-project-v2.png) | Project, after overhead share | v2 | Pending owner approval. Example data. |
| [03-review.png](03-review.png) | Review queue, with Approve all | v1 | Superseded by [03-review-v2.png](03-review-v2.png) |
| [03-review-v2.png](03-review-v2.png) | Review queue, auto-approved strip | v2 | Approved |
| [04-add.png](04-add.png) | Add sheet | v1 | Approved |
| [05-projects.png](05-projects.png) | Projects list and create | v1 | Approved |
| [06-change-sheet.png](06-change-sheet.png) | Change sheet, all chips | v1 | Superseded by [06-change-sheet-v2.png](06-change-sheet-v2.png) |
| [06-change-sheet-v2.png](06-change-sheet-v2.png) | Change sheet, scalable picker | v2 | Approved |
| [07-categories.png](07-categories.png) | Categories | v1 | Approved |
| [08-upload-results.png](08-upload-results.png) | Statement upload results, Leumi sample and bulk approve | v1 | Superseded by [08-upload-results-v2.png](08-upload-results-v2.png) |
| [08-upload-results-v2.png](08-upload-results-v2.png) | Statement upload results, Hapoalim, auto-approved group | v2 | Approved |
| [overview.png](overview.png) | Board of screens 01–05 | v1 | Approved composite. The Home phone is the superseded [01-home](01-home.png). The review phone is the superseded [03-review](03-review.png). |
| [overview-2.png](overview-2.png) | Board of screens 06–08 | v1 | Approved composite. The change-sheet phone is the superseded [06-change-sheet](06-change-sheet.png). The upload phone is the superseded [08-upload-results](08-upload-results.png). |
| [overview-3.png](overview-3.png) | Board of Home v2 and change sheet v2 | v2 | Approved composite. The Home phone is the superseded [01-home-v2](01-home-v2.png). The change sheet is current. |
| [overview-4.png](overview-4.png) | Board of review v2 and upload results v2 | v2 | Approved composite. Both phones are current. |
| [09-onboarding.png](09-onboarding.png) | First-run onboarding, five phones | v1 | Pending owner approval |
| [10-transaction-detail.png](10-transaction-detail.png) | Transaction detail | v1 | Pending owner approval |
| [11-split.png](11-split.png) | Split sheet | v1 | Superseded by [11-split-v2.png](11-split-v2.png). Was pending owner approval. |
| [11-split-v2.png](11-split-v2.png) | Split across active projects, monthly rule | v2 | Pending owner approval. Example data. |
| [12-unpaid.png](12-unpaid.png) | Unpaid invoices | v1 | Pending owner approval |
| [13-notifications.png](13-notifications.png) | The two notifications, on the lock screen | v1 | Pending owner approval |
| [14-settings.png](14-settings.png) | Settings | v1 | Pending owner approval. Example data. |
| [overview-5.png](overview-5.png) | Board of detail, split, unpaid, and Home v3 | v1 | Pending owner approval. All four phones are pending. The split and Home phones are the earlier images. |
| [overview-6.png](overview-6.png) | Board of split v2, Home v4, and project v2 | v1 | Pending owner approval. Example data. |

What each file shows, and how it behaves, is in [screens.md](../screens.md).

`01-home-v4`, `02-project-v2`, `11-split-v2`, and `overview-6` are drawn and pending owner approval. Every number on them is example data.

## Versions

A replacement keeps the stem and adds `-v2`, `-v3`, and so on. Do not overwrite a PNG. Mark the previous row `Superseded` here and in `screens.md`. The rule is in [CONTRIBUTING.md](../../../CONTRIBUTING.md).

## Source

| File | Role |
| --- | --- |
| [source/gen.py](source/gen.py) | Writes one HTML file per screen into `source/`. |
| [source/hifi.py](source/hifi.py) | Writes the three Home style directions. The PNGs land in [../design](../design/README.md). |
| [source/render.sh](source/render.sh) | Screenshots those HTML files with headless Chrome. Wireframes land in this folder. Style names land in `design/`. |

From `source/`:

```bash
python3 gen.py
bash render.sh
```

`render.sh` with no arguments renders every name, including `14-settings` and the four style files. Pass names to render a subset (`bash render.sh 14-settings`). Phone pages are captured at 794×920 CSS pixels. Boards: `overview` 2274×1100, `overview-2` and `overview-6` 1358×1100, `overview-3` and `overview-4` and `13-notifications` 916×1100, `09-onboarding` 2274×1180, `overview-5` 1800×1100. Style phones are 460×980. `style-overview` is 1480×1020. Device scale is 2.

`gen.py` is the generator that produced this set. `render.sh` writes into the parent `wireframes/` directory so the script runs from this repo. The copy it was adapted from wrote PNGs into `/workspace/wireframes-pnl`.
