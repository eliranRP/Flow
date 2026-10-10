# Project rows: a long name wraps to two lines

- PR: pending (UI lane 1).
- Kind: component
- Changed: a project row (Home, the Projects tab, a group's page, and the other project-variant rows) cut a long name to one line. The name now wraps to two lines, then ends in an ellipsis, like the loan and customer lists. A row with a tag keeps its one line. The hint under the name also stops at two lines, so a row stays a row (§2.1). At 375x667 Home's first project row still shows above the tab bar with a two-line name.
- Rule: a project's name is its identity; it wraps before it truncates (§3.7).
- Source: FLOW-358 item 3, cycle 14.
- Shots: reviews/flow-358-long-names/ in the project files (Home at 375x667, 390 and 320, light and dark; the long-name row at 320 and 390).
