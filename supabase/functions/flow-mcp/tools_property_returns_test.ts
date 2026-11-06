// FLOW-450: get_property_returns, get_property_return_lines, set_tax_bracket, set_land_account (FLOW-461), and units and land on
// set_project_investment. Fixtures: tools_test_support.ts. Invented ids only.
import { assertEquals } from "jsr:@std/assert@1";
import { callTool } from "./tools.ts";
import { CATEGORY, PROJECT, rpcOf } from "./tools_test_support.ts";

Deno.test("get_property_returns forwards the project and the period, and a null is not_found", async () => {
  let answer: unknown = { currency: "USD", statement: { cash_flow_minor: 460000 }, missing: [] };
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: answer }));
  const read = await callTool("get_property_returns", { project_id: PROJECT }, ["read"], rpc);
  assertEquals(read.isError, false);
  assertEquals(calls.at(-1), { name: "get_property_returns", body: { p_project_id: PROJECT } });
  if (read.structuredContent.ok) assertEquals((read.structuredContent.data as { currency: string }).currency, "USD");

  await callTool("get_property_returns", { project_id: PROJECT, from: "2026-01-01", to: "2026-12-31" }, ["read"], rpc);
  assertEquals(calls.at(-1), {
    name: "get_property_returns",
    body: { p_project_id: PROJECT, p_from: "2026-01-01", p_to: "2026-12-31" },
  });

  answer = null;
  const missing = await callTool("get_property_returns", { project_id: PROJECT }, ["read"], rpc);
  assertEquals(missing.isError, true);
  if (!missing.structuredContent.ok) assertEquals(missing.structuredContent.error.code, "not_found");

  const before = calls.length;
  for (const input of [
    {},
    { project_id: "not-a-uuid" },
    { project_id: PROJECT, from: "2026-01-01" },
    { project_id: PROJECT, from: "2026-12-31", to: "2026-01-01" },
    { project_id: PROJECT, extra: 1 },
  ]) {
    const result = await callTool("get_property_returns", input, ["read"], rpc);
    assertEquals(result.isError, true, JSON.stringify(input));
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
  }
  assertEquals(calls.length, before);
});

Deno.test("get_property_returns flags per-year figures scaled from fewer than 60 days (FLOW-473)", async () => {
  let answer: Record<string, unknown> = { currency: "USD", annualized_from: "2026-10-12", earning_days: 59, metrics: { cap_rate_bp: 1104 } };
  const { rpc } = rpcOf(() => ({ status: 200, json: answer }));
  const read = async () => {
    const result = await callTool("get_property_returns", { project_id: PROJECT }, ["read"], rpc);
    return result.structuredContent.ok ? result.structuredContent.data as Record<string, unknown> : null;
  };
  const few = await read();
  assertEquals(few?.few_earning_days, true);
  // The figures are still given as the server sends them.
  assertEquals(few?.metrics, { cap_rate_bp: 1104 });
  answer = { ...answer, earning_days: 60 };
  assertEquals((await read())?.few_earning_days, false);
  // Over the whole period (no first rent inside it) the figures are not scaled.
  answer = { ...answer, annualized_from: null, earning_days: 21 };
  assertEquals((await read())?.few_earning_days, false);
});

Deno.test("get_property_return_lines forwards the line, the category and the page", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { line: "opex", rows: [], count: 0, total_minor: 0, has_more: false } }));
  const read = await callTool("get_property_return_lines", { project_id: PROJECT, line: "opex", category_id: CATEGORY, limit: 20, offset: 40 }, ["read"], rpc);
  assertEquals(read.isError, false);
  assertEquals(calls.at(-1), {
    name: "get_property_return_lines",
    body: { p_project_id: PROJECT, p_line: "opex", p_category_id: CATEGORY, p_limit: 20, p_offset: 40 },
  });
  for (const line of ["income", "opex", "debt_service", "capex", "principal", "before_rent", "not_counted", "acquisition", "renovation", "holding", "financing", "money_in", "deal_holding", "irr_out", "irr_in"]) {
    await callTool("get_property_return_lines", { project_id: PROJECT, line }, ["read"], rpc);
    assertEquals(calls.at(-1)?.body.p_line, line);
  }
  await callTool("get_property_return_lines", { project_id: PROJECT, line: "rehab" }, ["read"], rpc);
  assertEquals(calls.at(-1), {
    name: "get_property_return_lines",
    body: { p_project_id: PROJECT, p_line: "rehab", p_category_id: null, p_limit: 50, p_offset: 0 },
  });
  const before = calls.length;
  for (const input of [
    { project_id: PROJECT },
    { project_id: PROJECT, line: "profit" },
    { project_id: PROJECT, line: "refi" },
    { project_id: PROJECT, line: "opex", limit: 0 },
    { project_id: PROJECT, line: "opex", limit: 201 },
    { project_id: PROJECT, line: "opex", category_id: "x" },
  ]) {
    const result = await callTool("get_property_return_lines", input, ["read"], rpc);
    assertEquals(result.isError, true, JSON.stringify(input));
  }
  assertEquals(calls.length, before);
});

Deno.test("set_tax_bracket sends basis points, undo takes tax_bracket", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { undo_kind: "tax_bracket", tax_bracket_bp: 2450 } } }));
  const set = await callTool("set_tax_bracket", { idempotency_key: "tb-1", tax_bracket_percent: 24.5 }, ["write"], rpc);
  assertEquals(set.isError, false);
  assertEquals(calls.at(-1), { name: "mcp_set_tax_bracket", body: { p_idempotency_key: "tb-1", p_bp: 2450 } });
  await callTool("set_tax_bracket", { idempotency_key: "tb-2", tax_bracket_percent: null }, ["write"], rpc);
  assertEquals(calls.at(-1), { name: "mcp_set_tax_bracket", body: { p_idempotency_key: "tb-2", p_bp: null } });
  const undo = await callTool("undo", { idempotency_key: "u-tb", kind: "tax_bracket", id: CATEGORY }, ["write"], rpc);
  assertEquals(undo.isError, false);

  const denied = await callTool("set_tax_bracket", { idempotency_key: "k", tax_bracket_percent: 24 }, ["read"], rpc);
  assertEquals(denied.isError, true);
  const before = calls.length;
  for (const input of [
    { idempotency_key: "k" },
    { idempotency_key: "k", tax_bracket_percent: -1 },
    { idempotency_key: "k", tax_bracket_percent: 101 },
    { idempotency_key: "k", tax_bracket_percent: 24.555 },
  ]) {
    const result = await callTool("set_tax_bracket", input, ["write"], rpc);
    assertEquals(result.isError, true, JSON.stringify(input));
  }
  assertEquals(calls.length, before);
});

Deno.test("set_project_investment takes units and land", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { undo_kind: "project_investment" } } }));
  const set = await callTool("set_project_investment", { idempotency_key: "pi-1", project_id: PROJECT, units: 2, land_minor: 2000000 }, ["write"], rpc);
  assertEquals(set.isError, false);
  assertEquals(calls.at(-1), {
    name: "mcp_set_project_investment",
    body: { p_idempotency_key: "pi-1", p_project_id: PROJECT, p_patch: { units: 2, land_minor: 2000000 } },
  });
  const zero = await callTool("set_project_investment", { idempotency_key: "pi-2", project_id: PROJECT, units: 0 }, ["write"], rpc);
  assertEquals(zero.isError, true);
});

Deno.test("set_project_investment takes the selling cost in basis points, null for the default", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { undo_kind: "project_investment" } } }));
  const set = await callTool("set_project_investment", { idempotency_key: "sc-1", project_id: PROJECT, selling_cost_bp: 600 }, ["write"], rpc);
  assertEquals(set.isError, false);
  assertEquals(calls.at(-1), {
    name: "mcp_set_project_investment",
    body: { p_idempotency_key: "sc-1", p_project_id: PROJECT, p_patch: { selling_cost_bp: 600 } },
  });
  await callTool("set_project_investment", { idempotency_key: "sc-2", project_id: PROJECT, selling_cost_bp: null }, ["write"], rpc);
  assertEquals(calls.at(-1)?.body, { p_idempotency_key: "sc-2", p_project_id: PROJECT, p_patch: { selling_cost_bp: null } });
  const before = calls.length;
  for (const bad of [3001, -1, 5.5, "8%"]) {
    const result = await callTool("set_project_investment", { idempotency_key: "sc-3", project_id: PROJECT, selling_cost_bp: bad }, ["write"], rpc);
    assertEquals(result.isError, true, String(bad));
  }
  assertEquals(calls.length, before);
});

Deno.test("set_land_account sends the account, null unlinks, undo takes land_account", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { undo_kind: "land_account" } } }));
  const set = await callTool("set_land_account", { idempotency_key: "la-1", account_id: CATEGORY }, ["write"], rpc);
  assertEquals(set.isError, false);
  assertEquals(calls.at(-1), { name: "mcp_set_land_account", body: { p_idempotency_key: "la-1", p_account_id: CATEGORY } });
  await callTool("set_land_account", { idempotency_key: "la-2", account_id: null }, ["write"], rpc);
  assertEquals(calls.at(-1), { name: "mcp_set_land_account", body: { p_idempotency_key: "la-2", p_account_id: null } });
  await callTool("undo", { idempotency_key: "u-la", kind: "land_account", id: CATEGORY }, ["write"], rpc);
  assertEquals(calls.at(-1)?.name, "mcp_undo");

  const denied = await callTool("set_land_account", { idempotency_key: "k", account_id: CATEGORY }, ["read"], rpc);
  assertEquals(denied.isError, true);
  const before = calls.length;
  for (const input of [{ idempotency_key: "k" }, { idempotency_key: "k", account_id: "nope" }, { account_id: CATEGORY }]) {
    const result = await callTool("set_land_account", input, ["write"], rpc);
    assertEquals(result.isError, true);
  }
  assertEquals(calls.length, before);
});

Deno.test("set_loan_closing_paid sends minor units, null is the whole loan, undo takes loan_closing_paid", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { undo_kind: "loan_closing_paid" } } }));
  const set = await callTool("set_loan_closing_paid", { idempotency_key: "cp-1", loan_id: CATEGORY, closing_paid: 174075.5 }, ["write"], rpc);
  assertEquals(set.isError, false);
  assertEquals(calls.at(-1), {
    name: "mcp_set_loan_closing_paid",
    body: { p_idempotency_key: "cp-1", p_loan_id: CATEGORY, p_closing_paid_minor: 17407550 },
  });
  await callTool("set_loan_closing_paid", { idempotency_key: "cp-2", loan_id: CATEGORY, closing_paid: "1000.25" }, ["write"], rpc);
  assertEquals(calls.at(-1)?.body, { p_idempotency_key: "cp-2", p_loan_id: CATEGORY, p_closing_paid_minor: 100025 });
  await callTool("set_loan_closing_paid", { idempotency_key: "cp-3", loan_id: CATEGORY, closing_paid: null }, ["write"], rpc);
  assertEquals(calls.at(-1)?.body, { p_idempotency_key: "cp-3", p_loan_id: CATEGORY, p_closing_paid_minor: null });
  await callTool("undo", { idempotency_key: "u-cp", kind: "loan_closing_paid", id: CATEGORY }, ["write"], rpc);
  assertEquals(calls.at(-1)?.name, "mcp_undo");

  const before = calls.length;
  for (const input of [
    { idempotency_key: "k", loan_id: "nope", closing_paid: 1 },
    { idempotency_key: "k", loan_id: CATEGORY, closing_paid: -1 },
    { idempotency_key: "k", loan_id: CATEGORY, closing_paid: 1.005 },
    { idempotency_key: "k", loan_id: CATEGORY },
  ]) {
    const result = await callTool("set_loan_closing_paid", input, ["write"], rpc);
    assertEquals(result.isError, true);
  }
  const denied = await callTool("set_loan_closing_paid", { idempotency_key: "k", loan_id: CATEGORY, closing_paid: 1 }, ["read"], rpc);
  assertEquals(denied.isError, true);
  assertEquals(calls.length, before);
});
