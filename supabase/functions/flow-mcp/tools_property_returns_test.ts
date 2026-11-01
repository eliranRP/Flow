// FLOW-450: get_property_returns, get_property_return_lines, set_tax_bracket, and units and land on
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

Deno.test("get_property_return_lines forwards the line, the category and the page", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { line: "opex", rows: [], count: 0, total_minor: 0, has_more: false } }));
  const read = await callTool("get_property_return_lines", { project_id: PROJECT, line: "opex", category_id: CATEGORY, limit: 20, offset: 40 }, ["read"], rpc);
  assertEquals(read.isError, false);
  assertEquals(calls.at(-1), {
    name: "get_property_return_lines",
    body: { p_project_id: PROJECT, p_line: "opex", p_category_id: CATEGORY, p_limit: 20, p_offset: 40 },
  });
  await callTool("get_property_return_lines", { project_id: PROJECT, line: "rehab" }, ["read"], rpc);
  assertEquals(calls.at(-1), {
    name: "get_property_return_lines",
    body: { p_project_id: PROJECT, p_line: "rehab", p_category_id: null, p_limit: 50, p_offset: 0 },
  });
  const before = calls.length;
  for (const input of [
    { project_id: PROJECT },
    { project_id: PROJECT, line: "profit" },
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
