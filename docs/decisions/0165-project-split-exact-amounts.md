# The split between projects takes exact amounts, like the split by categories

**Date:** 2026-10-09
**Status:** Accepted

## Context

The owner could split a line to the cent only by category ([0104](0104-line-split-by-category.md), [0123](0123-line-split-percent-rest-reversal.md)). The split between projects ([0069](0069-back-and-one-tap-review.md) point 10, [0076](0076-collapse-split-to-one-project.md)) offered four presets (equal, chosen projects, by income, one project) and a manual percent list in basis points, so a payment that covers two projects in exact amounts could not be entered there. The owner asked on 2026-10-09 for the project split to work the same way as the category split, simple and clean, dropping the presets (FLOW-346).

## Decision

- The project split screen uses the category editor's layout: parts, each a project with an amount or a percent of the whole line (% / ₪ per part), a rest row that keeps what the parts leave on one project, and a footer with "פוצלו" and "נשאר לשורה". ✕ and browser back save a valid change; an invalid one holds once with ביטול השינוי, then discards. The four presets, the manual percent list and the detail toggle are removed.
- A line on one project opens with that project as the rest and no parts. A saved split reopens with its largest project as the rest and the others as exact amounts. A shared line with no project asks for the rest's project.
- `save_split` takes shares as `{project_id, share_bp}` (as before) or `{project_id, amount_minor}`, never mixed. Amount shares must sum to the line (`parts must sum to the line`, `parts exceed the line`), are stored to the cent in `allocations.amount_net` (which every P&L read already uses), and get a derived `share_bp` (largest remainder, at least 1). One share files the whole line to that project, as before.
- The screen rounds a percent like `save_line_split`: floor each share, the missing cents to the largest remainders, and sends amounts only.
- MCP `assign_expense_split` shares take `amount_minor` in place of `share` the same way.
- ביטול after a save re-sends the previous shares as amounts. It restores the shares only: the line stays marked as the owner's, and a review the save closed stays closed (reopen it from שויכו היום).
- Syncs (`upsert_connector_lines` and the older import paths) rescale a line's allocations from `share_bp` only when the stored parts no longer add up to the line, so pulling the same line again keeps exact parts to the cent. When the line's amount changes, the parts are rescaled by `share_bp` (0.01% precision) as before.

## Alternatives rejected

- Saving the project split through `save_line_split` with the line's category on every part: a shared line's open `unallocated_shared` review refuses it, and the project shares would live in two places.
- Keeping basis points and converting typed amounts: 0.01% cannot reach every cent, which was the problem.

## Consequences

Supersedes the Split v2 presets in [0069](0069-back-and-one-tap-review.md) point 10 and the one-project choice of [0076](0076-collapse-split-to-one-project.md) on this screen (`collapse_split` stays for the change sheet). DESIGN-RULES' split section follows the design log entry for FLOW-346.
