// Flow MCP tools tests: the Mercury connections (FLOW-938, decision 0203): list_bank_connections,
// set_bank_accounts and answer_bank_account.
import { assertEquals } from "jsr:@std/assert@1";
import { callTool, toolsFor } from "./tools.ts";
import { rpcOf } from "./tools_test_support.ts";

const CONNECTION = "c0ffee00-9380-4000-8000-000000000001";

const LISTED = {
  connections: [{
    id: CONNECTION,
    slot: 1,
    provider: "mercury",
    org_label: "Example Pier LLC",
    connected: true,
    accounts_chosen: true,
    import_from: "2026-01-01",
    last_sync_at: "2026-10-21T03:05:00Z",
    last_error: null,
    syncing: false,
    accounts: [
      { id: "acct-chk", name: "Checking", last4: "4821", kind: "checking", balance_minor: 125000, synced: true, skipped: false, new: false, import_from: "2026-01-01" },
      { id: "acct-tre", name: "Treasury", last4: null, kind: "treasury", balance_minor: null, synced: false, skipped: true, new: false, import_from: null },
      { id: "acct-new", name: "Checking", last4: "6610", kind: "checking", balance_minor: null, synced: false, skipped: false, new: true, import_from: null },
    ],
    new_account_ids: ["acct-new"],
  }],
};

const SAVED = {
  ok: true,
  data: {
    id: CONNECTION,
    slot: 1,
    account_ids: ["acct-chk", "acct-tre"],
    skipped_account_ids: ["acct-new"],
    added: 1,
    import_from: "2026-01-01",
    reread: true,
    undo_kind: "bank_accounts",
  },
};

function codeOf(result: Awaited<ReturnType<typeof callTool>>): string | null {
  return result.structuredContent.ok ? null : result.structuredContent.error.code;
}

Deno.test("list_bank_connections passes each connection with its accounts through", async () => {
  const { calls, rpc } = rpcOf((name) => name === "mcp_bank_connections" ? { status: 200, json: LISTED } : { status: 500, json: null });
  const result = await callTool("list_bank_connections", {}, ["read"], rpc);
  assertEquals(result.isError, false);
  if (result.structuredContent.ok) assertEquals(result.structuredContent.data, LISTED);
  assertEquals(calls, [{ name: "mcp_bank_connections", body: {} }]);
});

Deno.test("list_bank_connections takes no arguments, needs read scope, and refuses a bad read", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { connections: "nope" } }));
  assertEquals(codeOf(await callTool("list_bank_connections", { slot: 1 }, ["read"], rpc)), "validation");
  assertEquals(codeOf(await callTool("list_bank_connections", {}, ["write"], rpc)), "forbidden");
  assertEquals(calls.length, 0);
  assertEquals(codeOf(await callTool("list_bank_connections", {}, ["read"], rpc)), "refused");
  const failed = rpcOf(() => ({ status: 403, json: null }));
  assertEquals(codeOf(await callTool("list_bank_connections", {}, ["read"], failed.rpc)), "refused");
});

Deno.test("set_bank_accounts saves through mcp_set_bank_accounts and returns the undo", async () => {
  const { calls, rpc } = rpcOf((name) => name === "mcp_set_bank_accounts" ? { status: 200, json: SAVED } : { status: 500, json: null });
  const result = await callTool("set_bank_accounts", {
    idempotency_key: "bank-1",
    slot: 1,
    account_ids: ["acct-chk", "acct-tre"],
    from: "2026-04-01",
  }, ["write"], rpc);
  assertEquals(result.isError, false);
  if (result.structuredContent.ok) assertEquals(result.structuredContent.data, SAVED.data);
  await callTool("set_bank_accounts", { idempotency_key: "bank-2", slot: 2, account_ids: ["acct-ops"], from: "start" }, ["write"], rpc);
  await callTool("set_bank_accounts", { idempotency_key: "bank-3", slot: 1, account_ids: ["acct-chk"] }, ["write"], rpc);
  assertEquals(calls.map((call) => call.body), [
    { p_idempotency_key: "bank-1", p_slot: 1, p_account_ids: ["acct-chk", "acct-tre"], p_from: "2026-04-01" },
    { p_idempotency_key: "bank-2", p_slot: 2, p_account_ids: ["acct-ops"], p_from: "start" },
    { p_idempotency_key: "bank-3", p_slot: 1, p_account_ids: ["acct-chk"], p_from: null },
  ]);
});

Deno.test("set_bank_accounts refuses a read-only key before any write", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: SAVED }));
  const result = await callTool("set_bank_accounts", { idempotency_key: "bank-r", slot: 1, account_ids: ["acct-chk"] }, ["read"], rpc);
  assertEquals(codeOf(result), "forbidden");
  assertEquals(codeOf(await callTool("answer_bank_account", { idempotency_key: "bank-r2", slot: 1, account_id: "acct-new", sync: true }, ["read"], rpc)), "forbidden");
  assertEquals(calls.length, 0);
  assertEquals(toolsFor(["read"]).map((tool) => tool.name).includes("set_bank_accounts"), false);
  assertEquals(toolsFor(["read"]).map((tool) => tool.name).includes("list_bank_connections"), true);
  assertEquals(toolsFor(["write"]).map((tool) => tool.name).includes("answer_bank_account"), true);
});

Deno.test("set_bank_accounts passes the owner check's refusal through", async () => {
  // An editor's or a viewer's key: the database answers forbidden (owner only).
  const { rpc } = rpcOf(() => ({ status: 200, json: { ok: false, error: { code: "forbidden", message: "owner only" } } }));
  const result = await callTool("set_bank_accounts", { idempotency_key: "bank-e", slot: 1, account_ids: ["acct-chk"] }, ["write"], rpc);
  assertEquals(result.isError, true);
  if (!result.structuredContent.ok) assertEquals(result.structuredContent.error, { code: "forbidden", message: "owner only" });
  const answer = await callTool("answer_bank_account", { idempotency_key: "bank-e2", slot: 1, account_id: "acct-new", sync: false }, ["write"], rpc);
  assertEquals(codeOf(answer), "forbidden");
});

Deno.test("set_bank_accounts checks the slot and the account ids", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: SAVED }));
  const bad: Record<string, unknown>[] = [
    { idempotency_key: "b", slot: 1, account_ids: [] },
    { idempotency_key: "b", slot: 1, account_ids: [""] },
    { idempotency_key: "b", slot: 1, account_ids: ["x".repeat(129)] },
    { idempotency_key: "b", slot: 1, account_ids: Array.from({ length: 201 }, (_, i) => `acct-${String(i)}`) },
    { idempotency_key: "b", slot: 1, account_ids: "acct-chk" },
    { idempotency_key: "b", slot: 1, account_ids: [7] },
    { idempotency_key: "b", slot: 0, account_ids: ["acct-chk"] },
    { idempotency_key: "b", slot: 10, account_ids: ["acct-chk"] },
    { idempotency_key: "b", slot: 1.5, account_ids: ["acct-chk"] },
    { idempotency_key: "b", slot: "1", account_ids: ["acct-chk"] },
    { idempotency_key: "", slot: 1, account_ids: ["acct-chk"] },
    { slot: 1, account_ids: ["acct-chk"] },
    { idempotency_key: "b", slot: 1, account_ids: ["acct-chk"], company_id: CONNECTION },
  ];
  for (const args of bad) assertEquals(codeOf(await callTool("set_bank_accounts", args, ["write"], rpc)), "validation", JSON.stringify(args));
  assertEquals(calls.length, 0);
  // An id the connection does not list: the database refuses it.
  const listed = rpcOf(() => ({ status: 200, json: { ok: false, error: { code: "validation", message: "account is not on this connection" } } }));
  const result = await callTool("set_bank_accounts", { idempotency_key: "b", slot: 1, account_ids: ["acct-ops"] }, ["write"], listed.rpc);
  assertEquals(result.isError, true);
  if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.message, "account is not on this connection");
  const missing = rpcOf(() => ({ status: 200, json: { ok: false, error: { code: "not_found", message: "bank connection not found" } } }));
  assertEquals(codeOf(await callTool("set_bank_accounts", { idempotency_key: "b", slot: 5, account_ids: ["acct-chk"] }, ["write"], missing.rpc)), "not_found");
});

Deno.test("set_bank_accounts checks the start: start, a real day, or nothing", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: SAVED }));
  for (const from of ["2026-02-30", "2026-13-01", "26-01-01", "today", "beginning", "2026-01-01T00:00:00Z", 20260101]) {
    const result = await callTool("set_bank_accounts", { idempotency_key: "d", slot: 1, account_ids: ["acct-chk"], from }, ["write"], rpc);
    assertEquals(codeOf(result), "validation", String(from));
  }
  assertEquals(calls.length, 0);
  await callTool("set_bank_accounts", { idempotency_key: "d", slot: 1, account_ids: ["acct-chk"], from: null }, ["write"], rpc);
  assertEquals(calls[0]?.body.p_from, null);
  // A day after today is the database's refusal (it knows Israel's today).
  const later = rpcOf(() => ({ status: 200, json: { ok: false, error: { code: "validation", message: "import date is after today" } } }));
  const result = await callTool("set_bank_accounts", { idempotency_key: "d", slot: 1, account_ids: ["acct-chk"], from: "2999-01-01" }, ["write"], later.rpc);
  assertEquals(result.isError, true);
  if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.message, "import date is after today");
  assertEquals(later.calls[0]?.body.p_from, "2999-01-01");
});

Deno.test("answer_bank_account sends yes or no for one account", async () => {
  const { calls, rpc } = rpcOf((name) => name === "mcp_answer_bank_account" ? { status: 200, json: SAVED } : { status: 500, json: null });
  const yes = await callTool("answer_bank_account", { idempotency_key: "ans-1", slot: 1, account_id: "acct-new", sync: true }, ["write"], rpc);
  assertEquals(yes.isError, false);
  await callTool("answer_bank_account", { idempotency_key: "ans-2", slot: 1, account_id: "acct-new", sync: false }, ["write"], rpc);
  assertEquals(calls, [
    { name: "mcp_answer_bank_account", body: { p_idempotency_key: "ans-1", p_slot: 1, p_account_id: "acct-new", p_sync: true } },
    { name: "mcp_answer_bank_account", body: { p_idempotency_key: "ans-2", p_slot: 1, p_account_id: "acct-new", p_sync: false } },
  ]);
  for (const args of [
    { idempotency_key: "a", slot: 1, account_id: "acct-new" },
    { idempotency_key: "a", slot: 1, account_id: "", sync: true },
    { idempotency_key: "a", slot: 1, account_id: "acct-new", sync: "yes" },
    { idempotency_key: "a", slot: 1, account_ids: ["acct-new"], sync: true },
  ]) assertEquals(codeOf(await callTool("answer_bank_account", args, ["write"], rpc)), "validation", JSON.stringify(args));
  assertEquals(calls.length, 2);
  const failed = rpcOf(() => ({ status: 500, json: null }));
  assertEquals(codeOf(await callTool("answer_bank_account", { idempotency_key: "a", slot: 1, account_id: "acct-new", sync: true }, ["write"], failed.rpc)), "refused");
});

Deno.test("undo takes kind bank_accounts with the connection id", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { kind: "bank_accounts", id: CONNECTION } } }));
  const result = await callTool("undo", { idempotency_key: "undo-bank", kind: "bank_accounts", id: CONNECTION }, ["write"], rpc);
  assertEquals(result.isError, false);
  assertEquals(calls, [{ name: "mcp_undo", body: { p_idempotency_key: "undo-bank", p_kind: "bank_accounts", p_id: CONNECTION } }]);
});
