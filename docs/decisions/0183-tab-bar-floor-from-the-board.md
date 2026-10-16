# Tab-bar floor from the board

**Date:** 2026-10-16
**Status:** Accepted

## Context

[0045](0045-phase-0-design-gaps.md) set the tab-bar floor to 8px when the inset is 0, so the labels stay off the screen edge. The FLOW-364 board draws the bar at 84px, the 52px bar plus a 32px floor, on a device with no bottom inset. At 8px the bar measures 60px and sits lower than the board.

## Decision

This record supersedes [0045](0045-phase-0-design-gaps.md) for item 6 only, the tab-bar floor. The floor is 32px: `--tabbar-min-inset: 32px`. The other five items of 0045 stay in force. The board is the reference for the bar, so the board's measure wins over the 8px floor.

## Alternatives rejected

Keeping the 8px floor and accepting a 60px bar that differs from the board.

Superseding all of 0045. Its help page, load-error, greeting, period pill and Add-hint decisions still hold.

## Consequences

The bar is 84px on a device with no bottom inset. Content pads so the last row is not hidden. `docs/design/DESIGN-RULES.md` cites this record for the floor.
