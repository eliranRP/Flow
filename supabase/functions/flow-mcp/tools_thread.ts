// MCP tools: notes and files on a line (FLOW-957, decision 0095), what the transaction page's הערות וקבצים
// and the approval card's לפני שמאשרים do. One read, get_transaction_thread, and four writes, each through
// its mcp_* function with the idempotency key and undo: add_transaction_note (note_add),
// edit_transaction_note (note_edit; Mercury's note too, in Flow only: nothing goes to Mercury),
// remove_transaction_note (note_remove) and remove_transaction_file (file_remove). A file is uploaded
// from the app only: the assistant has no file bytes to send.
import { z } from "zod";
import { envelopeOf, fail, ok, READ_REFUSED, type ToolResult, type ToolRpc, UUID, WRITE_REFUSED } from "./tools_args.ts";

const IDEMPOTENCY_KEY = z.string().min(1).max(128);
const ID = z.string().regex(UUID);
const BODY = z.string().trim().min(1).max(5000);

const addSchema = z.object({ idempotency_key: IDEMPOTENCY_KEY, transaction_id: ID, body: BODY }).strict();
const editSchema = z.object({ idempotency_key: IDEMPOTENCY_KEY, note_id: ID, body: BODY }).strict();
const removeNoteSchema = z.object({ idempotency_key: IDEMPOTENCY_KEY, note_id: ID }).strict();
const removeFileSchema = z.object({ idempotency_key: IDEMPOTENCY_KEY, file_id: ID }).strict();

/** The tools' argument allow-list, merged into ALLOWED in tools_schemas.ts. */
export const THREAD_ALLOWED: Record<string, Set<string>> = {
  get_transaction_thread: new Set(["transaction_id"]),
  add_transaction_note: new Set(["idempotency_key", "transaction_id", "body"]),
  edit_transaction_note: new Set(["idempotency_key", "note_id", "body"]),
  remove_transaction_note: new Set(["idempotency_key", "note_id"]),
  remove_transaction_file: new Set(["idempotency_key", "file_id"]),
};

export const THREAD_READS = ["get_transaction_thread"] as const;
export const THREAD_WRITES = ["add_transaction_note", "edit_transaction_note", "remove_transaction_note", "remove_transaction_file"] as const;
export const THREAD_UNDO_KINDS = ["note_add", "note_edit", "note_remove", "file_remove"] as const;

function spec(name: string, description: string, properties: Record<string, unknown>, write: boolean) {
  return {
    name,
    description,
    inputSchema: { type: "object", properties, additionalProperties: false },
    annotations: write
      ? { readOnlyHint: false, destructiveHint: true, idempotentHint: true }
      : { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  };
}

export const THREAD_READ_SPECS = [
  spec("get_transaction_thread", "One line's note and files (FLOW-957), as the transaction page's הערה וקבצים shows them. A line holds one note: Mercury's when it has one, else the note written in Flow. transaction_id is the ledger id. Returns transaction_id, company_id, notes[] (at most one) and files[], oldest first. A note: id, source (flow: written in Flow; mercury: the note on the line in Mercury, kept whole, brought in by a Mercury sync while the line has no note written in Flow), body (up to 5000 characters), mine (written by this user), created_at, updated_at, edited, edited_in_flow (Mercury's note was edited in Flow: the edit stays in Flow, Mercury keeps its own text, and syncs no longer replace it). A file: id, note_id (the note it was attached with, or null), source (flow: uploaded in the app; mercury: an attachment copied from Mercury), file_name, mime (a picture or application/pdf), bytes, path (its place in Flow's private storage; the app opens it), mine and created_at. Removed notes and files are left out. A line of another company is not_found. Any member reads it.", {
    transaction_id: { type: "string" },
  }, false),
];

export const THREAD_WRITE_SPECS = [
  spec("add_transaction_note", "Add the line's note (FLOW-957; owner or editor) when it has none: a line holds one note, and one that has it is refused (line has a note; use edit_transaction_note). transaction_id is the ledger id; body is 1 to 5000 characters (trimmed). Files are attached in the app only. Returns id (the note), transaction_id and undo_kind (note_add: undo with the note id removes it while it still has this text).", {
    idempotency_key: { type: "string" },
    transaction_id: { type: "string" },
    body: { type: "string" },
  }, true),
  spec("edit_transaction_note", "Change the line's note (FLOW-957; owner or editor): the note written in Flow (source flow), whoever wrote it, or the line's Mercury note (source mercury). An edit of Mercury's note stays in Flow: nothing is sent to Mercury, and syncs no longer replace it (edited_in_flow). note_id from get_transaction_thread; body is 1 to 5000 characters. Returns id, source and undo_kind (note_edit: undo with the note id puts the text back while it is still this write's).", {
    idempotency_key: { type: "string" },
    note_id: { type: "string" },
    body: { type: "string" },
  }, true),
  spec("remove_transaction_note", "Remove the line's note written in Flow (FLOW-957; owner or editor). Mercury's note is edited, not removed. Files attached with it stay on the line. note_id from get_transaction_thread. Returns id, transaction_id and undo_kind (note_remove: undo with the note id brings it back).", {
    idempotency_key: { type: "string" },
    note_id: { type: "string" },
  }, true),
  spec("remove_transaction_file", "Remove a file this user uploaded to a line (FLOW-957; owner or editor). Mercury's attachments stay. file_id from get_transaction_thread. The file is kept in storage so undo can bring it back. Returns id, transaction_id and undo_kind (file_remove: undo with the file id brings it back).", {
    idempotency_key: { type: "string" },
    file_id: { type: "string" },
  }, true),
];

export async function threadRead(args: Record<string, unknown>, rpc: ToolRpc): Promise<ToolResult> {
  const id = args.transaction_id;
  if (typeof id !== "string" || !UUID.test(id)) return fail("validation", "validation");
  const result = await rpc("get_transaction_thread", { p_transaction_id: id });
  if (result.status >= 400) return fail("refused", READ_REFUSED);
  if (result.json == null) return fail("not_found", "not found");
  if (typeof result.json !== "object" || Array.isArray(result.json)) return fail("refused", READ_REFUSED);
  return ok(result.json);
}

export async function threadWrite(
  name: typeof THREAD_WRITES[number],
  args: Record<string, unknown>,
  rpc: ToolRpc,
): Promise<ToolResult> {
  let rpcName: string;
  let body: Record<string, unknown>;
  if (name === "add_transaction_note") {
    const parsed = addSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_add_transaction_note";
    body = { p_idempotency_key: parsed.data.idempotency_key, p_transaction_id: parsed.data.transaction_id, p_body: parsed.data.body };
  } else if (name === "edit_transaction_note") {
    const parsed = editSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_edit_transaction_note";
    body = { p_idempotency_key: parsed.data.idempotency_key, p_note_id: parsed.data.note_id, p_body: parsed.data.body };
  } else if (name === "remove_transaction_note") {
    const parsed = removeNoteSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_remove_transaction_note";
    body = { p_idempotency_key: parsed.data.idempotency_key, p_note_id: parsed.data.note_id };
  } else {
    const parsed = removeFileSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_remove_transaction_file";
    body = { p_idempotency_key: parsed.data.idempotency_key, p_file_id: parsed.data.file_id };
  }
  const result = await rpc(rpcName, body);
  if (result.status >= 400) return fail("refused", WRITE_REFUSED);
  return envelopeOf(result.json);
}
