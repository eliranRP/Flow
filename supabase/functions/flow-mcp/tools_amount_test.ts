// Flow MCP tools tests: search_expenses' amount filter in minor units (FLOW-214). Fixtures: tools_test_support.ts.
import { assertEquals } from "jsr:@std/assert@1";
import { callTool } from "./tools.ts";
import { rpcOf } from "./tools_test_support.ts";

Deno.test("search_expenses takes amounts in minor units too, and hints when a major one looks minor (FLOW-214)", async () => {
  const { calls, rpc } = rpcOf((name) =>
    name === "search_transactions" ? { status: 200, json: { total: 0, expenses: [], months: [] } } : { status: 200, json: [] }
  );
  const minor = await callTool("search_expenses", { scope: "all", amount_minor: 143217 }, ["read"], rpc);
  const exact = calls.filter((call) => call.name === "search_transactions").at(-1)?.body;
  assertEquals([exact?.p_amount_min, exact?.p_amount_max], [143217, 143217]);
  assertEquals(minor.structuredContent.ok && "hint" in (minor.structuredContent.data as object), false);

  await callTool("search_expenses", { scope: "filed", amount_min_minor: "0", amount_max_minor: 99 }, ["read"], rpc);
  const ranged = calls.filter((call) => call.name === "search_transactions").at(-1)?.body;
  assertEquals([ranged?.p_amount_min, ranged?.p_amount_max], [0, 99]);

  // 143217 in major units is $143,217.00: nothing matches, and the result says how to pass minor units.
  const major = await callTool("search_expenses", { scope: "all", amount: 143217 }, ["read"], rpc);
  const asMajor = calls.filter((call) => call.name === "search_transactions").at(-1)?.body;
  assertEquals(asMajor?.p_amount_min, 14321700);
  assertEquals(major.structuredContent.ok ? (major.structuredContent.data as { hint?: string }).hint : null,
    "amount is in major units, so 143217 was read as 143217.00. If you meant minor units (1432.17), pass amount_minor: 143217.");
  const pending = await callTool("search_expenses", { scope: "pending", amount_max: "250000" }, ["read"], rpc);
  assertEquals(pending.structuredContent.ok ? (pending.structuredContent.data as { hint?: string }).hint?.includes("amount_max_minor: 250000") : false, true);
  // A figure with decimals, or a small one, gets no hint.
  for (const amount of ["1432.17", 99999]) {
    const plain = await callTool("search_expenses", { scope: "all", amount }, ["read"], rpc);
    assertEquals(plain.structuredContent.ok && "hint" in (plain.structuredContent.data as object), false);
  }
});
