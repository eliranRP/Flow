# Toast in parts, and the update reload waits for a move

- PR: FLOW-426 (cycle 19, C19-3 and C19-4).
- Kind: component
- Changed: a toast whose message has parts joined by " · " (the viewer note, "צפייה בלבד · שינויים נעשים על ידי בעל העסק") wraps only between whole parts, through `HintParts`; at 320 to 375 it no longer breaks inside a part, and it stays one line at 393. The FLOW-910 reload onto a new deploy no longer happens while the page is in front and idle: it waits for the next move to another screen (and lands there) or for the app to go to the background, never while a sheet is open or a field has focus. No toast or banner.
- Rule: a hint or toast in parts breaks only at its "·"; an app update never reloads under the user.
- Source: cycle 19 phone review and code review of #555 (design lead).
- Shots: Storybook Components/Toast ViewerNote320; reviews/ui-ux-cycle-19/ in the project files.
