# FLOW-420: the notifications card's question is balanced

- PR: UI lane 3.
- What changed: `.ui-prompt-question` gets `text-wrap: balance`, so "התראה על תנועה חדשה ותזכורת בערב?" breaks into two even lines at 375, 393 and 412 instead of leaving "בערב?" alone.
- Rule: a prompt card's question that wraps is balanced, like the titles.
- Shots: mockups/flow-420-lane-3/ in the project files.
