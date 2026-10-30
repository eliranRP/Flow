<a id="flow-166"></a>
# FLOW-166 · Reports file: a per-user rate limit on flow-mcp's report route, and a deploy smoke for export_report
- **Type:** BACKLOG NIT · **Status:** done (#861) · **Depends on:** [FLOW-162](FLOW-162.md) · **Source:** reviewer of #856, rounds 1 and 2 (Backlog).

- [x] flow-mcp's `report` route (the app's share button) has a per-user limit, like the MCP's read bucket: a render costs about 0.1 to 0.4 s of CPU and 3 to 4 reads.
- [x] The deploy check makes one `export_report` call (or one `report` route call as the smoke user), so a deploy that leaves the PDF renderer out of the bundle (it loads with a dynamic import) fails the check.
