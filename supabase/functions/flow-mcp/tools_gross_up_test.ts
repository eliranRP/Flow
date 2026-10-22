// Flow MCP tests for gross-up split parts (FLOW-946, decision 0206). Fixtures: tools_test_support.ts.
import { assertEquals } from "jsr:@std/assert@1";
import { callTool } from "./tools.ts";
import { CATEGORY, INCOME_CATEGORY, PROJECT, rpcOf, TXN } from "./tools_test_support.ts";

const SAVED = { status: 200, json: { ok: true, data: { transaction_id: TXN, parts: [], undo_kind: "line_split", id: TXN } } };

Deno.test("split_line takes a normal and a gross-up part on the same category and project (FLOW-949)", async () => {
  const { calls, rpc } = rpcOf(() => SAVED);
  // A payment: Build, a 249.48 Taxes cost and an 850.77 Taxes contra credit, both on one project.
  const parts = [
    { category_id: INCOME_CATEGORY, project_id: PROJECT, amount_minor: 200000 },
    { category_id: CATEGORY, project_id: PROJECT, amount_minor: 24948 },
    { category_id: CATEGORY, project_id: PROJECT, amount_minor: 85077, gross_up: true },
  ];
  const res = await callTool("split_line", { idempotency_key: "sp-1", transaction_id: TXN, parts }, ["write"], rpc);
  assertEquals(res.isError, false);
  assertEquals(calls[0]?.body.p_parts, parts);
});

Deno.test("split_line names the rule that failed in detail, and keeps message validation (FLOW-949)", async () => {
  const { calls, rpc } = rpcOf(() => SAVED);
  const refusal = async (parts: unknown[]) => {
    const res = await callTool("split_line", { idempotency_key: "sp-2", transaction_id: TXN, parts }, ["write"], rpc);
    assertEquals(res.isError, true);
    return res.structuredContent.ok ? null : res.structuredContent.error;
  };
  const twice = { code: "validation", message: "validation", detail: "same category and project twice" };
  // Two normal parts on one pair, and two gross-up parts on one pair, are still real duplicates.
  assertEquals(await refusal([
    { category_id: CATEGORY, project_id: PROJECT, amount_minor: 100 },
    { category_id: CATEGORY, project_id: PROJECT, amount_minor: 200 },
  ]), twice);
  assertEquals(await refusal([
    { category_id: INCOME_CATEGORY, project_id: PROJECT, amount_minor: 900 },
    { category_id: CATEGORY, project_id: PROJECT, amount_minor: 100, gross_up: true },
    { category_id: CATEGORY, project_id: PROJECT, amount_minor: 200, gross_up: true },
  ]), twice);
  assertEquals((await refusal([
    { category_id: INCOME_CATEGORY, amount_minor: 900 },
    { category_id: CATEGORY, project_id: PROJECT, percent: 3, gross_up: true },
  ]))?.detail, "parts.1: gross_up requires amount_minor");
  assertEquals((await refusal([
    { category_id: INCOME_CATEGORY, amount_minor: 900 },
    { category_id: CATEGORY, project_id: PROJECT, amount_minor: 30, effect: "contra" },
  ]))?.detail, "parts.1: effect only on a gross_up part");
  assertEquals((await refusal([
    { category_id: INCOME_CATEGORY, amount_minor: 900, percent: 10 },
    { category_id: CATEGORY, amount_minor: 30 },
  ]))?.detail, "parts.0: a part gives exactly one of amount_minor, percent or rest");
  assertEquals((await refusal([{ amount_minor: 900 }, { category_id: CATEGORY, rest: true }]))?.detail,
    "parts.0: category_id is required unless rest");
  assertEquals((await refusal([{ category_id: CATEGORY, amount_minor: 900 }]))?.detail, "parts must be none or 2 to 50");
  assertEquals((await refusal([{ rest: true }, { category_id: CATEGORY, rest: true }]))?.detail, "at most one rest part");
  assertEquals(calls.length, 0);
});

Deno.test("assign_expenses names a parts row's failing rule in detail (FLOW-949)", async () => {
  const { calls, rpc } = rpcOf(() => SAVED);
  const res = await callTool("assign_expenses", {
    idempotency_key: "sp-batch",
    items: [{
      transaction_id: TXN,
      parts: [
        { category_id: CATEGORY, project_id: PROJECT, amount_minor: 100 },
        { category_id: CATEGORY, project_id: PROJECT, amount_minor: 200 },
      ],
    }],
  }, ["write"], rpc);
  assertEquals(res.structuredContent, {
    ok: false,
    error: { code: "validation", message: "validation", detail: "items.0.parts: same category and project twice" },
  });
  assertEquals(calls.length, 0);
});

Deno.test("get_expense returns a gross_up split part with its derived effect", async () => {
  // A gross-up deposit: gross proceeds (+income) and a real closing cost (expense, NORMAL), plus a
  // contra credit on an income category (effect 'contra'). get_line_split reports the effect; the
  // MCP passes it straight through (FLOW-947, 0207).
  const parts = [
    { category_id: INCOME_CATEGORY, project_id: null, amount_minor: 100000, gross_up: false },
    { category_id: CATEGORY, project_id: PROJECT, amount_minor: 3000, gross_up: true, effect: "normal" },
    { category_id: INCOME_CATEGORY, project_id: PROJECT, amount_minor: 2000, gross_up: true, effect: "contra" },
  ];
  const rpc = (name: string) =>
    Promise.resolve(
      name === "get_transaction"
        ? { status: 200, json: { id: TXN, amount_net: 95000 } }
        : name === "get_line_split"
        ? { status: 200, json: { transaction_id: TXN, currency: "USD", line_minor: 95000, parts, parts_match: true } }
        : name === "get_loan_split"
        ? { status: 200, json: null }
        : name === "get_line_meta"
        ? { status: 200, json: [] }
        : { status: 500, json: null },
    );
  const res = await callTool("get_expense", { transaction_id: TXN }, ["read"], rpc);
  assertEquals(res.isError, false);
  if (res.structuredContent.ok) {
    const line = res.structuredContent.data as { line_split: { parts_match: boolean; parts: typeof parts } };
    assertEquals(line.line_split.parts_match, true);
    assertEquals(line.line_split.parts[0].gross_up, false);
    assertEquals(line.line_split.parts[1].gross_up, true);
    assertEquals(line.line_split.parts[1].effect, "normal");
    assertEquals(line.line_split.parts[2].effect, "contra");
  }
});
