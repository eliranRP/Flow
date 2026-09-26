# Date picker

**Date:** 2026-09-26
**Status:** Accepted

## Context

Dates appear on invoices, payments, and a custom range. The product is Hebrew and the owner reads dates as day, month, year.

## Decision

The week starts on Sunday. Dates are shown as dd/mm/yyyy.

There is a single-date picker and a range picker. Both offer shortcuts.

Evidence: [15a light](../../design/screens/15a-date-field-light.png), [15a dark](../../design/screens/15a-date-field-dark.png), [15b light](../../design/screens/15b-date-single-light.png), [15b dark](../../design/screens/15b-date-single-dark.png), [15c light](../../design/screens/15c-date-range-light.png), [15c dark](../../design/screens/15c-date-range-dark.png).

## Alternatives rejected

A week that starts on Monday. A month/day/year display.

## Consequences

Any date field uses this picker. The period sheet's custom range opens the range picker ([0028](0028-period-sheet-with-custom-range.md)).
