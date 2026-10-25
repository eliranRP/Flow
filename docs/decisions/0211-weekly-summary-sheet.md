# The weekly push opens a summary sheet over Home

**Date:** 2026-10-25
**Status:** Accepted (FLOW-517. Refines [0018](0018-two-notifications.md)'s "tap opens Home")

## Context

[0018](0018-two-notifications.md) has the Sunday push open Home. The push itself names counts only and never an amount (the owner's pick in FLOW-502, 2026-10-09), so tapping it showed the current month and nothing about the week it announced. The owner asked to see the summary in the app, chose "a sheet over Home" from three concepts (a filter on Home, a sheet, a report screen), and approved its design on 2026-10-25 (design canvas, "Ready for dev", section "Weekly summary").

## Decision

1. **The link.** The weekly push opens `/?week=<Sunday>`, the Sunday of the week that just ended, in Israel time. An old push still opens the week it was about. A missing, malformed, non-Sunday or future `week` opens Home alone.
2. **The sheet.** Home opens on the current month with the summary sheet over it: the week's profit and its change from the week before, money in, money out and what profit leaves out, at most one project alert, the line counts, and the review button (or "הכול מאושר", or for a week with no lines the empty state and the bank connection). Closing it drops `week` from the address and leaves Home as it is.
3. **The week.** Sunday 00:00 to Saturday 23:59, Israel time. The sums are the cash view's for those seven days, in the base currency: in and out by the company's cash basis, profit as Home's רווח החודש counts a month, and "לא נספר ברווח" as in less out less profit, so the four always add up. Lines waiting for review count in them, as Home counts them (`pnl_lines` has no review filter; [0050](0050-demo-splits-and-review.md) amends [0006](0006-confirm-not-type.md) for SUMIT rows). The sheet says how many of the week's lines still wait ("כולל N שעוד מחכות לאישור"); it does not say they are left out.
4. **The counts.** Lines are bank and SUMIT lines that came in during the week, by when they arrived. Auto-approved are those that never had a review row (0011). The review button's count is the whole open queue now, as the push and Home's דורש טיפול count it; its time is about 20 seconds an item.
5. **The alert.** The active, non-overhead project most over budget, by percent, with spent counted as the projects list counts it, and how many more are over. Which project should win is still [open](../open-questions.md#which-project-alert-is-the-weekly-one); the largest overrun is the default until the owner decides.
6. **MCP.** `weekly_summary(p_week_start)` is the RPC; `get_weekly_summary` is its read tool ([0095](0095-mcp-first.md)).

## Alternatives rejected

- Home set to last week (a period filter): it reads as a filter, not a summary, and Home has no week period.
- A weekly report screen with a history of weeks: a third reporting surface next to Home and the project page, and the most to build. It can grow out of the sheet later.
- Amounts in the push: the owner chose counts only.

## Consequences

- The push no longer opens the review queue directly; the sheet's button does. The evening reminder still opens it.
- A project's budget alert compares all-time spend with the budget, as the projects list does; it does not depend on the week.
- The weekly push's "new lines" count is the 7 days before the send; the sheet's is Sunday to Saturday. On Sunday at 08:00 they differ only by what arrived on Sunday morning.
