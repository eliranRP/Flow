// Flow MCP tools tests: the monthly cash view (FLOW-413, decision 0168), its switches and the basis (FLOW-103).
import { assertEquals } from "jsr:@std/assert@1";
import { callTool } from "./tools.ts";
import { CATEGORY, PROJECT, rpcOf, TXN } from "./tools_test_support.ts";

const COMPANY = "c0ffee00-2222-4000-8000-000000000001";

Deno.test("get_cash_months asks for 6 months by default and passes the report through", async () => {
  const report = {
    basis: "paid",
    base_currency: "ILS",
    months: [{ month: "2026-09-01", by_currency: [{ currency: "ILS", in_minor: 500, out_minor: 200, net_minor: 300 }] }],
  };
  const { calls, rpc } = rpcOf((name) => name === "cash_months" ? { status: 200, json: report } : { status: 500, json: null });
  const result = await callTool("get_cash_months", {}, ["read"], rpc);
  assertEquals(result.isError, false);
  if (result.structuredContent.ok) assertEquals(result.structuredContent.data, report);
  await callTool("get_cash_months", { months: 24 }, ["read"], rpc);
  assertEquals(calls.map((call) => call.body), [{ p_months: 6 }, { p_months: 24 }]);
});

Deno.test("get_cash_months refuses a bad count before any read, and a failed read", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: null }));
  for (const args of [{ months: 0 }, { months: 25 }, { months: 1.5 }, { months: "6" }, { company_id: COMPANY }]) {
    const result = await callTool("get_cash_months", args, ["read"], rpc);
    assertEquals(result.isError, true);
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
  }
  assertEquals(calls.length, 0);
  // No company behind the token: the RPC returns null.
  const empty = await callTool("get_cash_months", {}, ["read"], rpc);
  assertEquals(empty.isError, true);
  if (!empty.structuredContent.ok) assertEquals(empty.structuredContent.error.code, "refused");
  const denied = await callTool("get_cash_months", {}, ["write"], rpc);
  assertEquals(denied.isError, true);
  if (!denied.structuredContent.ok) assertEquals(denied.structuredContent.error.code, "forbidden");
});

Deno.test("get_cash_months with year reads that year's months (FLOW-417)", async () => {
  const report = { basis: "paid", base_currency: "ILS", months: [{ month: "2025-12-01", by_currency: [] }] };
  const { calls, rpc } = rpcOf((name) => name === "cash_year_months" ? { status: 200, json: report } : { status: 500, json: null });
  const result = await callTool("get_cash_months", { year: 2025 }, ["read"], rpc);
  assertEquals(result.isError, false);
  if (result.structuredContent.ok) assertEquals(result.structuredContent.data, report);
  assertEquals(calls.map((call) => [call.name, call.body]), [["cash_year_months", { p_year: 2025 }]]);
  for (const args of [{ year: 2025, months: 3 }, { year: "2025" }, { year: 1800 }, { year: 2025.5 }]) {
    const bad = await callTool("get_cash_months", args, ["read"], rpc);
    assertEquals(bad.isError, true);
    if (!bad.structuredContent.ok) assertEquals(bad.structuredContent.error.code, "validation");
  }
  assertEquals(calls.length, 1);
});

Deno.test("get_cash_years passes the history through, and refuses a read with no company", async () => {
  const report = {
    basis: "paid",
    base_currency: "ILS",
    this_month: "2026-10-01",
    first_month: "2025-03-01",
    by_currency: [{ currency: "ILS", in_minor: 900, out_minor: 400, net_minor: 500 }],
    years: [{ year: 2026, by_currency: [] }, { year: 2025, by_currency: [] }],
  };
  const { calls, rpc } = rpcOf((name) => name === "cash_years" ? { status: 200, json: report } : { status: 500, json: null });
  const result = await callTool("get_cash_years", {}, ["read"], rpc);
  assertEquals(result.isError, false);
  if (result.structuredContent.ok) assertEquals(result.structuredContent.data, report);
  assertEquals(calls.map((call) => [call.name, call.body]), [["cash_years", {}]]);
  const empty = await callTool("get_cash_years", {}, ["read"], rpcOf(() => ({ status: 200, json: null })).rpc);
  assertEquals(empty.isError, true);
  const extra = await callTool("get_cash_years", { year: 2025 }, ["read"], rpc);
  assertEquals(extra.isError, true);
});

Deno.test("get_cash_lines takes a month as YYYY-MM or a date, a side, a currency and a page", async () => {
  const page = { rows: [{ transaction_id: TXN, side: "out", amount_minor: 200 }], has_more: false };
  const { calls, rpc } = rpcOf((name) => name === "cash_month_lines" ? { status: 200, json: page } : { status: 500, json: null });
  const result = await callTool("get_cash_lines", { month: "2026-09", side: "out" }, ["read"], rpc);
  assertEquals(result.isError, false);
  if (result.structuredContent.ok) assertEquals(result.structuredContent.data, page);
  await callTool("get_cash_lines", { month: "2026-09-15", side: "excluded", currency: "USD", limit: 10, offset: 20 }, ["read"], rpc);
  await callTool("get_cash_lines", { month: "2026-09", side: "not_in_profit" }, ["read"], rpc);
  assertEquals(calls, [
    { name: "cash_month_lines", body: { p_month: "2026-09-01", p_side: "out", p_currency: null, p_limit: 40, p_offset: 0 } },
    { name: "cash_month_lines", body: { p_month: "2026-09-15", p_side: "excluded", p_currency: "USD", p_limit: 10, p_offset: 20 } },
    { name: "cash_month_lines", body: { p_month: "2026-09-01", p_side: "not_in_profit", p_currency: null, p_limit: 40, p_offset: 0 } },
  ]);
});

Deno.test("get_cash_lines refuses bad arguments before any read", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { rows: [], has_more: false } }));
  for (const args of [
    { side: "in" },
    { month: "2026-13", side: "in" },
    { month: "2026-02-30", side: "in" },
    { month: "09-2026", side: "in" },
    { month: "2026-09" },
    { month: "2026-09", side: "both" },
    { month: "2026-09", side: "in", currency: "usd" },
    { month: "2026-09", side: "in", limit: 0 },
    { month: "2026-09", side: "in", limit: 101 },
    { month: "2026-09", side: "in", offset: -1 },
    { month: "2026-09", side: "in", project_id: PROJECT },
  ]) {
    const result = await callTool("get_cash_lines", args, ["read"], rpc);
    assertEquals(result.isError, true);
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
  }
  assertEquals(calls.length, 0);
});

Deno.test("the cash switches and the basis call their writers, and undo takes their kinds", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { id: TXN, undo_kind: "line_cash" } } }));
  const writes: [string, Record<string, unknown>][] = [
    ["set_category_cash", { idempotency_key: "c-1", category_id: CATEGORY, in_cash: false }],
    ["set_line_cash", { idempotency_key: "l-1", transaction_id: TXN, in_cash: null }],
    ["set_lines_cash", { idempotency_key: "b-1", items: [{ transaction_id: TXN, in_cash: false }, { transaction_id: PROJECT, in_cash: null }] }],
    ["set_cash_basis", { idempotency_key: "s-1", basis: "invoice" }],
    ["undo", { idempotency_key: "u-1", kind: "category_cash", id: CATEGORY }],
    ["undo", { idempotency_key: "u-2", kind: "line_cash", id: TXN }],
    ["undo", { idempotency_key: "u-3", kind: "cash_basis", id: COMPANY }],
  ];
  for (const [name, args] of writes) {
    const result = await callTool(name, args, ["write"], rpc);
    assertEquals(result.isError, false, name);
  }
  assertEquals(calls, [
    { name: "mcp_set_category_cash", body: { p_idempotency_key: "c-1", p_category_id: CATEGORY, p_in_cash: false } },
    { name: "mcp_set_line_cash", body: { p_idempotency_key: "l-1", p_transaction_id: TXN, p_in_cash: null } },
    {
      name: "mcp_set_lines_cash",
      body: { p_idempotency_key: "b-1", p_items: [{ transaction_id: TXN, in_cash: false }, { transaction_id: PROJECT, in_cash: null }] },
    },
    { name: "mcp_set_cash_basis", body: { p_idempotency_key: "s-1", p_basis: "invoice" } },
    { name: "mcp_undo", body: { p_idempotency_key: "u-1", p_kind: "category_cash", p_id: CATEGORY } },
    { name: "mcp_undo", body: { p_idempotency_key: "u-2", p_kind: "line_cash", p_id: TXN } },
    { name: "mcp_undo", body: { p_idempotency_key: "u-3", p_kind: "cash_basis", p_id: COMPANY } },
  ]);
});

Deno.test("the cash writes validate input and refuse read tokens", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: {} } }));
  const denied = await callTool("set_cash_basis", { idempotency_key: "k", basis: "paid" }, ["read"], rpc);
  assertEquals(denied.isError, true);
  if (!denied.structuredContent.ok) assertEquals(denied.structuredContent.error.code, "forbidden");
  const bad: [string, unknown][] = [
    ["set_category_cash", { idempotency_key: "k", category_id: CATEGORY }],
    ["set_category_cash", { idempotency_key: "k", category_id: CATEGORY, in_cash: null }],
    ["set_category_cash", { idempotency_key: "k", category_id: "not-a-uuid", in_cash: true }],
    ["set_line_cash", { idempotency_key: "k", transaction_id: TXN }],
    ["set_line_cash", { idempotency_key: "k", transaction_id: TXN, in_cash: "no" }],
    ["set_line_cash", { idempotency_key: "", transaction_id: TXN, in_cash: false }],
    ["set_line_cash", { idempotency_key: "k", transaction_id: TXN, in_cash: false, company_id: COMPANY }],
    ["set_lines_cash", { idempotency_key: "k", items: [] }],
    ["set_lines_cash", { idempotency_key: "k", items: [{ transaction_id: TXN, in_cash: false }, { transaction_id: TXN, in_cash: true }] }],
    ["set_lines_cash", { idempotency_key: "k", items: [{ transaction_id: TXN }] }],
    ["set_lines_cash", { idempotency_key: "k".repeat(125), items: [{ transaction_id: TXN, in_cash: false }] }],
    ["set_lines_cash", { idempotency_key: "k", items: Array.from({ length: 201 }, () => ({ transaction_id: TXN, in_cash: false })) }],
    ["set_cash_basis", { idempotency_key: "k", basis: "cash" }],
    ["set_cash_basis", { idempotency_key: "k" }],
    ["undo", { idempotency_key: "k", kind: "cash", id: TXN }],
  ];
  for (const [name, input] of bad) {
    const result = await callTool(name, input, ["write"], rpc);
    assertEquals(result.isError, true, name);
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation", name);
  }
  assertEquals(calls.length, 0);
});

Deno.test("the P&L reads default to the company's date choice and echo it (FLOW-103)", async () => {
  const handler = (name: string) => {
    if (name === "get_dashboard") return { status: 200, json: { basis: "cash", projects: [] } };
    if (name === "get_profit_months") return { status: 200, json: { months: [], by_currency: [] } };
    if (name === "get_breakdown") return { status: 200, json: { totals: [], groups: [], excluded: [] } };
    if (name === "mcp_company_loan_currency") return { status: 200, json: "ILS" };
    if (name === "get_breakdown_lines") return { status: 200, json: { rows: [], has_more: false } };
    if (name === "get_project_group") return { status: 200, json: { id: PROJECT, projects: [] } };
    return { status: 500, json: null };
  };
  const { calls, basisCalls, rpc } = rpcOf(handler, { basis: "cash" });
  const reads: [string, Record<string, unknown>][] = [
    ["get_totals", {}],
    ["list_projects", {}],
    ["get_profit_months", {}],
    ["get_project_group", { id: PROJECT }],
    ["get_breakdown", { direction: "expense" }],
    ["get_breakdown", { direction: "expense", group: "unassigned" }],
    ["get_breakdown", { direction: "income", basis: "invoiced" }],
  ];
  const bases: unknown[] = [];
  for (const [name, args] of reads) {
    const result = await callTool(name, args, ["read"], rpc);
    assertEquals(result.isError, false, name);
    if (result.structuredContent.ok) bases.push((result.structuredContent.data as { basis?: unknown }).basis);
  }
  assertEquals(bases, ["cash", "cash", "cash", "cash", "cash", "cash", "invoiced"]);
  assertEquals(
    calls.filter((call) => call.name !== "mcp_company_loan_currency").map((call) => call.body.p_basis),
    ["cash", "cash", "cash", "cash", "cash", "cash", "invoiced"],
  );
  assertEquals(basisCalls.length, 6, "the company's choice is read only when the client names no basis");

  // A failed read of the company's choice refuses the tool and reads nothing else.
  const refused = rpcOf(handler, { basis: null });
  const result = await callTool("get_totals", {}, ["read"], refused.rpc);
  assertEquals(result.isError, true);
  if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "refused");
  assertEquals(refused.calls.length, 0);
});
