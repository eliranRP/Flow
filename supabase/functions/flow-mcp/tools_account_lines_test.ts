// Flow MCP tools tests (FLOW-165, FLOW-171): get_account_lines, one balance-sheet account's movements, and
// get_breakdown's project_id, one project's lines of a category. Invented ids only.
import { assertEquals } from "jsr:@std/assert@1";
import { callTool } from "./tools.ts";
import { rpcOf } from "./tools_test_support.ts";

const ACCOUNT = "a0000000-0000-4000-8000-0000000000a1";
const PROJECT = "b0000000-0000-4000-8000-0000000000e1";
const CATEGORY = "c0000000-0000-4000-8000-0000000000c1";

function codeOf(result: Awaited<ReturnType<typeof callTool>>): string | null {
  return result.structuredContent.ok ? null : result.structuredContent.error.code;
}

const BODY = { account_id: ACCOUNT, name: "Loan principal", type: "liability", currencies: [], rows: [], has_more: false };

Deno.test("get_account_lines forwards the account, date, project, currency and page", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: BODY }));
  const result = await callTool("get_account_lines", {
    account_id: ACCOUNT,
    as_of: "2026-10-15",
    project_id: PROJECT,
    currency: "USD",
    limit: 20,
    offset: 40,
  }, ["read"], rpc);
  assertEquals(result.structuredContent, { ok: true, data: BODY });
  assertEquals(calls.at(-1), {
    name: "get_account_lines",
    body: {
      p_account_id: ACCOUNT, p_as_of: "2026-10-15", p_project_id: PROJECT, p_currency: "USD", p_limit: 20, p_offset: 40,
      p_from: null, p_from_start: false,
    },
  });
  await callTool("get_account_lines", { account_id: ACCOUNT }, ["read"], rpc);
  assertEquals(calls.at(-1)?.body, {
    p_account_id: ACCOUNT, p_as_of: null, p_project_id: null, p_currency: null, p_limit: 50, p_offset: 0, p_from: null, p_from_start: false,
  });
});

Deno.test("get_account_lines forwards from, and from_start for the whole history", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: BODY }));
  await callTool("get_account_lines", { account_id: ACCOUNT, as_of: "2026-10-15", from: "2025-06-01" }, ["read"], rpc);
  assertEquals(calls.at(-1)?.body.p_from, "2025-06-01");
  assertEquals(calls.at(-1)?.body.p_from_start, false);
  await callTool("get_account_lines", { account_id: ACCOUNT, as_of: "2026-10-15", from: "2026-10-15" }, ["read"], rpc);
  assertEquals(calls.at(-1)?.body.p_from, "2026-10-15", "a start on as_of itself is allowed");
  await callTool("get_account_lines", { account_id: ACCOUNT, from_start: true }, ["read"], rpc);
  assertEquals(calls.at(-1)?.body.p_from, null);
  assertEquals(calls.at(-1)?.body.p_from_start, true);
  await callTool("get_account_lines", { account_id: ACCOUNT, from: null, from_start: false }, ["read"], rpc);
  assertEquals(calls.at(-1)?.body.p_from_start, false);
  const ok = await callTool("get_account_lines", { account_id: ACCOUNT, from_start: null }, ["read"], rpc);
  assertEquals(codeOf(ok), null, "from_start null reads as false");
  assertEquals(calls.at(-1)?.body.p_from_start, false);
});

Deno.test("get_account_lines refuses a bad from before the database, and a from after today from it", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: BODY }));
  for (const bad of [
    { account_id: ACCOUNT, from: "2026-02-30" },
    { account_id: ACCOUNT, from: "1/1/2026" },
    { account_id: ACCOUNT, from: 20260101 },
    { account_id: ACCOUNT, from_start: "yes" },
    { account_id: ACCOUNT, from: "2026-01-01", from_start: true },
    { account_id: ACCOUNT, as_of: "2025-12-31", from: "2026-01-01" },
  ]) {
    assertEquals(codeOf(await callTool("get_account_lines", bad, ["read"], rpc)), "validation", JSON.stringify(bad));
  }
  assertEquals(calls.length, 0);
  const later = rpcOf(() => ({ status: 400, json: { code: "P0001", message: "validation" } }));
  const result = await callTool("get_account_lines", { account_id: ACCOUNT, from: "2099-01-01" }, ["read"], later.rpc);
  assertEquals(codeOf(result), "validation");
  assertEquals(result.structuredContent.ok ? null : result.structuredContent.error.message, "from: on or before as_of");
  // Another validation from the database, with no from: a generic message, not the from one.
  const generic = await callTool("get_account_lines", { account_id: ACCOUNT }, ["read"], later.rpc);
  assertEquals(generic.structuredContent.ok ? null : generic.structuredContent.error.message, "validation");
  const other = rpcOf(() => ({ status: 200, json: null }));
  assertEquals(codeOf(await callTool("get_account_lines", { account_id: ACCOUNT, from_start: true }, ["read"], other.rpc)), "not_found");
});

Deno.test("get_account_lines refuses a bad argument before the database", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: BODY }));
  for (const bad of [
    {},
    { account_id: "nope" },
    { account_id: ACCOUNT, as_of: "2026-02-30" },
    { account_id: ACCOUNT, project_id: "x" },
    { account_id: ACCOUNT, currency: "usd" },
    { account_id: ACCOUNT, limit: 0 },
    { account_id: ACCOUNT, limit: 101 },
    { account_id: ACCOUNT, offset: -1 },
    { account_id: ACCOUNT, extra: 1 },
  ]) {
    assertEquals(codeOf(await callTool("get_account_lines", bad, ["read"], rpc)), "validation", JSON.stringify(bad));
  }
  assertEquals(calls.length, 0);
  assertEquals(codeOf(await callTool("get_account_lines", { account_id: ACCOUNT }, ["write"], rpc)), "forbidden");
});

Deno.test("get_account_lines: null is not_found; a failed or shapeless read is refused", async () => {
  const unknown = rpcOf(() => ({ status: 200, json: null }));
  assertEquals(codeOf(await callTool("get_account_lines", { account_id: ACCOUNT }, ["read"], unknown.rpc)), "not_found");
  const failed = rpcOf(() => ({ status: 500, json: null }));
  assertEquals(codeOf(await callTool("get_account_lines", { account_id: ACCOUNT }, ["read"], failed.rpc)), "refused");
  const shapeless = rpcOf(() => ({ status: 200, json: { currencies: [] } }));
  assertEquals(codeOf(await callTool("get_account_lines", { account_id: ACCOUNT }, ["read"], shapeless.rpc)), "refused");
});

Deno.test("get_breakdown takes project_id with a group by category; another company's project is not_found", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { rows: [], has_more: false } }));
  const args = { direction: "expense", group: CATEGORY, currency: "ILS", basis: "cash", project_id: PROJECT };
  assertEquals((await callTool("get_breakdown", args, ["read"], rpc)).isError, false);
  assertEquals(calls.at(-1)?.name, "get_breakdown_lines");
  assertEquals(calls.at(-1)?.body.p_project_id, PROJECT);
  assertEquals(calls.at(-1)?.body.p_group_key, CATEGORY);
  await callTool("get_breakdown", { ...args, project_id: undefined }, ["read"], rpc);
  assertEquals("p_project_id" in (calls.at(-1)?.body ?? {}), false, "no project, no p_project_id");
  const before = calls.length;
  for (const bad of [
    { ...args, project_id: "nope" },
    { ...args, group_by: "payer" },
    { direction: "expense", basis: "cash", project_id: PROJECT },
  ]) {
    assertEquals(codeOf(await callTool("get_breakdown", bad, ["read"], rpc)), "validation", JSON.stringify(bad));
  }
  assertEquals(calls.length, before);
  const other = rpcOf(() => ({ status: 200, json: null }));
  assertEquals(codeOf(await callTool("get_breakdown", args, ["read"], other.rpc)), "not_found");
  assertEquals(codeOf(await callTool("get_breakdown", { ...args, project_id: undefined }, ["read"], other.rpc)), "refused");
});
