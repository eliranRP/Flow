// Flow MCP tools tests: a sync change held for a line in a closed period (FLOW-1166). Invented ids only.
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { callTool, toolsFor } from "./tools.ts";
import { REVIEW, rpcOf, TXN } from "./tools_test_support.ts";
import { TOOL_GROUPS, WORKFLOWS } from "./tools_guide_data.ts";

Deno.test("leave_held_change calls mcp_leave_held_change with the line, and undo takes held_change_left", async () => {
  const { calls, rpc } = rpcOf(() => ({
    status: 200,
    json: { ok: true, data: { transaction_id: TXN, review_id: REVIEW, state: "left", undo_kind: "held_change_left" } },
  }));
  const left = await callTool("leave_held_change", { idempotency_key: "held-1", transaction_id: TXN.toUpperCase() }, ["write"], rpc);
  assertEquals(left.isError, false);
  assertEquals(left.structuredContent, { ok: true, data: { transaction_id: TXN, review_id: REVIEW, state: "left", undo_kind: "held_change_left" } });
  const undo = await callTool("undo", { idempotency_key: "held-2", kind: "held_change_left", id: TXN }, ["write"], rpc);
  assertEquals(undo.isError, false);
  assertEquals(calls, [
    { name: "mcp_leave_held_change", body: { p_idempotency_key: "held-1", p_transaction_id: TXN } },
    { name: "mcp_undo", body: { p_idempotency_key: "held-2", p_kind: "held_change_left", p_id: TXN } },
  ]);
});

Deno.test("leave_held_change refuses a bad argument before any call", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: {} } }));
  for (
    const input of [
      { transaction_id: TXN },
      { idempotency_key: "", transaction_id: TXN },
      { idempotency_key: "k".repeat(129), transaction_id: TXN },
      { idempotency_key: "k" },
      { idempotency_key: "k", transaction_id: "not-a-uuid" },
      { idempotency_key: "k", transaction_id: TXN, review_id: REVIEW },
      { idempotency_key: "k", transaction_id: TXN, company_id: REVIEW },
    ]
  ) {
    const result = await callTool("leave_held_change", input, ["write"], rpc);
    assertEquals(result.isError, true, JSON.stringify(input));
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
  }
  assertEquals(calls.length, 0);
});

Deno.test("leave_held_change passes the database's refusal through and needs write scope", async () => {
  const refused = await callTool("leave_held_change", { idempotency_key: "held-3", transaction_id: TXN }, ["write"], () =>
    Promise.resolve({ status: 200, json: { ok: false, error: { code: "refused", message: "review item not found" } } }));
  assertEquals(refused.isError, true);
  if (!refused.structuredContent.ok) {
    assertEquals(refused.structuredContent.error.code, "refused");
    assertEquals(refused.structuredContent.error.message, "review item not found");
  }
  const failed = await callTool("leave_held_change", { idempotency_key: "held-4", transaction_id: TXN }, ["write"], () =>
    Promise.resolve({ status: 500, json: null }));
  assertEquals(failed.isError, true);
  if (!failed.structuredContent.ok) assertEquals(failed.structuredContent.error.message, "The write was refused.");
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: {} } }));
  const readOnly = await callTool("leave_held_change", { idempotency_key: "held-5", transaction_id: TXN }, ["read"], rpc);
  assertEquals(readOnly.isError, true);
  if (!readOnly.structuredContent.ok) assertEquals(readOnly.structuredContent.error.code, "forbidden");
  assertEquals(calls.length, 0);
});

Deno.test("list_review passes held through and its spec says what a closed_month_change row means", async () => {
  const held = { kind: "update", amount_minor: 135050, currency: "USD", doc_date: "2026-03-29", cash_date: "2026-03-29", line_status: "posted", provider: "mercury" };
  const row = { id: REVIEW, transaction_id: TXN, description: "Example Supply Co", doc_date: "2026-03-14", reason: "closed_month_change", line_status: "posted", held };
  const { rpc } = rpcOf((name) => {
    if (name === "list_review") return { status: 200, json: [row] };
    return { status: 200, json: [] };
  });
  const result = await callTool("list_review", { reason: "closed_month_change" }, ["read"], rpc);
  assertEquals(result.isError, false);
  if (result.structuredContent.ok) {
    const data = result.structuredContent.data as { reviews: Array<Record<string, unknown>> };
    assertEquals(data.reviews[0]?.held, held);
  }
  const spec = toolsFor(["read"]).find((tool) => tool.name === "list_review");
  for (const words of ["closed_month_change", "held", "leave_held_change", "set_books_closed_through", "void", "remove"]) {
    assertStringIncludes(spec?.description ?? "", words);
  }
  const write = toolsFor(["write"]).find((tool) => tool.name === "leave_held_change");
  assertEquals(write?.annotations, { readOnlyHint: false, destructiveHint: true, idempotentHint: true });
  assertEquals(Object.keys(write?.inputSchema.properties ?? {}), ["idempotency_key", "transaction_id"]);
});

Deno.test("the guide puts leave_held_change with the closed books and walks the held change", () => {
  assertEquals(TOOL_GROUPS.find((group) => group.id === "prepaid")?.tools.includes("leave_held_change"), true);
  const steps = WORKFLOWS.find((workflow) => workflow.id === "held_change")?.steps.join(" ") ?? "";
  assertStringIncludes(steps, "leave_held_change");
  assertStringIncludes(steps, "set_books_closed_through");
});
