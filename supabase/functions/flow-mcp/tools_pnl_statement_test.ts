// FLOW-160: get_pnl_statement, the P&L as a statement (get_pnl_statement). Invented ids only.
import { assertEquals } from "jsr:@std/assert@1";
import { callTool } from "./tools.ts";
import { rpcOf } from "./tools_test_support.ts";

const PROJECT = "b0000000-0000-4000-8000-0000000000e1";
const BODY = { from: null, to: null, basis: "cash", currencies: [], projects: [], review_count: 0 };

function codeOf(result: Awaited<ReturnType<typeof callTool>>): string | null {
  return result.structuredContent.ok ? null : result.structuredContent.error.code;
}

Deno.test("get_pnl_statement passes the range, the project or by_project, and the basis", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: BODY }));
  const one = await callTool("get_pnl_statement", { from: "2026-01-01", to: "2026-10-31", project_id: PROJECT, basis: "invoiced" }, ["read"], rpc);
  assertEquals(one.isError, false);
  assertEquals(calls.at(-1), {
    name: "get_pnl_statement",
    body: { p_from: "2026-01-01", p_to: "2026-10-31", p_project_id: PROJECT, p_by_project: false, p_basis: "invoiced" },
  });
  await callTool("get_pnl_statement", { by_project: true }, ["read"], rpc);
  assertEquals(calls.at(-1)?.body, { p_from: null, p_to: null, p_project_id: null, p_by_project: true, p_basis: null });
  await callTool("get_pnl_statement", {}, ["read"], rpc);
  assertEquals(calls.at(-1)?.body, { p_from: null, p_to: null, p_project_id: null, p_by_project: false, p_basis: null });
});

Deno.test("get_pnl_statement refuses a bad range, project, flag or basis before any call", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: BODY }));
  for (
    const bad of [
      { from: "2026-01-01" },
      { to: "2026-01-31" },
      { from: "2026-02-30", to: "2026-03-31" },
      { from: "2026-03-01", to: "2026-02-01" },
      { from: 5, to: 6 },
      { project_id: "nope" },
      { by_project: "yes" },
      { project_id: PROJECT, by_project: true },
      { basis: "accrual" },
      { extra: 1 },
    ]
  ) {
    assertEquals(codeOf(await callTool("get_pnl_statement", bad, ["read"], rpc)), "validation", JSON.stringify(bad));
  }
  assertEquals(calls.length, 0);
});

Deno.test("get_pnl_statement: another company's project is not_found; a failed or shapeless read is refused", async () => {
  const unknown = rpcOf(() => ({ status: 200, json: null }));
  assertEquals(codeOf(await callTool("get_pnl_statement", { project_id: PROJECT }, ["read"], unknown.rpc)), "not_found");
  const failed = rpcOf(() => ({ status: 500, json: null }));
  assertEquals(codeOf(await callTool("get_pnl_statement", {}, ["read"], failed.rpc)), "refused");
  const shapeless = rpcOf(() => ({ status: 200, json: { currencies: [] } }));
  assertEquals(codeOf(await callTool("get_pnl_statement", {}, ["read"], shapeless.rpc)), "refused");
  const { rpc } = rpcOf(() => ({ status: 200, json: BODY }));
  assertEquals(codeOf(await callTool("get_pnl_statement", {}, ["write"], rpc)), "forbidden");
});
