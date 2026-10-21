// Flow MCP tools tests: the suggested transfers between two Mercury connections (FLOW-941, decision 0205):
// list_transfer_matches, confirm_transfer_match and dismiss_transfer_match.
import { assertEquals } from "jsr:@std/assert@1";
import { callTool, toolsFor } from "./tools.ts";
import { rpcOf } from "./tools_test_support.ts";

const OUT = "c0ffee00-9410-4000-8000-000000000001";
const IN = "c0ffee00-9410-4000-8000-000000000002";

const LISTED = {
  matches: [{
    out: {
      transaction_id: OUT, doc_date: "2026-10-10", amount_minor: 500000, currency: "USD", description: "To Quarry",
      party: "Quarry Sample Inc", slot: 1, org_label: "Harbor Sample LLC", account_name: "Operations", account_last4: "4821",
    },
    in: {
      transaction_id: IN, doc_date: "2026-10-11", amount_minor: 500000, currency: "USD", description: "From Harbor",
      party: null, slot: 2, org_label: "Quarry Sample Inc", account_name: "Main", account_last4: "9034",
    },
    day_diff: 1,
    name_hint: true,
  }],
};

const ANSWERED = (same: boolean) => ({
  ok: true,
  data: { out_transaction_id: OUT, in_transaction_id: IN, same, undo_kind: "transfer_match", id: OUT },
});

function codeOf(result: Awaited<ReturnType<typeof callTool>>): string | null {
  return result.structuredContent.ok ? null : result.structuredContent.error.code;
}

Deno.test("list_transfer_matches passes the suggestions through", async () => {
  const { calls, rpc } = rpcOf((name) => name === "list_transfer_matches" ? { status: 200, json: LISTED } : { status: 500, json: null });
  const result = await callTool("list_transfer_matches", {}, ["read"], rpc);
  assertEquals(result.isError, false);
  if (result.structuredContent.ok) assertEquals(result.structuredContent.data, LISTED);
  assertEquals(calls, [{ name: "list_transfer_matches", body: {} }]);
});

Deno.test("list_transfer_matches takes no arguments, needs read scope, and refuses a bad read", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { matches: "nope" } }));
  assertEquals(codeOf(await callTool("list_transfer_matches", { limit: 5 }, ["read"], rpc)), "validation");
  assertEquals(codeOf(await callTool("list_transfer_matches", {}, ["write"], rpc)), "forbidden");
  assertEquals(calls.length, 0);
  assertEquals(codeOf(await callTool("list_transfer_matches", {}, ["read"], rpc)), "refused");
  const failed = rpcOf(() => ({ status: 403, json: null }));
  assertEquals(codeOf(await callTool("list_transfer_matches", {}, ["read"], failed.rpc)), "refused");
});

Deno.test("confirm and dismiss answer through mcp_answer_transfer_match with the undo", async () => {
  const { calls, rpc } = rpcOf((name, body) =>
    name === "mcp_answer_transfer_match" ? { status: 200, json: ANSWERED(body.p_same === true) } : { status: 500, json: null }
  );
  const confirmed = await callTool("confirm_transfer_match", { idempotency_key: "xfer-1", out_transaction_id: OUT, in_transaction_id: IN }, ["write"], rpc);
  assertEquals(confirmed.isError, false);
  if (confirmed.structuredContent.ok) assertEquals(confirmed.structuredContent.data, ANSWERED(true).data);
  const dismissed = await callTool("dismiss_transfer_match", { idempotency_key: "xfer-2", out_transaction_id: OUT, in_transaction_id: IN }, ["write"], rpc);
  if (dismissed.structuredContent.ok) assertEquals(dismissed.structuredContent.data, ANSWERED(false).data);
  assertEquals(calls.map((call) => call.body), [
    { p_idempotency_key: "xfer-1", p_out_transaction_id: OUT, p_in_transaction_id: IN, p_same: true },
    { p_idempotency_key: "xfer-2", p_out_transaction_id: OUT, p_in_transaction_id: IN, p_same: false },
  ]);
});

Deno.test("the transfer answers need write scope and are listed for it", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: ANSWERED(true) }));
  assertEquals(codeOf(await callTool("confirm_transfer_match", { idempotency_key: "r", out_transaction_id: OUT, in_transaction_id: IN }, ["read"], rpc)), "forbidden");
  assertEquals(codeOf(await callTool("dismiss_transfer_match", { idempotency_key: "r", out_transaction_id: OUT, in_transaction_id: IN }, ["read"], rpc)), "forbidden");
  assertEquals(calls.length, 0);
  const names = toolsFor(["write"]).map((tool) => tool.name);
  assertEquals(names.includes("confirm_transfer_match") && names.includes("dismiss_transfer_match"), true);
  assertEquals(toolsFor(["read"]).map((tool) => tool.name).includes("list_transfer_matches"), true);
});

Deno.test("the transfer answers check their arguments and pass a refusal through", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: false, error: { code: "refused", message: "not a transfer pair" } } }));
  const bad: Record<string, unknown>[] = [
    { idempotency_key: "b", out_transaction_id: "nope", in_transaction_id: IN },
    { idempotency_key: "b", out_transaction_id: OUT },
    { idempotency_key: "", out_transaction_id: OUT, in_transaction_id: IN },
    { out_transaction_id: OUT, in_transaction_id: IN },
    { idempotency_key: "b", out_transaction_id: OUT, in_transaction_id: IN, same: true },
  ];
  for (const args of bad) assertEquals(codeOf(await callTool("confirm_transfer_match", args, ["write"], rpc)), "validation");
  assertEquals(calls.length, 0);
  const refused = await callTool("confirm_transfer_match", { idempotency_key: "b", out_transaction_id: OUT, in_transaction_id: IN }, ["write"], rpc);
  if (!refused.structuredContent.ok) assertEquals(refused.structuredContent.error, { code: "refused", message: "not a transfer pair" });
  const failed = rpcOf(() => ({ status: 500, json: null }));
  assertEquals(codeOf(await callTool("dismiss_transfer_match", { idempotency_key: "b", out_transaction_id: OUT, in_transaction_id: IN }, ["write"], failed.rpc)), "refused");
});

Deno.test("undo takes the kind transfer_match", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { kind: "transfer_match", id: OUT } } }));
  const result = await callTool("undo", { idempotency_key: "u", kind: "transfer_match", id: OUT }, ["write"], rpc);
  assertEquals(result.isError, false);
  assertEquals(calls[0]?.body, { p_idempotency_key: "u", p_kind: "transfer_match", p_id: OUT });
});
