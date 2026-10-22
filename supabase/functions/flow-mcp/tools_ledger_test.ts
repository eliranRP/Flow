// Flow MCP tools tests: the ledger reads (FLOW-950, decision 0208): list_accounts (mcp_accounts) and
// get_line_legs (mcp_line_legs). Invented ids only.
import { assertEquals } from "jsr:@std/assert@1";
import { callTool, toolsFor } from "./tools.ts";
import { rpcOf, TXN } from "./tools_test_support.ts";

const BANK = "a0000000-0000-4000-8000-0000000000b1";

function codeOf(result: Awaited<ReturnType<typeof callTool>>): string | null {
  return result.structuredContent.ok ? null : result.structuredContent.error.code;
}

const ACCOUNTS = {
  accounts: [
    { id: BANK, name: "Bank/Clearing", type: "asset", category_id: null, system: true, is_bank: true, excluded_from_pnl: true, loan_part: null, hidden: false, bookable: true },
  ],
};

const LEGS = {
  transaction_id: TXN,
  direction: "expense",
  line_status: "posted",
  currency: "USD",
  amount_gross: -5000,
  vat_amount: 0,
  legs: [{ ordinal: 1, account_id: BANK, account_name: "Bank/Clearing", account_type: "asset", category_id: null, is_bank: true, project_id: null, amount_minor: -5000 }],
  balanced: false,
};

Deno.test("list_accounts passes the accounts through, takes no arguments and needs read scope", async () => {
  const { calls, rpc } = rpcOf((name) => name === "mcp_accounts" ? { status: 200, json: ACCOUNTS } : { status: 500, json: null });
  const result = await callTool("list_accounts", {}, ["read"], rpc);
  assertEquals(result.structuredContent, { ok: true, data: ACCOUNTS });
  assertEquals(calls, [{ name: "mcp_accounts", body: {} }]);
  assertEquals(codeOf(await callTool("list_accounts", { limit: 5 }, ["read"], rpc)), "validation");
  assertEquals(codeOf(await callTool("list_accounts", {}, ["write"], rpc)), "forbidden");
  const failed = rpcOf(() => ({ status: 500, json: null }));
  assertEquals(codeOf(await callTool("list_accounts", {}, ["read"], failed.rpc)), "refused");
  const shapeless = rpcOf(() => ({ status: 200, json: { accounts: null } }));
  assertEquals(codeOf(await callTool("list_accounts", {}, ["read"], shapeless.rpc)), "refused");
});

Deno.test("get_line_legs reads one line's legs; a null answer is not_found; a bad id is refused before the read", async () => {
  const { calls, rpc } = rpcOf((name) => name === "mcp_line_legs" ? { status: 200, json: LEGS } : { status: 500, json: null });
  const result = await callTool("get_line_legs", { transaction_id: TXN }, ["read"], rpc);
  assertEquals(result.structuredContent, { ok: true, data: LEGS });
  assertEquals(calls, [{ name: "mcp_line_legs", body: { p_transaction_id: TXN } }]);
  const before = calls.length;
  for (const args of [{}, { transaction_id: "not-a-uuid" }, { transaction_id: TXN, extra: 1 }]) {
    assertEquals(codeOf(await callTool("get_line_legs", args, ["read"], rpc)), "validation");
  }
  assertEquals(calls.length, before);
  const missing = rpcOf(() => ({ status: 200, json: null }));
  assertEquals(codeOf(await callTool("get_line_legs", { transaction_id: TXN }, ["read"], missing.rpc)), "not_found");
  const failed = rpcOf(() => ({ status: 500, json: null }));
  assertEquals(codeOf(await callTool("get_line_legs", { transaction_id: TXN }, ["read"], failed.rpc)), "refused");
  assertEquals(codeOf(await callTool("get_line_legs", { transaction_id: TXN }, ["write"], rpc)), "forbidden");
});

Deno.test("the ledger reads are listed for a read scope only", () => {
  const read = toolsFor(["read"]).map((tool) => tool.name);
  const write = toolsFor(["write"]).map((tool) => tool.name);
  assertEquals(["list_accounts", "get_line_legs"].every((name) => read.includes(name)), true);
  assertEquals(["list_accounts", "get_line_legs"].some((name) => write.includes(name)), false);
});
