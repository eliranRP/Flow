// Flow MCP tools tests: utility bills the tenant never paid back (FLOW-1134, decision 0265):
// list_utility_refunds, count_utility_refunds, list_utility_payers, set_utility_payer, answer_utility_refund,
// mark_utility_refunds_seen and refile_utility_refund. Invented ids and amounts only.
import { assertEquals } from "jsr:@std/assert@1";
import { callTool, toolsFor } from "./tools.ts";
import { rpcOf } from "./tools_test_support.ts";

const PROJECT = "c0ffee00-1130-4000-8000-000000000001";
const SUPPLIER = "c0ffee00-1130-4000-8000-000000000002";
const BILL = "c0ffee00-1130-4000-8000-000000000003";
const PAYMENT = "c0ffee00-1130-4000-8000-000000000004";
const WRITE = "c0ffee00-1130-4000-8000-000000000005";

const LISTED = {
  as_of: "2026-06-30",
  bills: [{
    bill_transaction_id: BILL, project_id: PROJECT, project_name: "Example Oak House", supplier_id: SUPPLIER,
    supplier_name: "Example Power Co", currency: "ILS", category_id: null, category_name: null, amount_minor: 10000,
    doc_date: "2026-03-05", days: 117, state: "refunded", source: "owner", rule: null, group_bill_transaction_ids: [BILL],
    no_rent: false, wrong_category: true, keep_category: false, refiled: false,
    payment: {
      transaction_id: PAYMENT, doc_date: "2026-03-20", amount_minor: 10000, currency: "ILS", description: "Example refund",
      party: null, project_id: null, category_id: null, category_name: null, split: false,
      project_name: null, parts: [],
    },
  }],
};
const COUNTED = { as_of: "2026-06-30", not_refunded_count: 2, not_refunded_by_currency: [{ currency: "ILS", amount_minor: 9000 }], suggested_count: 1 };
const PAYERS = {
  project_id: PROJECT,
  utilities: [{
    supplier_id: SUPPLIER, supplier_name: "Example Power Co", currency: "ILS", payer: "tenant", added: false, found: true,
    usual_minor: null, bill_count: 0, last_bill_date: null, category_id: null, category_name: null,
  }],
};
const REFUSED = (message: string) => ({ ok: false, error: { code: "refused", message } });

function codeOf(result: Awaited<ReturnType<typeof callTool>>): string | null {
  return result.structuredContent.ok ? null : result.structuredContent.error.code;
}
function messageOf(result: Awaited<ReturnType<typeof callTool>>): string | null {
  return result.structuredContent.ok ? null : result.structuredContent.error.message;
}

Deno.test("list_utility_refunds passes the property, the as-of date and all through, and the list back", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: LISTED }));
  const result = await callTool("list_utility_refunds", { project_id: PROJECT, as_of: "2026-06-30", all: true }, ["read"], rpc);
  assertEquals(result.isError, false);
  if (result.structuredContent.ok) assertEquals(result.structuredContent.data, LISTED);
  await callTool("list_utility_refunds", {}, ["read"], rpc);
  assertEquals(calls, [
    { name: "list_utility_refunds", body: { p_project_id: PROJECT, p_today: "2026-06-30", p_all: true } },
    { name: "list_utility_refunds", body: { p_project_id: null, p_today: null, p_all: false } },
  ]);
});

Deno.test("count_utility_refunds and list_utility_payers read their RPCs", async () => {
  const { calls, rpc } = rpcOf((name) => ({ status: 200, json: name === "count_utility_refunds" ? COUNTED : PAYERS }));
  const counted = await callTool("count_utility_refunds", { as_of: "2026-06-30" }, ["read"], rpc);
  if (counted.structuredContent.ok) assertEquals(counted.structuredContent.data, COUNTED);
  const payers = await callTool("list_utility_payers", { project_id: PROJECT }, ["read"], rpc);
  if (payers.structuredContent.ok) assertEquals(payers.structuredContent.data, PAYERS);
  assertEquals(calls, [
    { name: "count_utility_refunds", body: { p_today: "2026-06-30" } },
    { name: "list_utility_payers", body: { p_project_id: PROJECT } },
  ]);
});

Deno.test("the reads check their arguments, need read scope, and refuse another company's property", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 400, json: { message: "project not found" } }));
  assertEquals(codeOf(await callTool("list_utility_refunds", { project_id: "nope" }, ["read"], rpc)), "validation");
  assertEquals(codeOf(await callTool("list_utility_refunds", { as_of: "30/06/2026" }, ["read"], rpc)), "validation");
  assertEquals(codeOf(await callTool("count_utility_refunds", { project_id: PROJECT }, ["read"], rpc)), "validation");
  assertEquals(codeOf(await callTool("list_utility_payers", {}, ["read"], rpc)), "validation");
  assertEquals(codeOf(await callTool("list_utility_refunds", {}, ["write"], rpc)), "forbidden");
  assertEquals(calls.length, 0);
  // Another company's property: the RPC raises, so the read is refused.
  assertEquals(codeOf(await callTool("list_utility_payers", { project_id: PROJECT }, ["read"], rpc)), "refused");
  assertEquals(codeOf(await callTool("list_utility_refunds", { project_id: PROJECT }, ["read"], rpc)), "refused");
  const malformed = rpcOf(() => ({ status: 200, json: { bills: "nope" } }));
  assertEquals(codeOf(await callTool("list_utility_refunds", {}, ["read"], malformed.rpc)), "refused");
});

Deno.test("set_utility_payer writes through mcp_set_utility_payer with the undo", async () => {
  const data = { project_id: PROJECT, supplier_id: SUPPLIER, currency: "ILS", payer: "company", added: false, prior: null, undo_kind: "utility_payer", id: WRITE };
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data } }));
  const result = await callTool("set_utility_payer", { idempotency_key: "p1", project_id: PROJECT, supplier_id: SUPPLIER, currency: "ILS", payer: "company" }, ["write"], rpc);
  if (result.structuredContent.ok) assertEquals(result.structuredContent.data, data);
  await callTool("set_utility_payer", { idempotency_key: "p2", project_id: PROJECT, supplier_id: SUPPLIER, currency: "ILS", payer: null, added: true }, ["write"], rpc);
  assertEquals(calls, [
    { name: "mcp_set_utility_payer", body: { p_idempotency_key: "p1", p_project_id: PROJECT, p_supplier_id: SUPPLIER, p_currency: "ILS", p_payer: "company", p_added: false } },
    { name: "mcp_set_utility_payer", body: { p_idempotency_key: "p2", p_project_id: PROJECT, p_supplier_id: SUPPLIER, p_currency: "ILS", p_payer: null, p_added: true } },
  ]);
});

Deno.test("answer_utility_refund sends each state through mcp_answer_utility_refund", async () => {
  const { calls, rpc } = rpcOf((_name, body) => ({
    status: 200,
    json: { ok: true, data: { bill_transaction_id: BILL, state: body.p_state, undo_kind: "utility_refund", id: WRITE } },
  }));
  for (const args of [
    { idempotency_key: "a1", bill_transaction_id: BILL, state: "matched", payment_transaction_id: PAYMENT },
    { idempotency_key: "a2", bill_transaction_id: BILL, state: "rejected", payment_transaction_id: PAYMENT },
    { idempotency_key: "a3", bill_transaction_id: BILL, state: "seen", as_of: "2026-06-30" },
    { idempotency_key: "a4", bill_transaction_id: BILL, state: null },
    { idempotency_key: "a5", bill_transaction_id: BILL, state: "matched", payment_transaction_id: PAYMENT, keep_category: true },
  ]) {
    assertEquals((await callTool("answer_utility_refund", args, ["write"], rpc)).isError, false);
  }
  assertEquals(calls.map((call) => [call.name, call.body.p_state, call.body.p_payment_transaction_id, call.body.p_today, call.body.p_keep_category]), [
    ["mcp_answer_utility_refund", "matched", PAYMENT, null, null],
    ["mcp_answer_utility_refund", "rejected", PAYMENT, null, null],
    ["mcp_answer_utility_refund", "seen", null, "2026-06-30", null],
    ["mcp_answer_utility_refund", null, null, null, null],
    ["mcp_answer_utility_refund", "matched", PAYMENT, null, true],
  ]);
});

Deno.test("mark_utility_refunds_seen and refile_utility_refund write through their RPCs", async () => {
  const { calls, rpc } = rpcOf((name) => ({
    status: 200,
    json: { ok: true, data: name === "mcp_mark_utility_refunds_seen"
      ? { project_id: PROJECT, bill_transaction_ids: [BILL], undo_kind: "utility_refunds_seen", id: WRITE }
      : { bill_transaction_id: BILL, payment_transaction_id: PAYMENT, mode: "move", undo_kind: "utility_refile", id: WRITE } },
  }));
  const seen = await callTool("mark_utility_refunds_seen", { idempotency_key: "s1", project_id: PROJECT, as_of: "2026-06-30" }, ["write"], rpc);
  if (seen.structuredContent.ok) assertEquals((seen.structuredContent.data as { bill_transaction_ids: string[] }).bill_transaction_ids, [BILL]);
  const refiled = await callTool("refile_utility_refund", { idempotency_key: "r1", bill_transaction_id: BILL, payment_transaction_id: PAYMENT }, ["write"], rpc);
  if (refiled.structuredContent.ok) assertEquals((refiled.structuredContent.data as { mode: string }).mode, "move");
  assertEquals(calls, [
    { name: "mcp_mark_utility_refunds_seen", body: { p_idempotency_key: "s1", p_project_id: PROJECT, p_today: "2026-06-30" } },
    { name: "mcp_refile_utility_refund", body: { p_idempotency_key: "r1", p_bill_transaction_id: BILL, p_payment_transaction_id: PAYMENT } },
  ]);
});

Deno.test("the writes check their arguments before any call", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: {} } }));
  const bad: [string, Record<string, unknown>][] = [
    ["set_utility_payer", { idempotency_key: "b", project_id: PROJECT, supplier_id: SUPPLIER, currency: "ils", payer: "tenant" }],
    ["set_utility_payer", { idempotency_key: "b", project_id: PROJECT, supplier_id: SUPPLIER, currency: "ILS", payer: "landlord" }],
    ["set_utility_payer", { project_id: PROJECT, supplier_id: SUPPLIER, currency: "ILS", payer: "tenant" }],
    ["answer_utility_refund", { idempotency_key: "b", bill_transaction_id: BILL, state: "matched" }],
    ["answer_utility_refund", { idempotency_key: "b", bill_transaction_id: BILL, state: "seen", payment_transaction_id: PAYMENT }],
    ["answer_utility_refund", { idempotency_key: "b", bill_transaction_id: BILL, state: "paid", payment_transaction_id: PAYMENT }],
    ["answer_utility_refund", { idempotency_key: "b", bill_transaction_id: "nope", state: "seen" }],
    ["answer_utility_refund", { idempotency_key: "b", bill_transaction_id: BILL, state: "seen", keep_category: true }],
    ["answer_utility_refund", { idempotency_key: "b", bill_transaction_id: BILL, state: "matched", payment_transaction_id: PAYMENT, keep_category: "yes" }],
    ["mark_utility_refunds_seen", { idempotency_key: "b", project_id: PROJECT, as_of: "today" }],
    ["refile_utility_refund", { idempotency_key: "b", bill_transaction_id: BILL }],
    ["refile_utility_refund", { idempotency_key: "b", bill_transaction_id: BILL, payment_transaction_id: PAYMENT, mode: "move" }],
  ];
  for (const [name, args] of bad) assertEquals(codeOf(await callTool(name, args, ["write"], rpc)), "validation", `${name} ${JSON.stringify(args)}`);
  assertEquals(calls.length, 0);
});

Deno.test("the writes need write scope; another company's ids and an expired key are refused", async () => {
  const none = rpcOf(() => ({ status: 200, json: { ok: true, data: {} } }));
  assertEquals(codeOf(await callTool("answer_utility_refund", { idempotency_key: "w", bill_transaction_id: BILL, state: "seen" }, ["read"], none.rpc)), "forbidden");
  assertEquals(codeOf(await callTool("refile_utility_refund", { idempotency_key: "w", bill_transaction_id: BILL, payment_transaction_id: PAYMENT }, ["read"], none.rpc)), "forbidden");
  assertEquals(none.calls.length, 0);
  // Another company's bill, payment or property: the database refuses it, and the refusal passes through.
  const other = rpcOf((name) => ({ status: 200, json: REFUSED(name === "mcp_set_utility_payer" ? "project not found" : "transaction not found") }));
  const answered = await callTool("answer_utility_refund", { idempotency_key: "o1", bill_transaction_id: BILL, state: "seen" }, ["write"], other.rpc);
  assertEquals([codeOf(answered), messageOf(answered)], ["refused", "transaction not found"]);
  const payer = await callTool("set_utility_payer", { idempotency_key: "o2", project_id: PROJECT, supplier_id: SUPPLIER, currency: "ILS", payer: "tenant" }, ["write"], other.rpc);
  assertEquals([codeOf(payer), messageOf(payer)], ["refused", "project not found"]);
  // An expired key: the write gate refuses it.
  const expired = rpcOf(() => ({ status: 200, json: { ok: false, error: { code: "forbidden", message: "expired" } } }));
  const late = await callTool("mark_utility_refunds_seen", { idempotency_key: "e1", project_id: PROJECT }, ["write"], expired.rpc);
  assertEquals([codeOf(late), messageOf(late)], ["forbidden", "expired"]);
  const failed = rpcOf(() => ({ status: 500, json: null }));
  assertEquals(codeOf(await callTool("refile_utility_refund", { idempotency_key: "f", bill_transaction_id: BILL, payment_transaction_id: PAYMENT }, ["write"], failed.rpc)), "refused");
});

Deno.test("the tools are listed for their scope, and undo takes the four kinds", async () => {
  const reads = toolsFor(["read"]).map((tool) => tool.name);
  const writes = toolsFor(["write"]).map((tool) => tool.name);
  for (const name of ["list_utility_refunds", "count_utility_refunds", "list_utility_payers", "list_utility_months"]) assertEquals(reads.includes(name), true, name);
  for (const name of ["set_utility_payer", "answer_utility_refund", "mark_utility_refunds_seen", "refile_utility_refund"]) {
    assertEquals(writes.includes(name), true, name);
  }
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { kind: "utility_refile", id: WRITE } } }));
  for (const kind of ["utility_payer", "utility_refund", "utility_refunds_seen", "utility_refile"]) {
    assertEquals((await callTool("undo", { idempotency_key: `u-${kind}`, kind, id: WRITE }, ["write"], rpc)).isError, false, kind);
  }
  assertEquals(calls.map((call) => [call.name, call.body.p_kind]), [
    ["mcp_undo", "utility_payer"], ["mcp_undo", "utility_refund"], ["mcp_undo", "utility_refunds_seen"], ["mcp_undo", "utility_refile"],
  ]);
});

Deno.test("list_utility_months reads a property's months, checks its arguments, and refuses another company's", async () => {
  const MONTHS = {
    project_id: PROJECT, as_of: "2026-06-30",
    months: [{
      month: "2026-06-01", rent_in: 200000, bills_paid: 7000, not_refunded: 7000,
      rent_lines: [{ transaction_id: PAYMENT, doc_date: "2026-06-01", amount_minor: 200000, currency: "ILS", party: null, category_name: "Example rent" }],
      bills: [{ bill_transaction_id: BILL, doc_date: "2026-06-10", amount_minor: 7000, currency: "ILS", supplier_name: "Example Power Co", category_name: null, state: "waiting" }],
    }],
  };
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: MONTHS }));
  const read = await callTool("list_utility_months", { project_id: PROJECT, as_of: "2026-06-30" }, ["read"], rpc);
  if (read.structuredContent.ok) assertEquals(read.structuredContent.data, MONTHS);
  await callTool("list_utility_months", { project_id: PROJECT }, ["read"], rpc);
  assertEquals(calls, [
    { name: "list_utility_months", body: { p_project: PROJECT, p_today: "2026-06-30" } },
    { name: "list_utility_months", body: { p_project: PROJECT, p_today: null } },
  ]);
  assertEquals(codeOf(await callTool("list_utility_months", {}, ["read"], rpc)), "validation");
  assertEquals(codeOf(await callTool("list_utility_months", { project_id: PROJECT, as_of: "june" }, ["read"], rpc)), "validation");
  assertEquals(codeOf(await callTool("list_utility_months", { project_id: PROJECT }, ["write"], rpc)), "forbidden");
  assertEquals(calls.length, 2);
  const other = rpcOf(() => ({ status: 400, json: { message: "project not found" } }));
  assertEquals(codeOf(await callTool("list_utility_months", { project_id: PROJECT }, ["read"], other.rpc)), "refused");
  const malformed = rpcOf(() => ({ status: 200, json: { months: "nope" } }));
  assertEquals(codeOf(await callTool("list_utility_months", { project_id: PROJECT }, ["read"], malformed.rpc)), "refused");
});
