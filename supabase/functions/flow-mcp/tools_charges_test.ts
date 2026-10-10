// Flow MCP tools tests: a line's charges from its party (FLOW-431, decision 0178). Invented ids only.
import { assertEquals } from "jsr:@std/assert@1";
import { callTool } from "./tools.ts";
import { rpcOf, TXN } from "./tools_test_support.ts";

Deno.test("get_line_charges reads one line's party charges and refuses a bad id before any read", async () => {
  const charges = {
    transaction_id: TXN,
    party: {
      direction: "expense",
      id: TXN,
      name: "Example Mailbox",
      currency: "USD",
    },
    month: "2026-10",
    month_amount_minor: -2299,
    typical_amount_minor: -1199,
    typical_source: "recurring",
    change_percent: 92,
    others: 6,
    months: [],
    charges: [],
  };
  const { calls, rpc } = rpcOf((name) =>
    name === "party_charges"
      ? { status: 200, json: charges }
      : { status: 500, json: null }
  );
  const result = await callTool("get_line_charges", { transaction_id: TXN }, [
    "read",
  ], rpc);
  assertEquals(result.structuredContent, { ok: true, data: charges });
  for (
    const args of [{}, { transaction_id: "not-a-uuid" }, { transaction_id: 7 }]
  ) {
    const bad = await callTool("get_line_charges", args, ["read"], rpc);
    assertEquals(bad.isError, true);
    if (!bad.structuredContent.ok) {
      assertEquals(bad.structuredContent.error.code, "validation");
    }
  }
  assertEquals(calls, [{ name: "party_charges", body: { p_id: TXN } }]);
  // A line of another company: the RPC raises, so the read is refused.
  const missing = await callTool(
    "get_line_charges",
    { transaction_id: TXN },
    ["read"],
    () => Promise.resolve({ status: 400, json: null }),
  );
  assertEquals(missing.isError, true);
  if (!missing.structuredContent.ok) {
    assertEquals(missing.structuredContent.error.code, "refused");
  }
});
