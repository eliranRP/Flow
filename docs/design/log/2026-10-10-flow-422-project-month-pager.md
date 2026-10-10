# A project's month page steps months like Home's

- PR: #537 (UI lane 1).
- Kind: screen
- Changed: an earlier month's project page (`/projects/:id/cash/:month`) carries Home's `MonthStepper` segment by the title and a `PeriodSwipe` on the figure (FLOW-362). It steps only within the months the project's read holds, so the oldest month keeps the earlier step's empty slot and the current month has no later step. A step replaces the page in place, so Back still returns to the project. Back is labelled with the project's name (ellipsized) instead of "תזרים", since it goes to the project and the page does not otherwise say which project it is (design lead).
- Rule: a month page steps its months the same way everywhere (§3.7 FLOW-362).
- Source: FLOW-422 (cycle 17, C17-2).
- Shots: reviews/flow-422-project-month-pager/ in the project files (390 light and dark, 320).
