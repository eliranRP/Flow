// MCP tools: the ledger reads (FLOW-950, decision 0208 item 9), so an assistant can use book_line end to
// end: list_accounts gives the account ids book_line needs (mcp_accounts), and get_line_legs reads one
// line's legs back to verify a booking (mcp_line_legs). get_account_balances (FLOW-149, decision 0228)
// sums the balance-sheet legs per project (mcp_account_balances). get_pnl_statement (FLOW-160) reads the P&L as a
// statement for the reports screen (get_pnl_statement); export_report (FLOW-162, tools_export.ts) makes the
// reports a PDF or CSV file. get_account_lines (FLOW-165) opens one balance-sheet account's movements
// (get_account_lines). get_journal_entry_history (FLOW-174) reads a journal entry's versions
// (mcp_journal_entry_history). Any member reads them.
import { EXPORT_ALLOWED, exportReport, pnlProblem } from "./tools_export.ts";
import { PREPAID_ALLOWED, PREPAID_READS, prepaidRead } from "./tools_prepaid.ts";
import { DATE, fail, isCalendarDate, limitOf, offsetOf, ok, READ_REFUSED, type ToolResult, type ToolRpc, UUID } from "./tools_args.ts";

export const LEDGER_READS = ["list_accounts", "get_line_legs", "get_journal_entry_history", "get_account_balances", "get_balance_sheet", "get_account_lines", "get_pnl_statement", "export_report", ...PREPAID_READS] as const;

/** The reads' and the account writes' argument allow-list, merged into ALLOWED in tools_schemas.ts. */
export const LEDGER_ALLOWED: Record<string, Set<string>> = {
  list_accounts: new Set(["include_archived"]),
  get_line_legs: new Set(["transaction_id"]),
  get_journal_entry_history: new Set(["journal_entry_id"]),
  get_account_balances: new Set(["as_of"]),
  get_balance_sheet: new Set(["as_of", "project_id"]),
  get_account_lines: new Set(["account_id", "as_of", "from", "from_start", "project_id", "currency", "limit", "offset"]),
  get_pnl_statement: new Set(["from", "to", "project_id", "by_project", "basis"]),
  // FLOW-152: the chart of accounts writes (tools_accounts.ts).
  create_account: new Set(["idempotency_key", "name", "type", "description"]),
  update_account: new Set(["idempotency_key", "account_id", "name", "description", "type"]),
  archive_account: new Set(["idempotency_key", "account_id"]),
  restore_account: new Set(["idempotency_key", "account_id"]),
  merge_account: new Set(["idempotency_key", "from_account_id", "into_account_id"]),
  ...PREPAID_ALLOWED,
  ...EXPORT_ALLOWED,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function ledgerRead(
  name: typeof LEDGER_READS[number],
  args: Record<string, unknown>,
  rpc: ToolRpc,
): Promise<ToolResult> {
  if (name === "list_prepaid_schedules" || name === "get_prepaid_schedule") return prepaidRead(name, args, rpc);
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
  if (name === "get_account_lines") return accountLines(args, rpc);
  if (name === "get_pnl_statement") return pnlStatement(args, rpc);
  if (name === "export_report") return exportReport(args, rpc);
  if (name === "get_journal_entry_history") return journalEntryHistory(args, rpc);
  const id = args.transaction_id;
  if (typeof id !== "string" || !UUID.test(id)) return fail("validation", "validation");
  const result = await rpc("mcp_line_legs", { p_transaction_id: id });
  if (result.status >= 400) return fail("refused", READ_REFUSED);
  // Null for an unknown or removed line and for another company's.
  if (result.json == null) return fail("not_found", "not found");
  if (!isObject(result.json) || !Array.isArray(result.json.legs)) return fail("refused", READ_REFUSED);
  return ok(result.json);
}

// FLOW-174: a journal entry's versions, the current one first.
async function journalEntryHistory(args: Record<string, unknown>, rpc: ToolRpc): Promise<ToolResult> {
  const id = args.journal_entry_id;
  if (typeof id !== "string" || !UUID.test(id)) return fail("validation", "journal_entry_id: a journal entry id");
  const result = await rpc("mcp_journal_entry_history", { p_journal_entry_id: id });
  if (result.status >= 400) return fail("refused", READ_REFUSED);
  // Null for an unknown or removed line and for another company's.
  if (result.json == null) return fail("not_found", "not found");
  if (!isObject(result.json)) return fail("refused", READ_REFUSED);
  if (result.json.is_journal_entry !== true) return fail("refused", "not a journal entry");
  if (!Array.isArray(result.json.versions)) return fail("refused", READ_REFUSED);
  const { is_journal_entry: _, ...history } = result.json;
  return ok(history);
}

// FLOW-160: the P&L statement. Both dates or neither; one project or by_project, not both.
async function pnlStatement(args: Record<string, unknown>, rpc: ToolRpc): Promise<ToolResult> {
  const { from, to, project_id: project, by_project: byProject, basis } = args;
  const problem = pnlProblem(args);
  if (problem != null) return problem;
  const result = await rpc("get_pnl_statement", {
    p_from: from ?? null,
    p_to: to ?? null,
    p_project_id: project ?? null,
    p_by_project: byProject === true,
    p_basis: basis ?? null,
  });
  if (result.status >= 400) return fail("refused", READ_REFUSED);
  // Null for another company's project or an unknown one.
  if (result.json == null) return fail("not_found", "not found");
  const body = result.json;
  if (!isObject(body) || !Array.isArray(body.currencies) || !Array.isArray(body.projects)) return fail("refused", READ_REFUSED);
  return ok(body);
}

function isDateArg(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && DATE.test(value) && isCalendarDate(value));
}

// FLOW-165: one balance-sheet account's balance, the period's opening and its movements, paged. FLOW-171: the
// period starts on from, at the very start (from_start true: no opening, every movement), or by default on
// 1 January of as_of's year.
async function accountLines(args: Record<string, unknown>, rpc: ToolRpc): Promise<ToolResult> {
  const { account_id: account, as_of: asOf, from, from_start: fromStart, project_id: project, currency } = args;
  if (typeof account !== "string" || !UUID.test(account)) return fail("validation", "account_id: an account id");
  if (!isDateArg(asOf)) return fail("validation", "as_of: a date, YYYY-MM-DD");
  if (!isDateArg(from)) return fail("validation", "from: a date, YYYY-MM-DD");
  if (fromStart !== undefined && fromStart !== null && typeof fromStart !== "boolean") return fail("validation", "from_start: true or false");
  if (fromStart === true && from != null) return fail("validation", "from or from_start, not both");
  if (typeof from === "string" && typeof asOf === "string" && from > asOf) return fail("validation", "from: on or before as_of");
  if (project !== undefined && project !== null && (typeof project !== "string" || !UUID.test(project))) {
    return fail("validation", "project_id: a project id");
  }
  if (currency !== undefined && currency !== null && (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency))) {
    return fail("validation", "currency: a currency code, like ILS");
  }
  const limit = limitOf(args.limit, 50);
  if (typeof limit !== "number") return limit;
  if (limit < 1) return fail("validation", "limit: 1 to 100");
  const offset = offsetOf(args.offset);
  if (typeof offset !== "number") return offset;
  const result = await rpc("get_account_lines", {
    p_account_id: account,
    p_as_of: asOf ?? null,
    p_project_id: project ?? null,
    p_currency: currency ?? null,
    p_limit: limit,
    p_offset: offset,
    p_from: from ?? null,
    p_from_start: fromStart === true,
  });
  // With no as_of, the database finds a from after today; any other refusal it calls validation stays generic.
  if (result.status >= 400 && isObject(result.json) && result.json.message === "validation") {
    return fail("validation", typeof from === "string" && asOf == null ? "from: on or before as_of" : "validation");
  }
  if (result.status >= 400) return fail("refused", READ_REFUSED);
  // Null for another company's account or project, an unknown one, or an income or expense account.
  if (result.json == null) return fail("not_found", "not found");
  const body = result.json;
  if (!isObject(body) || !Array.isArray(body.currencies) || !Array.isArray(body.rows)) return fail("refused", READ_REFUSED);
  return ok(body);
}
