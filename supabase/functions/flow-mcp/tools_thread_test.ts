// Flow MCP tools tests: notes and files on a line (FLOW-957): get_transaction_thread, add_transaction_note,
// edit_transaction_note, remove_transaction_note and remove_transaction_file. Invented names only.
import { assertEquals } from "jsr:@std/assert@1";
import { callTool, toolsFor } from "./tools.ts";
import { rpcOf } from "./tools_test_support.ts";

const LINE = "c0ffee00-9570-4000-8000-000000000001";
const NOTE = "c0ffee00-9570-4000-8000-000000000002";
const FILE = "c0ffee00-9570-4000-8000-000000000003";

const THREAD = {
  transaction_id: LINE,
  company_id: "c0ffee00-9570-4000-8000-0000000000c0",
  notes: [{ id: NOTE, source: "mercury", body: "Lumber for back deck", mine: false, created_at: "2026-10-10T10:00:00Z", updated_at: "2026-10-10T10:00:00Z", edited: false, mercury_push: null }],
  files: [],
};

Deno.test("get_transaction_thread reads one line's thread, and another company's line is not_found", async () => {
  const { rpc, calls } = rpcOf((_name, body) => ({ status: 200, json: body.p_transaction_id === LINE ? THREAD : null }));
  const found = await callTool("get_transaction_thread", { transaction_id: LINE }, ["read"], rpc);
  assertEquals(found.structuredContent.ok ? found.structuredContent.data : null, THREAD);
  const missing = await callTool("get_transaction_thread", { transaction_id: NOTE }, ["read"], rpc);
  assertEquals(missing.structuredContent.ok ? null : missing.structuredContent.error.code, "not_found");
  const bad = await callTool("get_transaction_thread", { transaction_id: "nope" }, ["read"], rpc);
  assertEquals(bad.structuredContent.ok ? null : bad.structuredContent.error.code, "validation");
  assertEquals(calls.map((call) => call.name), ["get_transaction_thread", "get_transaction_thread"]);
});

Deno.test("the four writes go to their mcp_* functions with the idempotency key", async () => {
  const { rpc, calls } = rpcOf(() => ({ status: 200, json: { ok: true, data: { id: NOTE } } }));
  await callTool("add_transaction_note", { idempotency_key: "n-1", transaction_id: LINE, body: "  Paid in two parts  " }, ["write"], rpc);
  await callTool("edit_transaction_note", { idempotency_key: "n-2", note_id: NOTE, body: "Lumber, phase 2" }, ["write"], rpc);
  await callTool("remove_transaction_note", { idempotency_key: "n-3", note_id: NOTE }, ["write"], rpc);
  await callTool("remove_transaction_file", { idempotency_key: "n-4", file_id: FILE }, ["write"], rpc);
  assertEquals(calls, [
    { name: "mcp_add_transaction_note", body: { p_idempotency_key: "n-1", p_transaction_id: LINE, p_body: "Paid in two parts" } },
    { name: "mcp_edit_transaction_note", body: { p_idempotency_key: "n-2", p_note_id: NOTE, p_body: "Lumber, phase 2" } },
    { name: "mcp_remove_transaction_note", body: { p_idempotency_key: "n-3", p_note_id: NOTE } },
    { name: "mcp_remove_transaction_file", body: { p_idempotency_key: "n-4", p_file_id: FILE } },
  ]);
});

Deno.test("an empty or too long note is refused before any write", async () => {
  const { rpc, calls } = rpcOf(() => ({ status: 200, json: { ok: true, data: {} } }));
  for (const body of ["   ", "x".repeat(5001)]) {
    const result = await callTool("add_transaction_note", { idempotency_key: "n-5", transaction_id: LINE, body }, ["write"], rpc);
    assertEquals(result.structuredContent.ok ? null : result.structuredContent.error.code, "validation");
  }
  assertEquals(calls.length, 0);
});

Deno.test("a read-only token lists the thread but none of its writes; undo takes the note kinds", () => {
  const read = toolsFor(["read"]).map((tool) => tool.name);
  assertEquals(read.includes("get_transaction_thread"), true);
  assertEquals(read.includes("add_transaction_note"), false);
  const undo = toolsFor(["write"]).find((tool) => tool.name === "undo");
  const kinds = ((undo?.inputSchema.properties as Record<string, { enum?: string[] }>).kind?.enum ?? []);
  assertEquals(["note_add", "note_edit", "note_remove", "file_remove"].every((kind) => kinds.includes(kind)), true);
});
