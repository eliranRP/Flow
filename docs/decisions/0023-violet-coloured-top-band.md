# Violet with a coloured top band

**Date:** 2026-09-26
**Status:** Accepted

## Context

The UI phase tried several looks for Home. Styles A, B, and C, then a Mercury-inspired set (Graphite, Cobalt, Petrol), then further palettes and typefaces. The owner chose one direction for the light mode.

A full design system, light and dark, and hi-fi screens for the product are not in the repo yet. They follow this decision. The low-fi wireframes stay the screen spec until those images land.

## Decision

The visual direction is violet with a coloured top band.

Light-mode accent is violet `#7B3FE4`.

Home opens with a solid violet band. The band's bottom corners are rounded. On the band: the wordmark, the greeting, the hero profit, and the income and expense line. Text on the band is white. Secondary text on the band is a light lilac.

Below the band the page is pure white `#FFFFFF`.

The same accent is on the `+` button, the active tab, the tinted pending card, and the period pill.

The profit delta sits in a small white pill: a red `▼` or a green `▲`.

The font is Rubik, in thicker weights: hero and titles 600, body 500, hints 400, wordmark 700.

## Alternatives rejected

Styles A, B, and C.

Mercury-like P1 Graphite, P2 Cobalt, and P3 Petrol. Too busy, and IBM Plex was too stiff.

D1, D2, and D3. Periwinkle was too Mercury-like. Assistant and Varela Round were too thin.

Muted palettes: Clay, Navy & Sand, Ocean, Indigo, Ink & Lime, Honey.

Other bright palettes: Azure, Coral, Fuchsia, Aqua, Tangerine, Emerald.

Faint off-white tinted backgrounds. The page is clean white, or a clear colour. Not a tinted off-white.

## Consequences

[design/README.md](../module-1-project-pnl/design/README.md) records this direction. The P1, P2, and P3 boards, and styles A, B, and C, stay in that folder and are superseded. Do not build from them.

The light and dark design system, and hi-fi screens for the product, are still to be added. This record does not replace the low-fi wireframes, and it does not change how the numbers are calculated.

The approved package has since landed at [design/README.md](../../design/README.md). Decisions [0024](0024-design-system-approved.md) through [0031](0031-logo.md) record it. This record's direction is unchanged.
