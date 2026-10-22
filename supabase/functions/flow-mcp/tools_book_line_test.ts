// Flow MCP tools test: FLOW-948 (decision 0208). book_line sends a balanced set of legs to
// mcp_book_line, and refuses — before the RPC — legs that do not balance, too few legs, a bad
// currency or direction, or an extra field.
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
