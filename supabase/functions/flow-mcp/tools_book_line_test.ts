// Flow MCP tools test: FLOW-948 (decision 0208). book_line sends a balanced set of legs to
// mcp_book_line, and refuses — before the RPC — legs that do not balance, too few legs, a bad
// currency or direction, or an extra field. FLOW-950: transaction_id books an existing line, and a
// refusal of the arguments names the field in detail. FLOW-953: asset and liability legs pass through
// unchanged (the database files them as kept-out parts).
import { assertEquals } from "jsr:@std/assert@1";
import { callTool } from "./tools.ts";
import { PROJECT, rpcOf, TXN } from "./tools_test_support.ts";

const BANK = "a0000000-0000-4000-8000-0000000000b1";
const REPAIRS = "a0000000-0000-4000-8000-0000000000c1";
const CLOSING = "a0000000-0000-4000-8000-0000000000c2";

Deno.test("book_line sends a balanced split payment to mcp_book_line, dropping absent project_id", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { id: TXN, undo_kind: "book_line" } } }));
  const result = await callTool("book_line", {
    idempotency_key: "book-1",
    doc_date: "2026-10-11",
    direction: "expense",
    currency: "USD",
    description: "A split bill",
    legs: [
      { account_id: BANK, amount_minor: -8000 },
      { account_id: REPAIRS, amount_minor: 5000, project_id: PROJECT },
      { account_id: CLOSING, amount_minor: 3000 },
    ],
  }, ["write"], rpc);
  assertEquals(result.isError, false);
  assertEquals(calls, [{
    name: "mcp_book_line",
    body: {
      p_idempotency_key: "book-1",
      p_doc_date: "2026-10-11",
      p_direction: "expense",
      p_currency: "USD",
      p_description: "A split bill",
      p_legs: [
        { account_id: BANK, amount_minor: -8000 },
        { account_id: REPAIRS, amount_minor: 5000, project_id: PROJECT },
        { account_id: CLOSING, amount_minor: 3000 },
      ],
      p_project_id: null,
      p_transaction_id: null,
    },
  }]);
});

Deno.test("book_line refuses legs that do not balance to 0, before the RPC", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: {} } }));
  const result = await callTool("book_line", {
    idempotency_key: "book-2",
    doc_date: "2026-10-11",
    direction: "expense",
    currency: "USD",
    description: "Unbalanced",
    legs: [
      { account_id: BANK, amount_minor: -5000 },
      { account_id: REPAIRS, amount_minor: 4000 },
    ],
  }, ["write"], rpc);
  assertEquals(result.isError, true);
  assertEquals(calls.length, 0);
});

Deno.test("book_line refuses too few legs, a bad currency or direction, a bad date and an extra field, before the RPC", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: {} } }));
  const base = {
    idempotency_key: "book-3",
    doc_date: "2026-10-11",
    direction: "expense",
    currency: "USD",
    description: "A line",
    legs: [
      { account_id: BANK, amount_minor: -5000 },
      { account_id: REPAIRS, amount_minor: 5000 },
    ],
  };
  const cases = [
    { ...base, legs: [{ account_id: BANK, amount_minor: 0 }] },
    { ...base, currency: "usd" },
    { ...base, currency: "DOLLARS" },
    { ...base, direction: "transfer" },
    { ...base, doc_date: "2026-02-31" },
    { ...base, description: "" },
    { ...base, legs: [{ account_id: "not-a-uuid", amount_minor: -5000 }, { account_id: REPAIRS, amount_minor: 5000 }] },
    { ...base, unknown: true },
  ];
  for (const input of cases) {
    const result = await callTool("book_line", input, ["write"], rpc);
    assertEquals(result.isError, true, JSON.stringify(input));
  }
  assertEquals(calls.length, 0);
});

// The refusal's error object: code, message and detail.
async function refusal(input: Record<string, unknown>) {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: {} } }));
  const result = await callTool("book_line", input, ["write"], rpc);
  assertEquals(result.isError, true, JSON.stringify(input));
  assertEquals(calls.length, 0);
  return result.structuredContent.ok ? null : result.structuredContent.error;
}

const WIRE_LEGS = [
  { account_id: BANK, amount_minor: -139871 },
  { account_id: REPAIRS, amount_minor: 200000, project_id: PROJECT },
  { account_id: CLOSING, amount_minor: 24948, project_id: PROJECT },
  { account_id: CLOSING, amount_minor: -85077, project_id: PROJECT },
];

Deno.test("book_line with transaction_id books an existing line: no date, currency or description, contra legs pass through", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { id: TXN, undo_kind: "line_split" } } }));
  const result = await callTool("book_line", {
    idempotency_key: "book-4",
    transaction_id: TXN,
    direction: "expense",
    legs: WIRE_LEGS,
  }, ["write"], rpc);
  assertEquals(result.isError, false);
  assertEquals(calls, [{
    name: "mcp_book_line",
    body: {
      p_idempotency_key: "book-4",
      p_doc_date: null,
      p_direction: "expense",
      p_currency: null,
      p_description: null,
      p_legs: WIRE_LEGS,
      p_project_id: null,
      p_transaction_id: TXN,
    },
  }]);
});

Deno.test("book_line names the field that failed in detail (FLOW-950)", async () => {
  const base = { idempotency_key: "book-5", direction: "expense", legs: WIRE_LEGS };
  assertEquals(await refusal({ ...base, transaction_id: TXN, doc_date: "2026-10-11" }), {
    code: "validation", message: "validation", detail: "doc_date: not taken with transaction_id (the line keeps its own)",
  });
  assertEquals((await refusal({ ...base, doc_date: "2026-10-11", currency: "USD" }))?.detail,
    "description: required for a new line");
  assertEquals((await refusal({ ...base, transaction_id: TXN, legs: [WIRE_LEGS[0], { account_id: REPAIRS, amount_minor: 1 }] }))?.detail,
    "legs: legs must balance to 0");
  assertEquals((await refusal({ ...base, transaction_id: TXN, legs: [WIRE_LEGS[0], { account_id: "bad", amount_minor: 139871 }] }))?.detail?.startsWith("legs.1.account_id: "), true);
  assertEquals((await refusal({ ...base, transaction_id: "not-a-uuid" }))?.detail?.startsWith("transaction_id: "), true);
});

const PROPERTY = "a0000000-0000-4000-8000-0000000000d1";
const LOAN = "a0000000-0000-4000-8000-0000000000d2";

Deno.test("book_line passes a closing wire's asset and liability legs through unchanged (FLOW-953)", async () => {
  const legs = [
    { account_id: BANK, amount_minor: -6490000 },
    { account_id: PROPERTY, amount_minor: 30000000, project_id: PROJECT },
    { account_id: CLOSING, amount_minor: 450000, project_id: PROJECT },
    { account_id: REPAIRS, amount_minor: 120000, project_id: PROJECT },
    { account_id: REPAIRS, amount_minor: -80000, project_id: PROJECT },
    { account_id: LOAN, amount_minor: -24000000, project_id: PROJECT },
  ];
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { id: TXN, undo_kind: "line_split" } } }));
  const result = await callTool("book_line", { idempotency_key: "book-6", transaction_id: TXN, direction: "expense", legs }, ["write"], rpc);
  assertEquals(result.isError, false);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].body.p_legs, legs);
  // A leg with a currency of its own is refused before the RPC: a booking is in the line's one currency.
  assertEquals((await refusal({
    idempotency_key: "book-7", transaction_id: TXN, direction: "expense",
    legs: [legs[0], { ...legs[1], amount_minor: 6490000, currency: "ILS" }],
  }))?.code, "validation");
});
