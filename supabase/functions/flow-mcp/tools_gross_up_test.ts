// Flow MCP tests for gross-up split parts (FLOW-946, decision 0206). Fixtures: tools_test_support.ts.
import { assertEquals } from "jsr:@std/assert@1";
import { callTool } from "./tools.ts";
import { CATEGORY, INCOME_CATEGORY, PROJECT, TXN } from "./tools_test_support.ts";

Deno.test("get_expense returns a gross_up split part", async () => {
  // A gross-up deposit: gross proceeds (+income) and a real closing cost (expense), gross_up marked.
  const parts = [
    { category_id: INCOME_CATEGORY, project_id: null, amount_minor: 100000, gross_up: false },
    { category_id: CATEGORY, project_id: PROJECT, amount_minor: 3000, gross_up: true },
  ];
  const rpc = (name: string) =>
    Promise.resolve(
      name === "get_transaction"
        ? { status: 200, json: { id: TXN, amount_net: 97000 } }
        : name === "get_line_split"
        ? { status: 200, json: { transaction_id: TXN, currency: "USD", line_minor: 97000, parts, parts_match: true } }
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
    assertEquals(line.line_split.parts[1].gross_up, true);
    assertEquals(line.line_split.parts[0].gross_up, false);
  }
});
