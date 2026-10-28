// Flow MCP tools tests: the chart of accounts (FLOW-152): create_account, update_account, archive_account,
// restore_account, merge_account, get_balance_sheet and list_accounts' include_archived. Invented ids only.
import { assertEquals } from "jsr:@std/assert@1";
import { callTool, toolsFor } from "./tools.ts";
import { rpcOf } from "./tools_test_support.ts";

const A = "a0000000-0000-4000-8000-0000000000a1";
const B = "a0000000-0000-4000-8000-0000000000a2";
const PROJECT = "b0000000-0000-4000-8000-0000000000e1";

function codeOf(result: Awaited<ReturnType<typeof callTool>>): string | null {
  return result.structuredContent.ok ? null : result.structuredContent.error.code;
}

const OK = { status: 200, json: { ok: true, data: { id: A, undo_kind: "account_create" } } };

Deno.test("create_account forwards name, type and description, and refuses a bad call before the database", async () => {
  const { calls, rpc } = rpcOf(() => OK);
  const args = { idempotency_key: "acc-1", name: "Deposits paid", type: "asset", description: "Paid out" };
  assertEquals((await callTool("create_account", args, ["write"], rpc)).isError, false);
  assertEquals(calls.at(-1), {
    name: "mcp_create_account",
    body: { p_idempotency_key: "acc-1", p_name: "Deposits paid", p_type: "asset", p_description: "Paid out" },
  });
  await callTool("create_account", { idempotency_key: "acc-2", name: "Reserve", type: "equity" }, ["write"], rpc);
  assertEquals(calls.at(-1)?.body.p_description, null);
  const before = calls.length;
  for (const bad of [{ type: "income" }, { name: "" }, { name: "x".repeat(61) }, { description: "d".repeat(201) }, { extra: 1 }]) {
    assertEquals(codeOf(await callTool("create_account", { ...args, idempotency_key: "acc-bad", ...bad }, ["write"], rpc)), "validation", JSON.stringify(bad));
  }
  assertEquals(calls.length, before);
  assertEquals(codeOf(await callTool("create_account", args, ["read"], rpc)), "forbidden");
  const refused = rpcOf(() => ({ status: 200, json: { ok: false, error: { code: "refused", message: "that name belongs to a system account" } } }));
  assertEquals((await callTool("create_account", args, ["write"], refused.rpc)).structuredContent, {
    ok: false,
    error: { code: "refused", message: "that name belongs to a system account" },
  });
});

Deno.test("update_account needs one change; an empty description is sent to clear it", async () => {
  const { calls, rpc } = rpcOf(() => OK);
  await callTool("update_account", { idempotency_key: "upd-1", account_id: A, description: "" }, ["write"], rpc);
  assertEquals(calls.at(-1), {
    name: "mcp_update_account",
    body: { p_idempotency_key: "upd-1", p_account_id: A, p_name: null, p_description: "", p_type: null },
  });
  await callTool("update_account", { idempotency_key: "upd-2", account_id: A, name: "New", type: "liability" }, ["write"], rpc);
  assertEquals(calls.at(-1)?.body, { p_idempotency_key: "upd-2", p_account_id: A, p_name: "New", p_description: null, p_type: "liability" });
  const before = calls.length;
  for (const bad of [{}, { account_id: "nope", name: "x" }, { name: "x", type: "income" }]) {
    assertEquals(codeOf(await callTool("update_account", { idempotency_key: "upd-bad", account_id: A, ...bad }, ["write"], rpc)), "validation", JSON.stringify(bad));
  }
  assertEquals(calls.length, before);
});

Deno.test("archive_account and restore_account forward the account; merge_account forwards both ends", async () => {
  const { calls, rpc } = rpcOf(() => OK);
  await callTool("archive_account", { idempotency_key: "arc-1", account_id: A }, ["write"], rpc);
  assertEquals(calls.at(-1), { name: "mcp_archive_account", body: { p_idempotency_key: "arc-1", p_account_id: A } });
  await callTool("restore_account", { idempotency_key: "res-1", account_id: A }, ["write"], rpc);
  assertEquals(calls.at(-1), { name: "mcp_restore_account", body: { p_idempotency_key: "res-1", p_account_id: A } });
  await callTool("merge_account", { idempotency_key: "mrg-1", from_account_id: A, into_account_id: B }, ["write"], rpc);
  assertEquals(calls.at(-1), { name: "mcp_merge_account", body: { p_idempotency_key: "mrg-1", p_from_account_id: A, p_into_account_id: B } });
  await callTool("undo", { idempotency_key: "und-1", kind: "account_merge", id: A }, ["write"], rpc);
  assertEquals(calls.at(-1), { name: "mcp_undo", body: { p_idempotency_key: "und-1", p_kind: "account_merge", p_id: A } });
  const before = calls.length;
  assertEquals(codeOf(await callTool("merge_account", { idempotency_key: "mrg-2", from_account_id: A }, ["write"], rpc)), "validation");
  assertEquals(codeOf(await callTool("archive_account", { idempotency_key: "arc-2", account_id: "nope" }, ["write"], rpc)), "validation");
  assertEquals(codeOf(await callTool("restore_account", { idempotency_key: "res-2", account_id: A }, ["read"], rpc)), "forbidden");
  assertEquals(calls.length, before);
  const names = toolsFor(["write"]).map((tool) => tool.name);
  for (const name of ["create_account", "update_account", "archive_account", "restore_account", "merge_account"]) {
    assertEquals(names.includes(name), true, name);
  }
  assertEquals(toolsFor(["read"]).some((tool) => tool.name === "create_account"), false);
});

Deno.test("list_accounts takes include_archived as a boolean; get_balance_sheet takes as_of and project_id", async () => {
  const { calls, rpc } = rpcOf((name) =>
    name === "mcp_accounts" ? { status: 200, json: { accounts: [] } } : { status: 200, json: { as_of: "2026-03-31", currencies: [] } }
  );
  await callTool("list_accounts", { include_archived: true }, ["read"], rpc);
  assertEquals(calls.at(-1), { name: "mcp_accounts", body: { p_include_archived: true } });
  assertEquals(codeOf(await callTool("list_accounts", { include_archived: "yes" }, ["read"], rpc)), "validation");
  const sheet = await callTool("get_balance_sheet", { as_of: "2026-03-31", project_id: PROJECT }, ["read"], rpc);
  assertEquals(sheet.isError, false);
  assertEquals(calls.at(-1), { name: "mcp_balance_sheet", body: { p_as_of: "2026-03-31", p_project_id: PROJECT } });
  await callTool("get_balance_sheet", {}, ["read"], rpc);
  assertEquals(calls.at(-1)?.body, { p_as_of: null, p_project_id: null });
  for (const bad of [{ as_of: "2026-02-30" }, { as_of: 5 }, { project_id: "nope" }, { extra: 1 }]) {
    assertEquals(codeOf(await callTool("get_balance_sheet", bad, ["read"], rpc)), "validation", JSON.stringify(bad));
  }
  assertEquals(codeOf(await callTool("get_balance_sheet", {}, ["write"], rpc)), "forbidden");
  const failed = rpcOf(() => ({ status: 500, json: null }));
  assertEquals(codeOf(await callTool("get_balance_sheet", {}, ["read"], failed.rpc)), "refused");
  const shapeless = rpcOf(() => ({ status: 200, json: { currencies: null } }));
  assertEquals(codeOf(await callTool("get_balance_sheet", {}, ["read"], shapeless.rpc)), "refused");
});
