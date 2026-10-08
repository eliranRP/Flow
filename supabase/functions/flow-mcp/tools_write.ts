// MCP tools: callWrite runs every write tool after its scope and argument checks.
// Split out of tools.ts (FLOW-807). Decision 0080.

import {
  argsOf,
  envelopeOf,
  fail,
  isCalendarDate,
  isFail,
  ppmFromPercent,
  signedPpmFromPercent,
  type ToolDefer,
  type ToolInvoke,
  type ToolResult,
  type ToolRpc,
  WRITE_REFUSED,
} from "./tools_args.ts";
import {
  ALLOWED,
  assignExpenseSplitSchema,
  assignExpensesSchema,
  assignSchema,
  categorySchema,
  createCategoriesSchema,
  createCategorySchema,
  createProjectSchema,
  createProjectsSchema,
  deleteCategorySchema,
  deleteLoanSchema,
  detachLoanPaymentSchema,
  hideCategorySchema,
  invalid,
  INVESTMENT_KEYS,
  moveCategoryLinesSchema,
  renameCategorySchema,
  renameCompanySchema,
  reorderLoansSchema,
  setCategoryGroupSchema,
  setCategoryPnlSchema,
  setCategoryRehabSchema,
  setCompanyCurrencySchema,
  setInvoicePaidSchema,
  setJevModeSchema,
  setLinePnlSchema,
  setLinesPnlSchema,
  setIndexRateSchema,
  setLoanIndexSchema,
  setLoanRateSchema,
  setOverheadProjectSchema,
  setProjectInvestmentSchema,
  splitLineSchema,
  syncBankSchema,
  undoBatchSchema,
  undoJevPrefillSchema,
  undoSchema,
  WRITE_TOOL_NAMES,
} from "./tools_schemas.ts";
import { addLoanWrite, attachLoanWrite, updateLoanWrite } from "./tools_loans.ts";
import { syncBank } from "./tools_sync.ts";

export async function callWrite(
  name: typeof WRITE_TOOL_NAMES[number],
  input: unknown,
  rpc: ToolRpc,
  invoke?: ToolInvoke,
  defer?: ToolDefer,
): Promise<ToolResult> {
  const args = argsOf(input, ALLOWED[name] ?? new Set());
  if (isFail(args)) return args;
  let rpcName = "mcp_undo";
  let body: Record<string, unknown> = {};
  if (name === "sync_bank") {
    const parsed = syncBankSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    return syncBank(parsed.data.idempotency_key, rpc, invoke, defer);
  }
  if (name === "assign_expense") {
    const parsed = assignSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_assign_expense";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_transaction_id: parsed.data.transaction_id,
      p_project_id: parsed.data.project_id ?? null,
      p_category_id: parsed.data.category_id,
      p_remember: parsed.data.remember ?? false,
    };
  } else if (name === "assign_expense_split") {
    const parsed = assignExpenseSplitSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_assign_expense_split";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_transaction_id: parsed.data.transaction_id,
      p_shares: parsed.data.shares,
      ...(parsed.data.category_id == null ? {} : { p_category_id: parsed.data.category_id }),
    };
  } else if (name === "set_expense_category") {
    const parsed = categorySchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_set_expense_category";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_transaction_id: parsed.data.transaction_id,
      p_category_id: parsed.data.category_id,
    };
  } else if (name === "create_project") {
    const parsed = createProjectSchema.safeParse(args);
    if (!parsed.success) return invalid(parsed.error);
    rpcName = "mcp_create_project";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_name: parsed.data.name,
      ...(parsed.data.status == null ? {} : { p_status: parsed.data.status }),
    };
  } else if (name === "create_category") {
    const parsed = createCategorySchema.safeParse(args);
    if (!parsed.success) return invalid(parsed.error);
    rpcName = "mcp_create_category";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_name: parsed.data.name,
      p_kind: parsed.data.kind,
    };
  } else if (name === "create_projects") {
    const parsed = createProjectsSchema.safeParse(args);
    if (!parsed.success) return invalid(parsed.error);
    rpcName = "mcp_create_projects";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_items: parsed.data.items.map((item) => item.status == null ? { name: item.name } : item),
    };
  } else if (name === "create_categories") {
    const parsed = createCategoriesSchema.safeParse(args);
    if (!parsed.success) return invalid(parsed.error);
    rpcName = "mcp_create_categories";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_items: parsed.data.items,
    };
  } else if (name === "hide_category") {
    const parsed = hideCategorySchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_hide_category";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_category_id: parsed.data.category_id,
    };
  } else if (name === "set_category_pnl") {
    const parsed = setCategoryPnlSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_set_category_pnl";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_category_id: parsed.data.category_id,
      p_excluded: parsed.data.excluded,
    };
  } else if (name === "set_overhead_project") {
    const parsed = setOverheadProjectSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_set_overhead_project";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_project_id: parsed.data.project_id,
    };
  } else if (name === "rename_company") {
    const parsed = renameCompanySchema.safeParse(args);
    if (!parsed.success) return invalid(parsed.error);
    rpcName = "mcp_rename_company";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_name: parsed.data.name,
    };
  } else if (name === "add_loan") {
    return addLoanWrite(args, rpc);
  } else if (name === "update_loan") {
    return updateLoanWrite(args, rpc);
  } else if (name === "attach_loan_payment") {
    return attachLoanWrite(args, rpc);
  } else if (name === "set_loan_rate") {
    const parsed = setLoanRateSchema.safeParse(args);
    if (!parsed.success || !isCalendarDate(parsed.data.effective_date)) return fail("validation", "validation");
    let ratePpm: number | null = null;
    if (parsed.data.annual_rate_percent !== null) {
      const ppm = ppmFromPercent(parsed.data.annual_rate_percent);
      if (typeof ppm !== "number") return ppm;
      ratePpm = ppm;
    }
    rpcName = "mcp_set_loan_rate";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_loan_id: parsed.data.loan_id,
      p_effective_date: parsed.data.effective_date,
      p_annual_rate_ppm: ratePpm,
    };
  } else if (name === "set_loan_index") {
    const parsed = setLoanIndexSchema.safeParse(args);
    if (!parsed.success || (parsed.data.rate_index === null) !== (parsed.data.margin_percent === null)) {
      return fail("validation", "validation");
    }
    let marginPpm: number | null = null;
    if (parsed.data.margin_percent !== null) {
      const ppm = signedPpmFromPercent(parsed.data.margin_percent);
      if (typeof ppm !== "number") return ppm;
      marginPpm = ppm;
    }
    rpcName = "mcp_set_loan_index";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_loan_id: parsed.data.loan_id,
      p_rate_index: parsed.data.rate_index,
      p_margin_ppm: marginPpm,
    };
  } else if (name === "set_index_rate") {
    const parsed = setIndexRateSchema.safeParse(args);
    if (!parsed.success || !isCalendarDate(parsed.data.effective_date)) return fail("validation", "validation");
    const ppm = ppmFromPercent(parsed.data.annual_rate_percent);
    if (typeof ppm !== "number") return ppm;
    rpcName = "mcp_set_index_rate";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_rate_index: parsed.data.rate_index,
      p_effective_date: parsed.data.effective_date,
      p_annual_rate_ppm: ppm,
    };
  } else if (name === "split_line") {
    const parsed = splitLineSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_split_line";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_transaction_id: parsed.data.transaction_id,
      p_parts: parsed.data.parts.map((part) => ({
        ...(part.category_id === undefined ? {} : { category_id: part.category_id }),
        project_id: part.project_id ?? null,
        ...(part.amount_minor === undefined ? {} : { amount_minor: part.amount_minor }),
        ...(part.percent === undefined ? {} : { percent: part.percent }),
        ...(part.rest === undefined ? {} : { rest: true }),
      })),
    };
  } else if (name === "set_line_pnl") {
    const parsed = setLinePnlSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_set_line_pnl";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_transaction_id: parsed.data.transaction_id,
      p_in_pnl: parsed.data.in_pnl,
    };
  } else if (name === "set_invoice_paid") {
    const parsed = setInvoicePaidSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_set_invoice_paid";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_transaction_id: parsed.data.transaction_id,
      p_paid: parsed.data.paid,
    };
  } else if (name === "set_jev_mode") {
    const parsed = setJevModeSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_set_jev_mode";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_enabled: parsed.data.enabled,
      p_mode: parsed.data.mode ?? null,
      p_threshold: parsed.data.threshold ?? null,
    };
  } else if (name === "undo_jev_prefill") {
    const parsed = undoJevPrefillSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_undo_jev_prefill";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_transaction_id: parsed.data.transaction_id,
    };
  } else if (name === "detach_loan_payment") {
    const parsed = detachLoanPaymentSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_detach_loan_payment";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_transaction_id: parsed.data.transaction_id,
    };
  } else if (name === "delete_loan") {
    const parsed = deleteLoanSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_delete_loan";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_loan_id: parsed.data.loan_id,
    };
  } else if (name === "reorder_loans") {
    const parsed = reorderLoansSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_reorder_loans";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_loan_ids: parsed.data.loan_ids,
    };
  } else if (name === "set_project_investment") {
    const parsed = setProjectInvestmentSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    // A key left out keeps its figure; a null clears it.
    const patch: Record<string, unknown> = {};
    for (const key of INVESTMENT_KEYS) {
      if (parsed.data[key] !== undefined) patch[key] = parsed.data[key];
    }
    rpcName = "mcp_set_project_investment";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_project_id: parsed.data.project_id,
      p_patch: patch,
    };
  } else if (name === "set_category_rehab") {
    const parsed = setCategoryRehabSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_set_category_rehab";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_category_id: parsed.data.category_id,
      p_rehab: parsed.data.rehab,
    };
  } else if (name === "delete_category") {
    const parsed = deleteCategorySchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_delete_category";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_category_id: parsed.data.category_id,
    };
  } else if (name === "move_category_lines") {
    const parsed = moveCategoryLinesSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_move_category_lines";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_from: parsed.data.from_category_id,
      p_into: parsed.data.into_category_id,
    };
  } else if (name === "rename_category") {
    const parsed = renameCategorySchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_rename_category";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_category_id: parsed.data.category_id,
      p_name: parsed.data.name,
    };
  } else if (name === "set_category_group") {
    const parsed = setCategoryGroupSchema.safeParse(args);
    if (!parsed.success) return invalid(parsed.error);
    rpcName = "mcp_set_category_group";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_category_id: parsed.data.category_id,
      p_group_name: parsed.data.group_name,
    };
  } else if (name === "set_company_currency") {
    const parsed = setCompanyCurrencySchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_set_company_currency";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_currency: parsed.data.currency,
    };
  } else if (name === "set_lines_pnl") {
    const parsed = setLinesPnlSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_set_lines_pnl";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_items: parsed.data.items,
    };
  } else if (name === "assign_expenses") {
    const parsed = assignExpensesSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_assign_expenses";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_items: parsed.data.items,
    };
  } else if (name === "undo_batch") {
    const parsed = undoBatchSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_undo_batch";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_batch_key: parsed.data.batch_key,
    };
  } else {
    const parsed = undoSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_kind: parsed.data.kind,
      p_id: parsed.data.id,
    };
  }
  const result = await rpc(rpcName, body);
  if (result.status >= 400) return fail("refused", WRITE_REFUSED);
  return envelopeOf(result.json);
}
