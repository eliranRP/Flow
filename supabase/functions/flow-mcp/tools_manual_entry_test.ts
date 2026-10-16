// Flow MCP tools tests: FLOW-369 writes. create_manual_entry (a cash or cheque line) and
// attach_document (a document on an existing line): what is refused before the RPC, and what the
// RPC is called with.
import { assertEquals } from "jsr:@std/assert@1";
import { callTool } from "./tools.ts";
import { PROJECT, CATEGORY, rpcOf, TXN } from "./tools_test_support.ts";

const SHA = "AB".repeat(32);
const DOCUMENT = { name: "receipt.pdf", mime: "application/pdf", bytes: 20480, sha256: SHA };

Deno.test("create_manual_entry sends a cash line to mcp_create_manual_entry with no cheque number", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { id: TXN, undo_kind: "manual_entry" } } }));
  const result = await callTool("create_manual_entry", {
    idempotency_key: "manual-1",
    direction: "expense",
    amount_minor: 35000,
    doc_date: "2026-10-11",
    payee: "Ajax Hardware",
    project_id: PROJECT,
    category_id: CATEGORY,
    method: "cash",
    cheque_number: "1048",
  }, ["write"], rpc);
  assertEquals(result.isError, false);
  assertEquals(calls, [{
    name: "mcp_create_manual_entry",
    body: {
      p_idempotency_key: "manual-1",
      p_direction: "expense",
      p_amount_minor: 35000,
      p_doc_date: "2026-10-11",
      p_payee: "Ajax Hardware",
      p_project_id: PROJECT,
      p_category_id: CATEGORY,
      p_method: "cash",
      p_cheque_number: null,
    },
  }]);
});

Deno.test("create_manual_entry keeps a cheque number and refuses a cheque without one, before the RPC", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: {} } }));
  const base = {
    idempotency_key: "manual-2",
    direction: "expense",
    amount_minor: 240000,
    doc_date: "2026-10-11",
    payee: "Rivera Drywall",
    project_id: PROJECT,
    category_id: CATEGORY,
    method: "cheque",
  };
  const missing = await callTool("create_manual_entry", base, ["write"], rpc);
  assertEquals(missing.isError, true);
  const badNumber = await callTool("create_manual_entry", { ...base, cheque_number: "10 48" }, ["write"], rpc);
  assertEquals(badNumber.isError, true);
  const fine = await callTool("create_manual_entry", { ...base, cheque_number: "1048" }, ["write"], rpc);
  assertEquals(fine.isError, false);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].body.p_cheque_number, "1048");
});

Deno.test("create_manual_entry refuses a bad direction, amount, date, payee or method before the RPC", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: {} } }));
  const base = {
    idempotency_key: "manual-3",
    direction: "expense",
    amount_minor: 100,
    doc_date: "2026-10-11",
    payee: "Ajax Hardware",
    project_id: PROJECT,
    category_id: CATEGORY,
    method: "cash",
  };
  const cases = [
    { ...base, direction: "transfer" },
    { ...base, amount_minor: 0 },
    { ...base, amount_minor: 1.5 },
    { ...base, doc_date: "2026-02-31" },
    { ...base, payee: "A" },
    { ...base, payee: "Ajax​Hardware" },
    { ...base, method: "card" },
    { ...base, project_id: "not-a-uuid" },
    { ...base, unknown: true },
  ];
  for (const input of cases) {
    const result = await callTool("create_manual_entry", input, ["write"], rpc);
    assertEquals(result.isError, true, JSON.stringify(input));
  }
  assertEquals(calls.length, 0);
});

Deno.test("attach_document sends one document to mcp_attach_document, sha256 in lower case", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { id: TXN, documents: 1 } } }));
  const result = await callTool("attach_document", {
    idempotency_key: "attach-1",
    transaction_id: TXN,
    document: DOCUMENT,
  }, ["write"], rpc);
  assertEquals(result.isError, false);
  assertEquals(calls, [{
    name: "mcp_attach_document",
    body: {
      p_idempotency_key: "attach-1",
      p_transaction_id: TXN,
      p_document: { name: "receipt.pdf", mime: "application/pdf", bytes: 20480, sha256: "ab".repeat(32) },
    },
  }]);
});

Deno.test("attach_document refuses a type outside the list, a size over 25 MB and an extra field, before the RPC", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: {} } }));
  const cases = [
    { ...DOCUMENT, mime: "application/x-msdownload" },
    { ...DOCUMENT, bytes: 26214401 },
    { ...DOCUMENT, bytes: 0 },
    { ...DOCUMENT, sha256: "abc" },
    { ...DOCUMENT, url: "https://example.com/r.pdf" },
  ];
  for (const document of cases) {
    const result = await callTool("attach_document", {
      idempotency_key: "attach-2",
      transaction_id: TXN,
      document,
    }, ["write"], rpc);
    assertEquals(result.isError, true, JSON.stringify(document));
  }
  assertEquals(calls.length, 0);
});
