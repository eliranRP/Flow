# Line split follow-ups from the #135 review

**Date:** 2026-10-08
**Status:** Accepted

## Context

The #135 review of the percent, rest and reversal split ([0123](0123-line-split-percent-rest-reversal.md)) left three server items in FLOW-325. `get_project` summed a line's parts on a project without their sign, so a reversal part made the project's share look bigger. A reversal part needed a project even in a kept-out category, while a kept-out whole reversal line needs none ([0103](0103-reversals-across-directions.md)). And a part with no project and one naming the line's own project were different pairs, so the same category and project could appear twice.

## Decision

- `get_project` `transactions[].parts_minor` is signed against the line's direction. A part whose category kind is the line's direction (or has no kind) counts plus. A reversal part counts minus. So a refund of 100.00 on Alpha, with 30.00 put back against Alpha's expenses and the rest left, shows 40.00 on Alpha. Kept-out parts are still summed, as before: `kept_out` stays a property of the whole line.
- `save_line_split`, and MCP `split_line` through it, let a reversal part in a kept-out category have no project. It counts in no P&L, so it does not need the project the role rule asks for.
- A part with no project is on the line's project, so the duplicate check compares it that way. A part with no project and one naming the line's project, with the same category, are refused with `same category and project twice`. On a line with no project, two parts with no project and the same category are refused too.

## Alternatives rejected

- Leaving kept-out parts out of `parts_minor`. The screen reads the number as "how much of this line is filed here", and a kept-out part is still filed here.
- Signing by the line's own category kind, as `save_line_split` does for the role rule. The P&L takes each part's side from its category against the line, and the list shows the line's `amount_net` in its direction, so the direction is what the number is read against.

## Consequences

The parts screen can show a project's share of a split refund as is. The other #135 item, two parts with the same category and project, is now also refused by the server, not only guarded in the app.
