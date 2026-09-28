# Audit layout calls

**Date:** 2026-09-28
**Status:** Accepted

## Context

The per-story audit of `0cedefa` left design gaps where the implementation guide and the mockups disagree, or say nothing. The same pass still had crashes, a blank change pill, sideways overflow at 320, and a few copy mistakes. [0061](0061-review-undo.md) already took Toggle and DatePicker out of the library, and it already set `cursor: not-allowed` on disabled controls.

## Decision

**G5.** A fixed-height control stays one line. That is Button, Chip, the status pill, SegmentedControl, the PeriodPicker pill, and tab labels. Long text ellipsizes. The full string is in `title` and `aria-label`. The chevron and icons stay visible. A ListRow title is one line with an ellipsis. A project name in TopBand, ProgressBar, and a page title clamp to two lines. A flexible box gets `min-inline-size: 0`, so nothing overflows sideways.

**G1, G2, G3.** An empty-state title is `title-3`, clamped to two lines, `max-inline-size: 280px`, and centred. The body is 15px, weight 400, muted, clamped to three lines. The action is the 36px fully round small pill from [0044](0044-phase-0-shell-calls.md) §2, on one line. EmptyState Default uses that same centred block.

**G4.** The error retry stays the primary button from ld-08 and [0045](0045-phase-0-design-gaps.md).

**G6.** The pressed on-band IconButton uses a white 16% overlay. Every tappable control has a pressed state.

**G7.** A sheet title is one line with an ellipsis.

**G8.** The live preview label stays `מצב תצוגה`, including the loading band. That amends the loading sentence in [0061](0061-review-undo.md): a signed-in load still hides the label, and a preview load shows it. Storybook sample frames carry `נתוני דוגמה`. The running app does not.

**G9.** ChangePill takes the exact change. Exactly 0 shows a neutral `0%`. A value that rounds to 0 shows `<1%`, and the direction comes from the exact value. The pill is hidden only when there is no comparison period.

**G10.** Checkbox, Toast, SearchField, and RadioRow follow the ds-4 and ds-5 boards: the checkbox focus ring sits on the box, rows and the toast action show a pressed state, and the search field stays full width. A long ReviewCard supplier name is one line with an ellipsis.

**G11.** This is [0061](0061-review-undo.md) plus `cursor: pointer` on an enabled control.

**Percentages.** The used percent is floored, so 99.9% is not shown as 100%. Over budget shows the real percentage, for example 120%, and only the bar caps at 100%.

The closed period story is the band and the on-band pill. It does not add a `תקופה` line under the wordmark. The sheet title is still `תקופה`.

A status chip has no checkmark. The tab count `99+` sits in `<bdi dir="ltr">`. A ListRow date for the current year is `dd/mm`.

Storybook sample states do not call `console.error`. Toggle and DatePicker stay out of the library, so those audit rows are not rebuilt.

## Alternatives rejected

Letting a long button or chip grow in height. That was the audit's suggested fix, and it fights the fixed heights in the guide.

Hiding a 0% change. The guide asks for a neutral pill.

Rounding the change before ChangePill sees it. That cannot tell exactly 0 from a fraction under 1%.

Dropping `מצב תצוגה` from the loading band. [0044](0044-phase-0-shell-calls.md) puts that label on a preview.

## Consequences

`pnpm test:storybook:smoke` opens every story in the built static Storybook and fails on a console error. The layout check covers every Long Hebrew and Large Amount story at 390 and 320, plus the list of rows, Home Books Month, and Home Loading.
