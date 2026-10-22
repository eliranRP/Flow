// MCP tools: the ledger reads (FLOW-950, decision 0208 item 9), so an assistant can use book_line end to
// end: list_accounts gives the account ids book_line needs (mcp_accounts), and get_line_legs reads one
// line's legs back to verify a booking (mcp_line_legs). Any member reads both.
import { fail, ok, READ_REFUSED, type ToolResult, type ToolRpc, UUID } from "./tools_args.ts";

export const LEDGER_READS = ["list_accounts", "get_line_legs"] as const;

/** The reads' argument allow-list, merged into ALLOWED in tools_schemas.ts. */
export const LEDGER_ALLOWED: Record<string, Set<string>> = {
  list_accounts: new Set(),
  get_line_legs: new Set(["transaction_id"]),
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function ledgerRead(
  name: typeof LEDGER_READS[number],
  args: Record<string, unknown>,
  rpc: ToolRpc,
): Promise<ToolResult> {
  if (name === "list_accounts") {
    const result = await rpc("mcp_accounts", {});
    const body = result.json;
    if (result.status >= 400 || !isObject(body) || !Array.isArray(body.accounts)) return fail("refused", READ_REFUSED);
    return ok(body);
  }
  const id = args.transaction_id;
  if (typeof id !== "string" || !UUID.test(id)) return fail("validation", "validation");
  const result = await rpc("mcp_line_legs", { p_transaction_id: id });
  if (result.status >= 400) return fail("refused", READ_REFUSED);
  // Null for an unknown or removed line and for another company's.
  if (result.json == null) return fail("not_found", "not found");
  if (!isObject(result.json) || !Array.isArray(result.json.legs)) return fail("refused", READ_REFUSED);
  return ok(result.json);
}
