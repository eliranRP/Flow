# Line split follow-ups from the #135 review

**Date:** 2026-10-08
**Status:** Accepted

## Context

The #135 review of the percent, rest and reversal split ([0123](0123-line-split-percent-rest-reversal.md)) left three server items in FLOW-325. `get_project` summed a line's parts on a project without their sign, so a reversal part made the project's share look bigger. A reversal part needed a project even in a kept-out category, while a kept-out whole reversal line needs none ([0103](0103-reversals-across-directions.md)). And a part with no project and one naming the line's own project were different pairs, so the same category and project could appear twice.

## Decision

- `get_project` `transactions[].parts_minor` is signed against the line's own kind: its category's kind, or its direction when it has no category. That is the rule `save_line_split` uses to tell a reversal part. A part of the line's kind counts plus and a reversal part counts minus, so the number is the line's net amount on this project in the line's own terms. A supplier refund of 100.00 filed as income on Alpha, with 30.00 put back against Alpha's expenses and the 70.00 rest left as income, shows 40.00 on Alpha. Kept-out parts are still summed, as before: `kept_out` stays a property of the whole line.
- `save_line_split`, and MCP `split_line` through it, let a reversal part in a kept-out category have no project. It counts in no P&L, so it does not need the project the role rule asks for. A line the owner put in the P&L (`in_pnl_override` true) counts its kept-out parts too, so there the part still needs a project, and `set_transaction_pnl(true)` (MCP `set_line_pnl`) on a line that has such a part is refused with `a reversal part needs a project`. MCP undo of `line_split` is `conflict` when it would put such a part back on a line in the P&L (migration `20261010230000`, `private.line_has_loose_reversal`).
- A part with no project is on the line's project, so the duplicate check compares it that way. A part with no project and one naming the line's project, with the same category, are refused with `same category and project twice`. On a line with no project, two parts with no project and the same category are refused too.

## Alternatives rejected

- Leaving kept-out parts out of `parts_minor`. The screen reads the number as "how much of this line is filed here", and a kept-out part is still filed here.
- Signing against the line's direction. On a whole reversal line (a refund filed in an expense category) every part of the line's own category would read as minus, while `save_line_split` treats those parts as the normal ones. One rule in both places is easier to read.

## Consequences

The parts screen can show a project's share of a split refund as is. Two parts with the same category and project are now refused by the server, not only guarded in the app. Stored parts can still end up as such a pair when the line's project changes later or `merge_category` merges two categories; the unique index only stops identical stored values, and the next save of the split refuses the pair.
