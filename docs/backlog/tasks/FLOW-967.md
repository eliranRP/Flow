<a id="flow-967"></a>
# FLOW-967 · Add: an offline save kept on the device and sent when back online
- **Type:** feature (owner call) · **Status:** ready · **Depends on:** FLOW-966 (#827) · **Source:** the owner's card on 2026-10-26: Add v2's "שמירה במכשיר" is built as its own task after #827. Until then an offline save writes nothing, keeps the form open and says so.
- **Files:** a migration giving `create_manual_line` an idempotency key (a replayed save adds no second line), its pgTAP test, `app/src/use-add-entry.ts`, `app/src/screens/add-entry-sheet.tsx`, a small device queue (`app/src/` new module), `docs/mcp/TOOLS.md` if the MCP write changes, a decision record.

- [ ] `create_manual_line` takes a client key; the same key twice returns the first line and adds nothing (pgTAP, including another company's key).
- [ ] Offline, a save is kept on this device with its key and the toast says "שמירה במכשיר"; the form closes.
- [ ] Back online, the queue sends each kept save once, in order; a failure stays in the queue and says so once, with ניסיון חוזר.
- [ ] A kept save is visible until sent (where: Home or the month's lines; design on the board first).
- [ ] Signing out or switching company clears or keeps the queue by an explicit rule (decision record).
- **Acceptance:** unit tests for the queue (replay, order, failure, duplicate key), pgTAP for the key, an e2e that saves offline and sees the line after reconnecting; decision record.
