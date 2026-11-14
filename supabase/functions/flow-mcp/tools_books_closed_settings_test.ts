// Flow MCP tools tests: FLOW-1170, a setting that would move a figure in a closed period. The database
// refuses it (20261114094800_books_closed_settings.sql) and the tool passes the refusal through as it
// came; each tool's description says so and names the way back. Invented ids only.
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { callTool, toolsFor } from "./tools.ts";
import { CATEGORY, PROJECT, rpcOf } from "./tools_test_support.ts";

const COMPANY = "c0c0c0c0-1111-4000-8000-000000000001";
const SETTING = "the books are closed through 2026-05-31: this setting changes them";

const CALLS: Array<[string, Record<string, unknown>, string]> = [
  ["set_cash_basis", { idempotency_key: "bc-1", basis: "invoice" }, "mcp_set_cash_basis"],
  ["set_category_pnl", { idempotency_key: "bc-2", category_id: CATEGORY, excluded: true }, "mcp_set_category_pnl"],
  ["set_category_cash", { idempotency_key: "bc-3", category_id: CATEGORY, in_cash: false }, "mcp_set_category_cash"],
  ["set_category_account", { idempotency_key: "bc-4", category_id: CATEGORY, account_id: null }, "mcp_set_category_account"],
  ["set_overhead_project", { idempotency_key: "bc-5", project_id: PROJECT }, "mcp_set_overhead_project"],
  ["undo", { idempotency_key: "bc-6", kind: "cash_basis", id: COMPANY }, "mcp_undo"],
  ["undo", { idempotency_key: "bc-7", kind: "category_pnl", id: CATEGORY }, "mcp_undo"],
  ["undo", { idempotency_key: "bc-8", kind: "category_cash", id: CATEGORY }, "mcp_undo"],
  ["undo", { idempotency_key: "bc-9", kind: "category_account", id: CATEGORY }, "mcp_undo"],
  ["undo", { idempotency_key: "bc-10", kind: "overhead_project", id: COMPANY }, "mcp_undo"],
];

Deno.test("each setting's tool and its undo pass the closed-period refusal through as it came", async () => {
  const refusal = { ok: false as const, error: { code: "refused", message: SETTING } };
  for (const [tool, args, rpcName] of CALLS) {
    const { calls, rpc } = rpcOf(() => ({ status: 200, json: refusal }));
    const result = await callTool(tool, args, ["write"], rpc);
    assertEquals(calls.at(-1)?.name, rpcName, tool);
    assertEquals(result.structuredContent, refusal, `${tool} ${JSON.stringify(args)}`);
  }
});

Deno.test("each setting's description says it is refused in a closed period and how to reopen", () => {
  const tools = toolsFor(["write"]);
  for (const name of ["set_cash_basis", "set_category_pnl", "set_category_cash", "set_category_account", "set_overhead_project"]) {
    const description = tools.find((tool) => tool.name === name)?.description ?? "";
    assertStringIncludes(description, "the books are closed through YYYY-MM-DD: this setting changes them", name);
    assertStringIncludes(description, "move the closed date back with set_books_closed_through first", name);
  }
});
