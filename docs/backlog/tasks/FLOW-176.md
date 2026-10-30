<a id="flow-176"></a>
# FLOW-176 · Set the project of one journal entry leg
- **Type:** MCP · **Status:** ready · **Depends on:** [FLOW-174](FLOW-174.md) · **Source:** the MCP/data agent, 2026-10-30 (the third extra of the correction request).

- [ ] MCP `set_journal_entry_leg_project(journal_entry_id, expected_version, leg_ordinal, project_id)`: a shortcut over `update_journal_entry` that changes one leg's project without sending every leg, recorded as a version with its reason.

**Acceptance:** pgTAP: the leg moves project, the other legs and every total stay, the history has the version.
