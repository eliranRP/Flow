# Empty, loading, and error states are required

**Date:** 2026-09-26
**Status:** Accepted

## Context

A screen that only draws the happy path leaves the owner with a blank phone while data loads, when a list is empty, or when a save or a file fails.

## Decision

Every screen has an empty state, a loading state, and an error state, in light and in dark.

The patterns live under `design/states/`: `es-*` (empty), `ld-*` (loading), and `er-*` (error). Board [ds-7 light](../../design/system/ds-7-empty-loading-light.png) and [ds-7 dark](../../design/system/ds-7-empty-loading-dark.png) show the set. The grids are [overview light](../../design/states/overview-states-light.png) and [overview dark](../../design/states/overview-states-dark.png).

## Alternatives rejected

Shipping a screen with only the filled state. One mode only.

## Consequences

A screen implementation includes these three states in both modes before it is done. The definition of done in [0025](0025-implementation-guide-is-mandatory.md) checks them.
