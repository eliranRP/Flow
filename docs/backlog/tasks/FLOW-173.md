<a id="flow-173"></a>
# FLOW-173 · get_account_lines: drop year_start from the output after one release
- **Type:** BACKLOG NIT · **Status:** ready · **Depends on:** [FLOW-171](FLOW-171.md) · **Source:** reviewer of #869, round 1 (B1).

- [ ] Once the FLOW-171 app has been live for one release (no installed app still reads `year_start`), a new migration drops `year_start` from `get_account_lines`' output; the app and MCP read `from` and `from_start`. Remove the two `year_start` pgTAP checks in `account_lines.test.sql` and the `year_start` mentions in `docs/mcp/TOOLS.md` and the tool's spec (`tools_ledger_specs.ts`).
