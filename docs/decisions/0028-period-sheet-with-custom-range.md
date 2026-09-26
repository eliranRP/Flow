# Period sheet with a custom range

**Date:** 2026-09-26
**Status:** Accepted

## Context

[0019](0019-home-periods-and-comparison.md) set Home's periods to this month, last month, and year to date, and said there is no custom date range in this phase. The band now has a period pill that needs a place to change that period, including a range the three names do not cover.

## Decision

The period sheet opens from the band pill.

It offers this month, last month, and year to date, plus a custom range. The custom range opens the range picker from [0027](0027-date-picker.md).

Evidence: [16 light](../../design/screens/16-period-sheet-light.png) and [16 dark](../../design/screens/16-period-sheet-dark.png).

This supersedes only the "no custom date range in this phase" clause of 0019, and the rejected alternative "Custom ranges in this phase" in that record. The three named periods and the comparison arrows stay as 0019 wrote them.

## Alternatives rejected

Keeping custom ranges out of this phase. A separate screen for the period instead of a sheet from the pill.

## Consequences

0019 stays Accepted. Its three periods are still the named choices. A custom range is now allowed from this sheet. The year-to-date comparison baseline in 0019 stays [open](../open-questions.md#year-to-date-comparison).
