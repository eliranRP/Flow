// Flow MCP tools tests: match_lines, the bulk reconcile read (FLOW-213).
import { assertEquals } from "jsr:@std/assert@1";
import { callTool } from "./tools.ts";
import { rpcOf, TXN } from "./tools_test_support.ts";

const ROW = { date: "2026-09-05", amount_minor: -12000, ref: "INV-1" };

Deno.test("match_lines sends the rows with a 5-day window by default and passes the report through", async () => {
  const report = {
    currency: "ILS",
    window_days: 5,
    rows: [{ index: 0, ...ROW, match: { transaction_id: TXN, day_diff: 0 }, candidate_count: 1, candidates: [] }],
    matched_count: 1,
    unmatched_rows: [],
    unclaimed_count: 0,
    unclaimed_lines: [],
  };
  const { calls, rpc } = rpcOf((name) => name === "match_lines" ? { status: 200, json: report } : { status: 500, json: null });
  const result = await callTool("match_lines", { rows: [ROW, { date: "2026-09-06", amount_minor: 500 }] }, ["read"], rpc);
  assertEquals(result.isError, false);
  if (result.structuredContent.ok) assertEquals(result.structuredContent.data, report);
  await callTool("match_lines", { rows: [ROW], window_days: 0, direction: "expense", currency: "USD" }, ["read"], rpc);
  assertEquals(calls.map((call) => call.body), [
    {
      p_rows: [ROW, { date: "2026-09-06", amount_minor: 500, ref: null }],
      p_window_days: 5,
      p_direction: null,
      p_currency: null,
    },
    { p_rows: [ROW], p_window_days: 0, p_direction: "expense", p_currency: "USD" },
  ]);
});

Deno.test("match_lines refuses bad arguments before any read", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: {} }));
  const many = Array.from({ length: 501 }, () => ({ date: "2026-09-01", amount_minor: 1 }));
  for (const args of [
    {},
    { rows: [] },
    { rows: many },
    { rows: "2026-09-01" },
    { rows: [null] },
    { rows: [["2026-09-01", 1]] },
    { rows: [{ date: "2026-02-30", amount_minor: 1 }] },
    { rows: [{ date: "01/09/2026", amount_minor: 1 }] },
    { rows: [{ amount_minor: 1 }] },
    { rows: [{ date: "2026-09-01", amount_minor: 0 }] },
    { rows: [{ date: "2026-09-01", amount_minor: 1.5 }] },
    { rows: [{ date: "2026-09-01", amount_minor: "100" }] },
    { rows: [{ date: "2026-09-01", amount_minor: 1e15 }] },
    { rows: [{ date: "2026-09-01", amount_minor: 1, note: "x" }] },
    { rows: [{ date: "2026-09-01", amount_minor: 1, ref: 7 }] },
    { rows: [{ date: "2026-09-01", amount_minor: 1, ref: "x".repeat(201) }] },
    { rows: [ROW], window_days: 32 },
    { rows: [ROW], window_days: -1 },
    { rows: [ROW], window_days: 2.5 },
    { rows: [ROW], direction: "both" },
    { rows: [ROW], currency: "usd" },
    { rows: [ROW], company_id: TXN },
  ]) {
    const result = await callTool("match_lines", args, ["read"], rpc);
    assertEquals(result.isError, true, JSON.stringify(args).slice(0, 80));
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
  }
  assertEquals(calls.length, 0);
});

Deno.test("match_lines needs read scope, and a refused read is refused", async () => {
  const { rpc } = rpcOf(() => ({ status: 200, json: null }));
  const empty = await callTool("match_lines", { rows: [ROW] }, ["read"], rpc);
  assertEquals(empty.isError, true);
  if (!empty.structuredContent.ok) assertEquals(empty.structuredContent.error.code, "refused");
  const denied = await callTool("match_lines", { rows: [ROW] }, ["write"], rpc);
  assertEquals(denied.isError, true);
  if (!denied.structuredContent.ok) assertEquals(denied.structuredContent.error.code, "forbidden");
});
