# FLOW-358: group search hint, group not found, setup note wrap

- PR: UI lane 3, cycle 14 polish.
- What changed:
  - Project picker: when a search finds a project only through its group's name ("לדוגמה"), the group's name shows under the row, so a visible row holds what was typed. A match on the project's own name or code shows no hint.
  - Group page, group not found: the standard empty state (icon, "הקבוצה לא נמצאה", one line, the tint button "לכל הפרויקטים") in place of the bare subtitle. The page drops its big title "קבוצה": the labelled Back "פרויקטים", then the empty state.
  - Setup notes wrap with `text-wrap: pretty`, so the SUMIT-failed note no longer leaves one word on its last line.
- Rule: a search row says why it matched when the match isn't in its own name.
- Shots: mockups/flow-358-lane-3/ in the project files.
