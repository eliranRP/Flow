# Design system approved

**Date:** 2026-09-26
**Status:** Accepted

## Context

[0023](0023-violet-coloured-top-band.md) chose violet with a coloured top band for the light mode. The approved package is now in the repo: light and dark, tokens, boards, and screens. The earlier boards under [module 1 design](../module-1-project-pnl/design/README.md) stay as the exploration that 0023 superseded.

## Decision

The design system in [design-system.md](../../design/system/design-system.md) is approved.

Light and dark share one violet top band, `#7B3FE4`, the same in both modes.

The token set is [design-tokens.json](../../design/system/design-tokens.json) and [implementation-tokens.css](../../design/system/implementation-tokens.css).

Type is Rubik 400, 500, 600, and 700. Weight 700 is for the wordmark only. Spacing and radius follow the scales in the design system.

Every text colour passes WCAG AA.

## Alternatives rejected

A separate band colour in dark mode. Shipping screens from the superseded exploration boards instead of this token set.

## Consequences

Build from this package. Boards: [ds-1 light](../../design/system/ds-1-colours-light.png), [ds-1 dark](../../design/system/ds-1-colours-dark.png), [ds-2 light](../../design/system/ds-2-type-light.png), [ds-2 dark](../../design/system/ds-2-type-dark.png), [ds-3 light](../../design/system/ds-3-spacing-light.png), [ds-3 dark](../../design/system/ds-3-spacing-dark.png), [ds-4 light](../../design/system/ds-4-controls-light.png), [ds-4 dark](../../design/system/ds-4-controls-dark.png), [ds-5 light](../../design/system/ds-5-content-light.png), [ds-5 dark](../../design/system/ds-5-content-dark.png), [ds-6 light](../../design/system/ds-6-band-light.png), [ds-6 dark](../../design/system/ds-6-band-dark.png), [ds-7 light](../../design/system/ds-7-empty-loading-light.png), [ds-7 dark](../../design/system/ds-7-empty-loading-dark.png), [ds-8 light](../../design/system/ds-8-pickers-sheets-light.png), [ds-8 dark](../../design/system/ds-8-pickers-sheets-dark.png).

How a screen is implemented is [0025](0025-implementation-guide-is-mandatory.md). The logo is [0031](0031-logo.md).
