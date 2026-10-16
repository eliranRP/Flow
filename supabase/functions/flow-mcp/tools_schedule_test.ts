// Flow MCP tools tests: the FLOW-447 recurring schedule read. Fixtures: tools_test_support.ts.
import { assertEquals } from "jsr:@std/assert@1";
import { callTool } from "./tools.ts";

Deno.test("get_recurring_schedule takes no arguments and passes the SQL rows through", async () => {
  const calls: Array<[string, unknown]> = [];
  const rpc = (name: string, body: unknown) => {
    calls.push([name, body]);
    return Promise.resolve({ status: 200, json: [{ party_name: "שכירות", state: "late" }] });
  };
  const result = await callTool("get_recurring_schedule", {}, ["read"], rpc);
  assertEquals(result.structuredContent, { ok: true, data: { schedule: [{ party_name: "שכירות", state: "late" }] } });
  assertEquals(calls, [["recurring_schedule", {}]]);
  assertEquals((await callTool("get_recurring_schedule", { today: "2026-01-01" }, ["read"], rpc)).isError, true);
  assertEquals((await callTool("get_recurring_schedule", {}, ["read"], () => Promise.resolve({ status: 200, json: {} }))).isError, true);
  assertEquals((await callTool("get_recurring_schedule", {}, ["write"], rpc)).isError, true);
});
