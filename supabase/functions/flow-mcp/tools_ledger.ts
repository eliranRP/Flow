// MCP tools: the ledger reads (FLOW-950, decision 0208 item 9), so an assistant can use book_line end to
// end: list_accounts gives the account ids book_line needs (mcp_accounts), and get_line_legs reads one
// line's legs back to verify a booking (mcp_line_legs). get_account_balances (FLOW-149, decision 0228)
// sums the balance-sheet legs per project (mcp_account_balances). Any member reads them.
import { DATE, fail, isCalendarDate, ok, READ_REFUSED, type ToolResult, type ToolRpc, UUID } from "./tools_args.ts";

export const LEDGER_READS = ["list_accounts", "get_line_legs", "get_account_balances", "get_balance_sheet"] as const;

/** The reads' argument allow-list, merged into ALLOWED in tools_schemas.ts. */
export const LEDGER_ALLOWED: Record<string, Set<string>> = {
  list_accounts: new Set(["include_archived"]),
  get_line_legs: new Set(["transaction_id"]),
  get_account_balances: new Set(["as_of"]),
  get_balance_sheet: new Set(["as_of", "project_id"]),
  // FLOW-152: the chart of accounts writes (tools_accounts.ts).
  create_account: new Set(["idempotency_key", "name", "type", "description"]),
  update_account: new Set(["idempotency_key", "account_id", "name", "description", "type"]),
  archive_account: new Set(["idempotency_key", "account_id"]),
  restore_account: new Set(["idempotency_key", "account_id"]),
  merge_account: new Set(["idempotency_key", "from_account_id", "into_account_id"]),
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
    const archived = args.include_archived;
    if (archived !== undefined && typeof archived !== "boolean") return fail("validation", "include_archived: true or false");
    const result = await rpc("mcp_accounts", archived === undefined ? {} : { p_include_archived: archived });
    const body = result.json;
    if (result.status >= 400 || !isObject(body) || !Array.isArray(body.accounts)) return fail("refused", READ_REFUSED);
    return ok(body);
  }
  if (name === "get_account_balances") {
    const asOf = args.as_of;
    if (asOf !== undefined && asOf !== null && (typeof asOf !== "string" || !DATE.test(asOf) || !isCalendarDate(asOf))) {
      return fail("validation", "as_of: a date, YYYY-MM-DD");
    }
    const result = await rpc("mcp_account_balances", { p_as_of: asOf ?? null });
    const body = result.json;
    if (result.status >= 400 || !isObject(body) || !Array.isArray(body.balances) || !Array.isArray(body.book_value)) {
      return fail("refused", READ_REFUSED);
    }
    return ok(body);
  }
  if (name === "get_balance_sheet") {
    const asOf = args.as_of;
    if (asOf !== undefined && asOf !== null && (typeof asOf !== "string" || !DATE.test(asOf) || !isCalendarDate(asOf))) {
      return fail("validation", "as_of: a date, YYYY-MM-DD");
    }
    const project = args.project_id;
    if (project !== undefined && project !== null && (typeof project !== "string" || !UUID.test(project))) {
      return fail("validation", "project_id: a project id");
    }
    const result = await rpc("mcp_balance_sheet", { p_as_of: asOf ?? null, p_project_id: project ?? null });
    const body = result.json;
    if (result.status >= 400 || !isObject(body) || !Array.isArray(body.currencies)) return fail("refused", READ_REFUSED);
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
