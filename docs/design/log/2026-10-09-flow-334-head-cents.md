# 2026-10-09 · FLOW-334: head totals draw agorot like their rows

- PR: #409 (UI lane 2)
- What: on lists that show exact cents (search, review, שויכו היום), the month and project heads printed ".00" at full size while the rows under them draw agorot small and raised (`.ui-num-cents`). The heads now draw them the same way. The first שויכו היום head already stands 24px under the title (FLOW-347), so no spacing changed.
- Rule: a head's totals draw agorot the way the rows under it do; a list never mixes full-size and small agorot.
- Shots: mockups/flow-334-head-cents/ in the project files.
