# Pickers and Home scale past a handful of projects

**Date:** 2026-09-26
**Status:** Accepted

## Context

A contractor can have a few active sites or several dozen, plus finished jobs that still matter in old reports. A chip for every project fits the first month and fails the first year. The same pressure hits categories once the owner has added their own. Company totals still have to include every project and overhead, including the ones not on screen.

## Decision

**Project picker** (the change sheet, and any other place the owner assigns a project):

1. Three suggested chips: the AI pick, the project last used for this supplier, and one more suggestion.
2. Search by name or by project code (for example `P-12`).
3. The rest of the list, sorted by recent activity.

Finished projects are hidden from the picker. They stay in reports, and search can still find them.

**Category picker:** the same shape. Three suggestions, then the rest of the list (search included). The full set of seven defaults may show as chips while the list is still that short; the approved change sheet uses three chips plus "more categories" so the sheet still fits when the list is long.

**Home:** the company totals always include every project and overhead. The list under the totals shows the top 5 projects by activity this month, then one collapsed row for the rest (`N more projects`, with their combined profit), then overhead. A sort toggle switches that top 5 between "by activity" (`לפי פעילות`) and "losses first" (`הפסד קודם`).

The projects list screen still has the full list, with finished projects collapsed under `הסתיימו`, and search for a long list.

## Alternatives rejected

Showing every project as a chip or as a Home row, and leaving finished projects in the default picker.

## Consequences

The v1 Home (three project rows) and the v1 change sheet (a chip per project and a chip per category) are superseded by `01-home-v2` and `06-change-sheet-v2`. Company profit on Home is not the sum of the visible rows; it is the sum of all projects plus overhead. A finished project can still receive a transaction if the owner searches for it, which covers a late invoice on a closed job.
