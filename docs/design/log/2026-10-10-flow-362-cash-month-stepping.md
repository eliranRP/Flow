# The cash month page steps months

- PR: pending (UI lane 1).
- Kind: screen and component
- Changed: an earlier month's cash page was a dead end; seeing the next month took two taps through Home. Its title line now ends with › (the earlier month) and ‹ (the later one), the period bar's outward SVG chevrons in one quiet rounded segment in the period pill's tint (so the pair reads as a pager, not as the rows' drill-in chevrons; design lead), and a sideways swipe on the figure steps the month as on the profit band. The current month has no later chevron and the books' first month no earlier one; an empty slot keeps the other chevron in place. Stepping replaces the page in history, so Back still returns to where the page was opened. New `MonthStepper` in app/src/ui, `ScreenHeader` gains `titleAside`, and `PeriodSwipe` takes `allow` to block a window the screen has no page for.
- Rule: a period steps from where the thumb is, with outward chevrons (§3.4) and the same swipe rules everywhere (FLOW-314/336).
- Source: FLOW-362 (cycle 15, C15-6).
- Shots: reviews/flow-362-month-stepping/ in the project files (390 and 320, light and dark, and the current month).
