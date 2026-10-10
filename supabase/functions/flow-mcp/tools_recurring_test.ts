// Flow MCP tools tests: recurring charges (FLOW-415, decision 0172). Invented ids only.
import { assertEquals } from "jsr:@std/assert@1";
import { callTool } from "./tools.ts";
import { rpcOf, TXN } from "./tools_test_support.ts";

Deno.test("get_recurring_changes passes this month's changes through", async () => {
  const changes = [{
    supplier_id: TXN,
    supplier_name: "Example Power",
    amount_minor: -255300,
    typical_amount_minor: -185000,
    change_percent: 38,
  }];
  const { calls, rpc } = rpcOf((name) =>
    name === "recurring_changes"
      ? { status: 200, json: changes }
      : { status: 500, json: null }
  );
  const result = await callTool("get_recurring_changes", {}, ["read"], rpc);
  assertEquals(result.structuredContent, { ok: true, data: { changes } });
  assertEquals(calls, [{ name: "recurring_changes", body: {} }]);
  const failed = await callTool(
    "get_recurring_changes",
    {},
    ["read"],
    () => Promise.resolve({ status: 400, json: null }),
  );
  assertEquals(failed.isError, true);
  if (!failed.structuredContent.ok) {
    assertEquals(failed.structuredContent.error.code, "refused");
  }
  const extra = await callTool("get_recurring_changes", { month: "2026-10" }, [
    "read",
  ], rpc);
  if (!extra.structuredContent.ok) {
    assertEquals(extra.structuredContent.error.code, "validation");
  }
  assertEquals(
    (await callTool("get_recurring_changes", {}, ["write"], rpc)).isError,
    true,
  );
});

Deno.test("get_line_recurring reads one line's switch and refuses a bad id before any read", async () => {
  const state = {
    transaction_id: TXN,
    recurring: true,
    override: null,
    detected: true,
    typical_day: 4,
  };
  const { calls, rpc } = rpcOf((name) =>
    name === "payment_recurring"
      ? { status: 200, json: state }
      : { status: 500, json: null }
  );
  const result = await callTool("get_line_recurring", { transaction_id: TXN }, [
    "read",
  ], rpc);
  assertEquals(result.structuredContent, { ok: true, data: state });
  for (
    const args of [{}, { transaction_id: "not-a-uuid" }, { transaction_id: 7 }]
  ) {
    const bad = await callTool("get_line_recurring", args, ["read"], rpc);
    assertEquals(bad.isError, true);
    if (!bad.structuredContent.ok) {
      assertEquals(bad.structuredContent.error.code, "validation");
    }
  }
  assertEquals(calls, [{ name: "payment_recurring", body: { p_id: TXN } }]);
  // A line of another company: the RPC raises, so the read is refused.
  const missing = await callTool(
    "get_line_recurring",
    { transaction_id: TXN },
    ["read"],
    () => Promise.resolve({ status: 400, json: null }),
  );
  if (!missing.structuredContent.ok) {
    assertEquals(missing.structuredContent.error.code, "refused");
  }
});

Deno.test("set_line_recurring calls its writer, and undo takes line_recurring", async () => {
  const { calls, rpc } = rpcOf(() => ({
    status: 200,
    json: { ok: true, data: { id: TXN, undo_kind: "line_recurring" } },
  }));
  const writes: [string, Record<string, unknown>][] = [
    ["set_line_recurring", {
      idempotency_key: "r-1",
      transaction_id: TXN,
      recurring: false,
    }],
    ["set_line_recurring", {
      idempotency_key: "r-2",
      transaction_id: TXN,
      recurring: null,
    }],
    ["undo", { idempotency_key: "u-1", kind: "line_recurring", id: TXN }],
  ];
  for (const [name, args] of writes) {
    assertEquals(
      (await callTool(name, args, ["write"], rpc)).isError,
      false,
      name,
    );
  }
  assertEquals(calls, [
    {
      name: "mcp_set_line_recurring",
      body: {
        p_idempotency_key: "r-1",
        p_transaction_id: TXN,
        p_recurring: false,
      },
    },
    {
      name: "mcp_set_line_recurring",
      body: {
        p_idempotency_key: "r-2",
        p_transaction_id: TXN,
        p_recurring: null,
      },
    },
    {
      name: "mcp_undo",
      body: { p_idempotency_key: "u-1", p_kind: "line_recurring", p_id: TXN },
    },
  ]);
});

Deno.test("set_line_recurring validates input and refuses read tokens", async () => {
  const { calls, rpc } = rpcOf(() => ({
    status: 200,
    json: { ok: true, data: {} },
  }));
  const denied = await callTool(
    "set_line_recurring",
    { idempotency_key: "k", transaction_id: TXN, recurring: true },
    ["read"],
    rpc,
  );
  if (!denied.structuredContent.ok) {
    assertEquals(denied.structuredContent.error.code, "forbidden");
  }
  for (
    const input of [
      { idempotency_key: "k", transaction_id: TXN },
      { idempotency_key: "k", transaction_id: TXN, recurring: "yes" },
      { idempotency_key: "k", transaction_id: "not-a-uuid", recurring: true },
      { idempotency_key: "", transaction_id: TXN, recurring: true },
      {
        idempotency_key: "k",
        transaction_id: TXN,
        recurring: true,
        supplier_id: TXN,
      },
    ]
  ) {
    const result = await callTool("set_line_recurring", input, ["write"], rpc);
    assertEquals(result.isError, true);
    if (!result.structuredContent.ok) {
      assertEquals(result.structuredContent.error.code, "validation");
    }
  }
  assertEquals(calls.length, 0);
});

Deno.test("get_recurring_this_month passes the month's arrivals through", async () => {
  const arrived = [{ direction: "income", party_name: "Example Tenant", amount_minor: 500000, change_percent: 0, changed: false }];
  const { calls, rpc } = rpcOf((name) => name === "recurring_this_month" ? { status: 200, json: arrived } : { status: 500, json: null });
  assertEquals((await callTool("get_recurring_this_month", {}, ["read"], rpc)).structuredContent, { ok: true, data: { arrived } });
  assertEquals(calls, [{ name: "recurring_this_month", body: {} }]);
  const failed = await callTool("get_recurring_this_month", {}, ["read"], () => Promise.resolve({ status: 200, json: null }));
  if (!failed.structuredContent.ok) assertEquals(failed.structuredContent.error.code, "refused");
});

Deno.test("set_line_pace calls its writer, validates the pace, and undo takes line_pace", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { id: TXN, undo_kind: "line_pace" } } }));
  for (
    const [name, args] of [
      ["set_line_pace", { idempotency_key: "p-1", transaction_id: TXN, pace: "quarter" }],
      ["set_line_pace", { idempotency_key: "p-2", transaction_id: TXN, pace: null }],
      ["undo", { idempotency_key: "u-2", kind: "line_pace", id: TXN }],
    ] as [string, Record<string, unknown>][]
  ) {
    assertEquals((await callTool(name, args, ["write"], rpc)).isError, false, name);
  }
  for (
    const input of [
      { idempotency_key: "k", transaction_id: TXN, pace: "weekly" },
      { idempotency_key: "k", transaction_id: TXN },
      { idempotency_key: "k", transaction_id: TXN, pace: 3 },
    ]
  ) {
    const result = await callTool("set_line_pace", input, ["write"], rpc);
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
    assertEquals(result.isError, true);
  }
  assertEquals(calls, [
    { name: "mcp_set_line_pace", body: { p_idempotency_key: "p-1", p_transaction_id: TXN, p_pace: "quarter" } },
    { name: "mcp_set_line_pace", body: { p_idempotency_key: "p-2", p_transaction_id: TXN, p_pace: null } },
    { name: "mcp_undo", body: { p_idempotency_key: "u-2", p_kind: "line_pace", p_id: TXN } },
  ]);
});
