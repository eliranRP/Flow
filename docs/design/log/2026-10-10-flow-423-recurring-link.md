# 2026-10-10 · FLOW-423: a fixed way into קבועים from Home

- PR: (UI lane 2), the design lead's cycle 17 pick (C17-3).
- What: Home ends with a quiet "לכל הקבועים" link on its own line, under "לכל החודשים". It shows whenever the company has a recurring party: one late, one changed, or one seen this month. So the קבועים screen, with its הגיעו החודש section and its "הכל הגיע" state, stays one tap away when Home's attention box has no recurring row. The tap area is 44px tall.
- Rule: a screen that Home otherwise opens only from an alert gets a fixed quiet TextLink at the end of Home, so it can still be reached once the alert is gone.
- Shots: /mnt/project-files/mockups/flow-423/ (390 light and dark, 320, with and without alerts).
