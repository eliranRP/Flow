// Flow MCP tools tests: remember_supplier_category (FLOW-965, decision 0216). Invented ids only.
import { assertEquals } from "jsr:@std/assert@1";
import { callTool, toolsFor } from "./tools.ts";
import { rpcOf } from "./tools_test_support.ts";

const LINE = "c0ffee00-9650-4000-8000-000000000001";
const CATEGORY = "c0ffee00-9650-4000-8000-0000000000c1";

Deno.test("remember_supplier_category forwards the line, undo takes kind supplier_category", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { undo_kind: "supplier_category", id: LINE } } }));
  const done = await callTool("remember_supplier_category", { idempotency_key: "sr-1", transaction_id: LINE.toUpperCase(), category_id: CATEGORY }, ["write"], rpc);
  assertEquals(done.isError, false);
  assertEquals(calls.at(-1), { name: "mcp_remember_supplier_category", body: { p_idempotency_key: "sr-1", p_transaction_id: LINE, p_category_id: CATEGORY } });

  const undo = await callTool("undo", { idempotency_key: "sr-u", kind: "supplier_category", id: LINE }, ["write"], rpc);
  assertEquals(undo.isError, false);
  assertEquals(calls.at(-1), { name: "mcp_undo", body: { p_idempotency_key: "sr-u", p_kind: "supplier_category", p_id: LINE } });
});

Deno.test("remember_supplier_category is a write tool and checks its input before the call", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: {} } }));
  assertEquals(toolsFor(["read"]).some((tool) => tool.name === "remember_supplier_category"), false);
  assertEquals(toolsFor(["write"]).some((tool) => tool.name === "remember_supplier_category"), true);

  const denied = await callTool("remember_supplier_category", { idempotency_key: "k", transaction_id: LINE, category_id: CATEGORY }, ["read"], rpc);
  assertEquals(denied.isError, true);
  if (!denied.structuredContent.ok) assertEquals(denied.structuredContent.error.code, "forbidden");

  for (const input of [
    { idempotency_key: "k" },
    { idempotency_key: "k", transaction_id: LINE },
    { idempotency_key: "k", transaction_id: "not-a-uuid", category_id: CATEGORY },
    { idempotency_key: "k", transaction_id: LINE, category_id: "not-a-uuid" },
    { idempotency_key: "k", transaction_id: LINE, category_id: CATEGORY, project_id: LINE },
    { transaction_id: LINE, category_id: CATEGORY },
  ]) {
    const result = await callTool("remember_supplier_category", input, ["write"], rpc);
    assertEquals(result.isError, true);
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
  }
  assertEquals(calls.length, 0);
});
