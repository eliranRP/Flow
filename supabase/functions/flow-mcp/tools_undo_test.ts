// Flow MCP tools tests: undo of a filing once the line changed since (FLOW-1166 part 4). Invented ids only.
import { assertEquals } from "jsr:@std/assert@1";
import { callTool } from "./tools.ts";
import { REVIEW, rpcOf, TXN } from "./tools_test_support.ts";

Deno.test("undo of a reassign passes the server's refusal of a line changed since word for word", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: false, error: { code: "conflict", message: "line changed since" } } }));
  const out = await callTool("undo", { idempotency_key: "undo-reassign", kind: "reassign", id: TXN }, ["write"], rpc);
  assertEquals(out.isError, true);
  assertEquals(out.structuredContent, { ok: false, error: { code: "conflict", message: "line changed since" } });
  assertEquals(calls, [{ name: "mcp_undo", body: { p_idempotency_key: "undo-reassign", p_kind: "reassign", p_id: TXN } }]);
});

Deno.test("undo of a review whose newer card is open still succeeds, in the same shape", async () => {
  const { rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { kind: "review", id: REVIEW } } }));
  const out = await callTool("undo", { idempotency_key: "undo-review-2", kind: "review", id: REVIEW }, ["write"], rpc);
  assertEquals(out.isError, false);
  assertEquals(out.structuredContent, { ok: true, data: { kind: "review", id: REVIEW } });
});
