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

// FLOW-149 (decision 0228): create_journal_entry and get_account_balances.
const DEPRECIATION = "a0000000-0000-4000-8000-0000000000d1";
const ACCUMULATED = "a0000000-0000-4000-8000-0000000000d2";
const PROJECT = "b0000000-0000-4000-8000-0000000000e1";

Deno.test("create_journal_entry forwards a balanced entry with no bank leg and its reference", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { id: TXN, undo_kind: "journal_entry" } } }));
  const entry = {
    idempotency_key: "je-1", doc_date: "2025-12-31", currency: "USD", description: "Example depreciation",
    reference: "Example JE 1",
    legs: [
      { account_id: DEPRECIATION, amount_minor: 560900, project_id: PROJECT },
      { account_id: ACCUMULATED, amount_minor: -560900, project_id: PROJECT },
    ],
  };
  assertEquals((await callTool("create_journal_entry", entry, ["write"], rpc)).isError, false);
  assertEquals(calls.at(-1), {
    name: "mcp_create_journal_entry",
    body: {
      p_idempotency_key: "je-1", p_doc_date: "2025-12-31", p_currency: "USD", p_description: "Example depreciation",
      p_reference: "Example JE 1", p_legs: entry.legs,
    },
  });
  // No reference, and a leg with no project, are sent as null and without the key.
  await callTool("create_journal_entry", {
    ...entry, idempotency_key: "je-2", reference: undefined,
    legs: [{ account_id: DEPRECIATION, amount_minor: 100 }, { account_id: ACCUMULATED, amount_minor: -100, project_id: null }],
  }, ["write"], rpc);
  assertEquals(calls.at(-1)?.body.p_reference, null);
  assertEquals(calls.at(-1)?.body.p_legs, [{ account_id: DEPRECIATION, amount_minor: 100 }, { account_id: ACCUMULATED, amount_minor: -100 }]);
  await callTool("undo", { idempotency_key: "je-3", kind: "journal_entry", id: TXN }, ["write"], rpc);
  assertEquals(calls.at(-1), { name: "mcp_undo", body: { p_idempotency_key: "je-3", p_kind: "journal_entry", p_id: TXN } });

  const before = calls.length;
  for (const [bad, detail] of [
    [{ legs: [{ account_id: DEPRECIATION, amount_minor: 100 }, { account_id: ACCUMULATED, amount_minor: -90 }] }, "legs must balance to 0"],
    [{ legs: [{ account_id: DEPRECIATION, amount_minor: 0 }] }, "legs"],
    [{ doc_date: "2025-02-30" }, "doc_date"],
    [{ currency: "usd" }, "currency"],
    [{ description: "" }, "description"],
    [{ reference: "x".repeat(61) }, "reference"],
    [{ legs: [{ account_id: DEPRECIATION, amount_minor: 100, currency: "USD" }, { account_id: ACCUMULATED, amount_minor: -100 }] }, "legs"],
  ] as Array<[Record<string, unknown>, string]>) {
    const refused = await callTool("create_journal_entry", { ...entry, idempotency_key: "je-bad", ...bad }, ["write"], rpc);
    assertEquals(codeOf(refused), "validation", JSON.stringify(bad));
    assertEquals(JSON.stringify(refused.structuredContent).includes(detail), true, `${detail} in ${JSON.stringify(refused.structuredContent)}`);
  }
  assertEquals(calls.length, before);
  assertEquals(codeOf(await callTool("create_journal_entry", entry, ["read"], rpc)), "forbidden");

  for (const message of ["a journal entry has no bank leg", "a journal entry needs a leg in the P&L", "a journal entry must change the P&L", "journal entry is fixed"]) {
    const db = rpcOf(() => ({ status: 200, json: { ok: false, error: { code: "refused", message } } }));
    const refused = await callTool("create_journal_entry", entry, ["write"], db.rpc);
    assertEquals(refused.structuredContent, { ok: false, error: { code: "refused", message } });
  }
  const spec = toolsFor(["write"]).find((tool) => tool.name === "create_journal_entry");
  assertEquals(Object.keys(spec?.inputSchema.properties ?? {}), ["idempotency_key", "doc_date", "currency", "description", "reference", "legs"]);
});

Deno.test("get_account_balances passes the balances through, takes an optional as_of and needs read scope", async () => {
  const BALANCES = {
    as_of: "2025-12-31",
    balances: [{ account_id: ACCUMULATED, account_name: "Accumulated depreciation", type: "asset", project_id: PROJECT, project_name: "Example Maple House", currency: "USD", balance_minor: -560900 }],
    book_value: [{ project_id: PROJECT, project_name: "Example Maple House", currency: "USD", property_minor: 30000000, accumulated_depreciation_minor: -560900, net_book_value_minor: 29439100 }],
  };
  const { calls, rpc } = rpcOf((name) => name === "mcp_account_balances" ? { status: 200, json: BALANCES } : { status: 500, json: null });
  assertEquals((await callTool("get_account_balances", { as_of: "2025-12-31" }, ["read"], rpc)).structuredContent, { ok: true, data: BALANCES });
  assertEquals(calls.at(-1), { name: "mcp_account_balances", body: { p_as_of: "2025-12-31" } });
  await callTool("get_account_balances", {}, ["read"], rpc);
  assertEquals(calls.at(-1)?.body, { p_as_of: null });
  const before = calls.length;
  for (const bad of [{ as_of: "2025-13-01" }, { as_of: 20251231 }, { project_id: PROJECT }]) {
    assertEquals(codeOf(await callTool("get_account_balances", bad, ["read"], rpc)), "validation", JSON.stringify(bad));
  }
  assertEquals(calls.length, before);
  assertEquals(codeOf(await callTool("get_account_balances", {}, ["write"], rpc)), "forbidden");
  const shapeless = rpcOf(() => ({ status: 200, json: { balances: null } }));
  assertEquals(codeOf(await callTool("get_account_balances", {}, ["read"], shapeless.rpc)), "refused");
});
