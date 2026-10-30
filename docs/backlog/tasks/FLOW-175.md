<a id="flow-175"></a>
# FLOW-175 · Undo a journal entry another member wrote (owner only)
- **Type:** MCP · **Status:** ready · **Depends on:** [FLOW-174](FLOW-174.md) · **Source:** the MCP/data agent, 2026-10-30 (the second extra of the correction request).

- [ ] The owner may remove a journal entry another member wrote, while it is unchanged; the removal is recorded in the entry's history (who, when, why).
- [ ] Editors and viewers stay refused for another member's entry.

**Acceptance:** pgTAP for the owner, an editor and a viewer.
