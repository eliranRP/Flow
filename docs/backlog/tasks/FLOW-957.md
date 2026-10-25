<a id="flow-957"></a>
# FLOW-957 · Notes and files on a transaction, with Mercury's note and attachments
- **Type:** UI (design approved) · **Status:** in-progress · **Depends on:** — · **Source:** the owner asked to comment on a transaction and attach files, from the transaction page and from approval, and to pull and edit Mercury's note and files (2026-10-25). Three concepts were drawn; the owner approved concept A (a thread on the transaction page) with concept C's "before approving" sheet on the approval card on 2026-10-25. Design: [Transaction notes & files](https://claude.ai/artifact/NQz7ruHV46yRzeXQfBJ9TF), boards "A · Thread — transaction page" and "C · Sheet — approval card".
- **Files:** `supabase/migrations/` (notes, files, the `transaction-files` bucket, the RPCs and MCP functions) with a pgTAP test, `supabase/functions/_shared/connectors/mercury/` (the note and the attachments), `supabase/functions/mercury-sync/`, `supabase/functions/flow-mcp/` (the tools), `packages/shared/src/` (the thread schema), `app/src/` (the hooks, the thread on the transaction page, the sheet on the approval card) with stories and tests, `docs/mcp/TOOLS.md`.

- [ ] The transaction page shows "הערות וקבצים": Mercury's note (with its files), the owner's notes with their files, oldest first, and a composer at the bottom: a paperclip (camera or file) and a text field.
- [ ] Mercury's note comes in whole with every sync (not the 200-character memo) and can be edited in Flow. The edit stays in Flow: nothing is written to Mercury (owner, 2026-10-25), and later syncs keep it.
- [ ] Mercury's attachments are copied into Flow's storage on sync, so their links never expire.
- [ ] The approval card shows a badge with the count of notes and files. Tapping it, or "הוספת הערה או קובץ", opens the "לפני שמאשרים" sheet: Mercury's note, camera / file / note, and "לשמור ולאשר".
- [ ] Every action has a flow-mcp tool (decision 0095): list the thread, add, edit and delete a note, with idempotency and undo.

- **Acceptance:** stories of the thread (empty, Mercury only, mixed) and the sheet at 320 and 393; pgTAP for the tables, the RPCs, the bucket policies and the MCP writes; Deno tests for the Mercury note and attachments.
