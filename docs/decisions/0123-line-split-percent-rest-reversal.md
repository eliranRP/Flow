# Split a line by percent, with a rest part and reversal parts

**Date:** 2026-10-08
**Status:** Accepted

## Context

The owner wants to take part of a refund (or any line) and split it across projects and categories by percent or exact amount, leaving the rest where it was (FLOW-325). `save_line_split` ([0104](0104-line-split-by-category.md)) took only exact amounts that summed to the line, and refused a part of the other kind, so a vendor refund that landed as income could not go back against the expenses it reverses.

## Decision

- A part gives exactly one of `amount_minor` (whole minor units above zero), `percent` (above 0, up to 100, at most 4 decimals, of the whole line) or `rest: true`.
- Percent parts are rounded together: each takes the floor of its share, and the cents still missing from the rounded total of the percents (the whole line at 100%) go to the largest remainders, the first part first on a tie. So 33.33/33.33/33.34% of $100.01 is $33.33, $33.33 and $33.35, and 50/50 of $100.01 is $50.01 and $50.00.
- At most one rest part takes what the others leave. Without `category_id` it keeps the line's own category (refused with `line has no category for the rest` on an uncategorised line); without `project_id` it keeps the line's project and role, like any part. A rest with nothing left is dropped (refused with `nothing is left for the rest` when one part would remain).
- Without a rest part the parts still sum to the line (`parts must sum to the line`), so a mistyped amount is still caught. More than the line is `parts exceed the line`; a percent part worth no cents is `a part rounds to zero`.
- A part whose category kind differs from the line's direction is a reversal, as a whole line is since FLOW-104 ([0103](0103-reversals-across-directions.md)). It needs its own project (`a reversal part needs a project`), because the line's role was set for the line's own kind; a part in the line's own category is exempt. The P&L view already takes each part's side from its category kind, so it is unchanged.
- Only amounts are stored. `line_splits`, `get_line_split`, the view and undo are unchanged; the app shows a part's percent from its amount and the line.
- MCP `split_line` takes the same parts. The new reasons are on the `mcp_refused` list.

## Alternatives rejected

- Storing the percent on each part: undo, the view and every read would carry a second number that only the editing screen needs.
- Leaving any shortfall on the line without a rest part: a typo in an amount would silently file the difference under the line's category.
- Percents of what is left after the amount parts: harder to read back; a percent here always means the whole line.

## Consequences

The app screen to view and edit the parts (FLOW-325, UI half) goes to the design thread with a plan and mockup first. FLOW-312's "part takes the other kind" and "app screen" items move to FLOW-325.
