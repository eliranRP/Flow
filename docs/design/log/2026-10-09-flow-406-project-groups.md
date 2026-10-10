# 2026-10-09 · FLOW-406: project groups on the Projects tab, the group page and the grouped picker

- PR: #418 (UI lane 4)
- Screens: proj-b, proj-b-2 and picker from the approved mockups (mockups/plan-first/flow-406/ in the project files).
- What: on פרויקטים a group is one row (its name, "4 פרויקטים" under it, its summed profit and a chevron) above the projects in no group; finished projects still fold under "עוד N שהסתיימו". The row opens the group's page: back to פרויקטים, the group's name, "4 פרויקטים · רווח ב־3 חודשים", and its projects, active first. A search lists matching projects flat, inside a group or not, and a group whose name matches. In the project picker, a group's projects sit under the group's name and the others under "שאר הפרויקטים"; a search lists matches flat and also matches the group's name. The loose project rows keep their amounts in line with the group row's (`chevronSpace`).
- Rule: a group reads like a project row with a count, never a header with a total; its page and its row show the same figures from the same read.
- Not here: creating groups and moving projects into them (the MCP tools do that today).
- Shots: mockups/flow-406/built/ in the project files.
