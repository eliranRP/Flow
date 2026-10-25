// Flow MCP tools tests: the weekly summary (FLOW-517). Invented figures only.
import { assertEquals } from "jsr:@std/assert@1";
import { callTool } from "./tools.ts";
import { rpcOf } from "./tools_test_support.ts";
import { lastWeekStart, weeklySummaryTool } from "./tools_weekly.ts";

const SUMMARY = {
  week_start: "2026-10-04",
  currency: "USD",
  lines: 23,
  auto_approved: 16,
  week_waiting: 7,
  waiting: 7,
  in_minor: 1_432_000,
  out_minor: 2_190_500,
  profit_minor: -121_000,
  kept_out_minor: -637_500,
  prev_profit_minor: -205_000,
  alert: { project_id: "c0ffee00-3333-4000-8000-000000000001", name: "Example Ridge", spent_minor: 5_824_000, budget_minor: 5_200_000 },
  more_over_budget: 0,
};

Deno.test("get_weekly_summary reads the week asked for and passes the summary through", async () => {
  const { calls, rpc } = rpcOf((name) => name === "weekly_summary" ? { status: 200, json: SUMMARY } : { status: 500, json: null });
  const result = await callTool("get_weekly_summary", { week_start: "2026-10-04" }, ["read"], rpc);
  assertEquals(result.isError, false);
  if (result.structuredContent.ok) assertEquals(result.structuredContent.data, SUMMARY);
  assertEquals(calls.map((call) => [call.name, call.body]), [["weekly_summary", { p_week_start: "2026-10-04" }]]);
});

Deno.test("get_weekly_summary defaults to the week that just ended, by Israel time", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: SUMMARY }));
  await weeklySummaryTool({}, rpc, new Date("2026-10-11T05:00:00Z"));
  assertEquals(calls.map((call) => call.body), [{ p_week_start: "2026-10-04" }]);
  assertEquals(lastWeekStart(new Date("2026-10-10T20:30:00Z")), "2026-09-27");
  assertEquals(lastWeekStart(new Date("2026-10-10T21:10:00Z")), "2026-10-04");
});

Deno.test("get_weekly_summary refuses a bad week before any read, and a refused read", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: null }));
  for (const args of [{ week_start: "2026-10-05" }, { week_start: "soon" }, { week_start: 20261004 }, { week: "2026-10-04" }]) {
    const result = await callTool("get_weekly_summary", args, ["read"], rpc);
    assertEquals(result.isError, true);
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
  }
  assertEquals(calls.length, 0);
  // No company behind the token: the RPC returns null.
  const empty = await callTool("get_weekly_summary", { week_start: "2026-10-04" }, ["read"], rpc);
  if (!empty.structuredContent.ok) assertEquals(empty.structuredContent.error.code, "refused");
  // The database refuses a future week.
  const future = rpcOf(() => ({ status: 400, json: { message: "validation" } }));
  const later = await callTool("get_weekly_summary", { week_start: "2099-01-04" }, ["read"], future.rpc);
  if (!later.structuredContent.ok) assertEquals(later.structuredContent.error.code, "validation");
  const denied = await callTool("get_weekly_summary", {}, ["write"], rpc);
  assertEquals(denied.isError, true);
  if (!denied.structuredContent.ok) assertEquals(denied.structuredContent.error.code, "forbidden");
});
