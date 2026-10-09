<a id="flow-410"></a>
# FLOW-410 · Find every project in project search
- **Type:** BUG · **Status:** done (#128) · **Depends on:** —
- **What:** From the 2026-10-07 tap-count review. Project search doesn't find an active project past the first six or a finished one, so those take 3 taps or more. Search filters all projects, finished included, whenever the query is not empty; every active project shows by default, finished ones stay behind their link.
- **MCP:** none (`list_projects` exists).
- **Acceptance:** tests: a seventh active project and a finished project are found by name; 320px check; design review.
