// Flow MCP tools tests: a project's next-month forecast edits. The read forwards project_forecast_edits_for;
// the four writes forward to their mcp_* functions, need a write token, and refuse a bad body before any call.
import { assertEquals } from "jsr:@std/assert@1";
import { forecastLastMonth, forecastMonths } from "../../../packages/shared/src/forecast-horizon.ts";
import { callTool } from "./tools.ts";
import { forecastReadMonth, israelMonthKey } from "./tools_reports.ts";
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

Deno.test("get_project_forecast_edits takes any month to the forecast's last, and refuses a later one before any read (FLOW-1066)", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: [] }));
  const last = forecastLastMonth(israelMonthKey());
  const after = forecastMonths(last)[0] ?? "";
  const ok = await callTool("get_project_forecast_edits", { project_id: PROJECT, month: last }, ["read"], rpc);
  assertEquals(ok.isError, false);
  assertEquals(calls, [{ name: "project_forecast_edits_for", body: { p_project_id: PROJECT, p_month: last } }]);
  const refused = await callTool("get_project_forecast_edits", { project_id: PROJECT, month: after }, ["read"], rpc);
  assertEquals(refused.isError, true);
  assertEquals(refused.structuredContent, { ok: false, error: { code: "validation", message: "validation" } });
  assertEquals(calls.length, 1);
});

Deno.test("forecastReadMonth: up to 12 months after this one in Israel time", () => {
  const now = new Date("2026-11-06T09:00:00Z");
  assertEquals(forecastReadMonth("2027-11", now), true);
  assertEquals(forecastReadMonth("2026-09", now), true);
  assertEquals(forecastReadMonth("2027-12", now), false);
  assertEquals(forecastReadMonth("2027-13", now), false);
  assertEquals(forecastReadMonth(202711, now), false);
  // 23:30 UTC on 31 December is already January in Israel: the last month is January a year on.
  assertEquals(forecastReadMonth("2027-01", new Date("2025-12-31T23:30:00Z")), true);
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

Deno.test("remove takes a pace, once or month, and refuses any other before a call (FLOW-1188)", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { undo_kind: "project_forecast" } } }));
  const remove = (key: string, pace: string) => callTool("remove_project_forecast_row", { idempotency_key: key, project_id: PROJECT, month: "2026-11", row_key: "add:00000000-0000-4000-8000-0000000000e1", pace }, ["write"], rpc);
  assertEquals((await remove("pf-p1", "once")).isError, false);
  assertEquals((await remove("pf-p2", "month")).isError, false);
  assertEquals((await remove("pf-p3", "year")).isError, true);
  assertEquals(calls.map((call) => call.body.p_pace), ["once", "month"]);
});

Deno.test("the four writes take a month up to the forecast's last and refuse a later one before any call (FLOW-1066)", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { undo_kind: "project_forecast" } } }));
  const last = forecastLastMonth(israelMonthKey());
  const after = forecastMonths(last)[0] ?? "";
  const set = (month: string) => callTool("set_project_forecast_edit", { idempotency_key: `pf-${month}`, project_id: PROJECT, month, row_key: "avg:repairs", amount_minor: 1 }, ["write"], rpc);
  assertEquals((await set(last)).isError, false);
  const refused = [
    await set(after),
    await callTool("remove_project_forecast_row", { idempotency_key: "pf-x1", project_id: PROJECT, month: after, row_key: "avg:power" }, ["write"], rpc),
    await callTool("restore_project_forecast_row", { idempotency_key: "pf-x2", project_id: PROJECT, month: after, row_key: "avg:power" }, ["write"], rpc),
    await callTool("reset_project_forecast", { idempotency_key: "pf-x3", project_id: PROJECT, month: after }, ["write"], rpc),
  ];
  assertEquals(refused.map((result) => result.isError), [true, true, true, true]);
  assertEquals(calls.map((call) => call.body.p_month), [last]);
});

Deno.test("undo takes the project_forecast kind to mcp_undo", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { kind: "project_forecast" } } }));
  const id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  await callTool("undo", { idempotency_key: "pf-undo", kind: "project_forecast", id }, ["write"], rpc);
  assertEquals(calls, [{ name: "mcp_undo", body: { p_idempotency_key: "pf-undo", p_kind: "project_forecast", p_id: id } }]);
});

Deno.test("get_company_next_month_inputs forwards company_next_month_inputs as is", async () => {
  const inputs = { today: "2026-10-30", month: "2026-11", overhead_project_id: null, projects: [{ project_id: PROJECT, categories: [] }], general: [], edits: [], rest_edits: [] };
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: inputs }));
  const result = await callTool("get_company_next_month_inputs", { today: "2026-10-30" }, ["read"], rpc);
  assertEquals(result.isError, false);
  assertEquals(result.structuredContent.ok ? result.structuredContent.data : null, inputs);
  await callTool("get_company_next_month_inputs", {}, ["read"], rpc);
  assertEquals(calls, [
    { name: "company_next_month_inputs", body: { p_today: "2026-10-30" } },
    { name: "company_next_month_inputs", body: { p_today: null } },
  ]);
  const bad = await callTool("get_company_next_month_inputs", { today: "30/10/2026" }, ["read"], rpc);
  const extra = await callTool("get_company_next_month_inputs", { project_id: PROJECT }, ["read"], rpc);
  assertEquals([bad.isError, extra.isError], [true, true]);
  assertEquals(calls.length, 2);
});

Deno.test("get_company_next_month_inputs: a refused read is refused", async () => {
  const { rpc } = rpcOf(() => ({ status: 403, json: { message: "denied" } }));
  const result = await callTool("get_company_next_month_inputs", {}, ["read"], rpc);
  assertEquals(result.isError, true);
});
