# Screens are assembled from one component library

**Date:** 2026-09-28
**Status:** Accepted

## Context

Phase 0 and the books slice each drew buttons, rows, empty states, and sheets in the screen that needed them. The design system already names one inventory (buttons, the band, rows, sheets, fields, chips, the tab bar) with light and dark, RTL, and 44px targets. Building the remaining screens the same way would copy that inventory again.

Records 0051 through 0056 belong to the remainder branch and are not reused here.

## Decision

Shared UI lives in `app/src/ui`. Screens import it. A screen does not define its own button, row, sheet, or empty state. A new control is added to the library.

The set follows [DESIGN-RULES.md](../design/DESIGN-RULES.md) and the token file: Button (primary, secondary, pill, danger), IconButton, TopBand, BigNumber (whole ₪, before VAT), ListRow (project, transaction, review, supplier), Card and Section, Vaul Sheet and ConfirmSheet, EmptyState, Skeleton and Loader, ErrorState, Banner and Notice, TextField, MoneyField, Select, Toggle, DatePicker, PeriodPicker, SegmentedControl, Chip and StatusPill, ProgressBar and BudgetBar, TabBar, Avatar, and the Google button. Props are typed. Colours are tokens, so light and dark follow `data-theme` on `<html>`. Amounts are an LTR `bdi`. Interactive controls are at least 44px. Each component has a test.

Review of the controls is Storybook, recorded in [0058](0058-storybook.md). There is no `/dev/components` route.

Phase 0 surfaces are compositions of this library: Home (including empty, loading, and the two load errors), sign-in, and help. The books screens that are not those surfaces still contain local controls. They move onto the library as the next checkpoint, before any new screen is built.

## Alternatives rejected

A second package with its own look. The implementation guide forbids a component kit that does not match the tokens. Vaul stays the sheet engine.

Putting a gallery in the tab bar, or shipping one as an app route. Reviewers open Storybook. Owners do not.

Rewriting every books screen in the same change as the library. The library is the review checkpoint. The screen move is the next one.

## Consequences

New screens start from `app/src/ui`. Home's period sheet, basis control, overhead switch, amounts, rows, and load errors are library components. `?preview=error` and `?preview=error-server` are unchanged in copy. Compare a control with the design boards in Storybook before it shows up on a screen.
