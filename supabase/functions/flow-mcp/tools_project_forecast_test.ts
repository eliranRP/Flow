// Flow MCP tools tests: a project's next-month forecast edits. The read forwards project_forecast_edits_for;
// the four writes forward to their mcp_* functions, need a write token, and refuse a bad body before any call.
import { assertEquals } from "jsr:@std/assert@1";
import { callTool } from "./tools.ts";
import { CATEGORY, PROJECT, rpcOf } from "./tools_test_support.ts";

const EDIT = { id: "e-1", kind: "change", row_key: "avg:repairs", category_id: null, direction: null, amount_minor: 120000, pace: "once", start_month: "2026-11" };

Deno.test("get_project_forecast_edits reads the month's edits of the project", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: [EDIT] }));
  const result = await callTool("get_project_forecast_edits", { project_id: PROJECT, month: "2026-11" }, ["read"], rpc);
  assertEquals(result.isError, false);
  assertEquals(result.structuredContent.ok ? result.structuredContent.data : null, { project_id: PROJECT, month: "2026-11", edits: [EDIT] });
  assertEquals(calls, [{ name: "project_forecast_edits_for", body: { p_project_id: PROJECT, p_month: "2026-11" } }]);
  const bad = await callTool("get_project_forecast_edits", { project_id: "juniper", month: "2026-11" }, ["read"], rpc);
  assertEquals(bad.isError, true);
  assertEquals(calls.length, 1);
});

Deno.test("set_project_forecast_edit forwards a change or an added line, and refuses both or neither", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { undo_kind: "project_forecast" } } }));
  const change = await callTool("set_project_forecast_edit", { idempotency_key: "pf-1", project_id: PROJECT, month: "2026-11", row_key: "avg:repairs", amount_minor: 120000 }, ["write"], rpc);
  await callTool("set_project_forecast_edit", { idempotency_key: "pf-2", project_id: PROJECT, month: "2026-11", category_id: CATEGORY, amount_minor: 30500, pace: "month" }, ["write"], rpc);
  const both = await callTool("set_project_forecast_edit", { idempotency_key: "pf-3", project_id: PROJECT, month: "2026-11", row_key: "avg:repairs", category_id: CATEGORY, amount_minor: 1 }, ["write"], rpc);
  const neither = await callTool("set_project_forecast_edit", { idempotency_key: "pf-4", project_id: PROJECT, month: "2026-11", amount_minor: 1 }, ["write"], rpc);
  const pace = await callTool("set_project_forecast_edit", { idempotency_key: "pf-5", project_id: PROJECT, month: "2026-11", row_key: "avg:repairs", amount_minor: 1, pace: "weekly" }, ["write"], rpc);
  const negative = await callTool("set_project_forecast_edit", { idempotency_key: "pf-6", project_id: PROJECT, month: "2026-11", row_key: "avg:repairs", amount_minor: -1 }, ["write"], rpc);
  assertEquals(change.isError, false);
  assertEquals([both.isError, neither.isError, pace.isError, negative.isError], [true, true, true, true]);
  assertEquals(calls.map((call) => call.name), ["mcp_set_project_forecast_edit", "mcp_set_project_forecast_edit"]);
  assertEquals(calls[0]?.body, { p_idempotency_key: "pf-1", p_project_id: PROJECT, p_month: "2026-11", p_edit: { row_key: "avg:repairs", amount_minor: 120000 } });
  assertEquals(calls[1]?.body.p_edit, { category_id: CATEGORY, amount_minor: 30500, pace: "month" });
});

Deno.test("remove, restore and reset forward to their functions; a read token cannot write", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { undo_kind: "project_forecast" } } }));
  await callTool("remove_project_forecast_row", { idempotency_key: "pf-r", project_id: PROJECT, month: "2026-11", row_key: "avg:power" }, ["write"], rpc);
  await callTool("restore_project_forecast_row", { idempotency_key: "pf-s", project_id: PROJECT, month: "2026-11", row_key: "avg:power" }, ["write"], rpc);
  await callTool("reset_project_forecast", { idempotency_key: "pf-t", project_id: PROJECT }, ["write"], rpc);
  await callTool("reset_project_forecast", { idempotency_key: "pf-u", project_id: PROJECT, month: "2026-11" }, ["write"], rpc);
  assertEquals(calls.map((call) => [call.name, call.body]), [
    ["mcp_remove_project_forecast_row", { p_idempotency_key: "pf-r", p_project_id: PROJECT, p_month: "2026-11", p_row_key: "avg:power" }],
    ["mcp_restore_project_forecast_row", { p_idempotency_key: "pf-s", p_project_id: PROJECT, p_month: "2026-11", p_row_key: "avg:power" }],
    ["mcp_reset_project_forecast", { p_idempotency_key: "pf-t", p_project_id: PROJECT, p_month: null }],
    ["mcp_reset_project_forecast", { p_idempotency_key: "pf-u", p_project_id: PROJECT, p_month: "2026-11" }],
  ]);
  const denied = await callTool("remove_project_forecast_row", { idempotency_key: "pf-v", project_id: PROJECT, month: "2026-11", row_key: "avg:power" }, ["read"], rpc);
  assertEquals(denied.isError, true);
  assertEquals(calls.length, 4);
});

Deno.test("undo takes the project_forecast kind to mcp_undo", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { kind: "project_forecast" } } }));
  const id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  await callTool("undo", { idempotency_key: "pf-undo", kind: "project_forecast", id }, ["write"], rpc);
  assertEquals(calls, [{ name: "mcp_undo", body: { p_idempotency_key: "pf-undo", p_kind: "project_forecast", p_id: id } }]);
});
