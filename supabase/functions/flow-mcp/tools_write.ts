// MCP tools: callWrite runs every write tool after its scope and argument checks.
// Split out of tools.ts (FLOW-807). Decision 0080.

import {
  argsOf,
  envelopeOf,
  fail,
  isCalendarDate,
  isFail,
  minorFromMajor,
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
  createProjectGroupSchema,
  createProjectSchema,
  createProjectsSchema,
  deleteCategorySchema,
  deleteLoanSchema,
  deleteProjectSchema,
  detachLoanPaymentSchema,
  hideCategorySchema,
  invalid,
  INVESTMENT_KEYS,
  moveCategoryLinesSchema,
  renameCategorySchema,
  renameCompanySchema,
  reorderLoansSchema,
  setCashBasisSchema,
  setCategoryCashSchema,
  setCategoryGroupSchema,
  setCategoryParentSchema,
  setCategoryPnlSchema,
  setCategoryRehabSchema,
  setCompanyCurrencySchema,
  setInvoicePaidSchema,
  invoiceBankWriteSchema,
  setJevModeSchema,
  setLineCashSchema,
  setLinePaceSchema,
  answerRecurringMatchSchema,
  reassignRecurringChargeSchema,
  setLineRecurringSchema,
  setLineUsualAmountSchema,
  setLinesCashSchema,
  setLinePnlSchema,
  setLinesPnlSchema,
  setIndexRateSchema,
  setLoanIndexSchema,
  setLoanRateSchema,
  setOverheadProjectSchema,
  setProjectGroupSchema,
  setProjectInvestmentSchema,
  syncBankSchema,
  undoBatchSchema,
  undoJevPrefillSchema,
  undoSchema,
  updateProjectSchema,
  WRITE_TOOL_NAMES,
} from "./tools_schemas.ts";
import { inviteMemberSchema, removeMemberSchema, setMemberRoleSchema } from "./tools_team_schemas.ts";
import { invalidDetail, splitLineSchema } from "./tools_split_schemas.ts";
import { addLoanWrite, attachLoanWrite, updateLoanWrite } from "./tools_loans.ts";
import { syncBank } from "./tools_sync.ts";
import { resetForecastSchema, setForecastItemSchema } from "./tools_forecast_schemas.ts";
import { attachDocumentSchema, createManualEntrySchema } from "./tools_manual_schemas.ts";
import { bookLineSchema } from "./tools_ledger_schemas.ts";
import { PROJECT_FORECAST_WRITES, projectForecastWrite } from "./tools_project_forecast.ts";
import { BANK_WRITES, bankWrite } from "./tools_bank.ts";
import { THREAD_WRITES, threadWrite } from "./tools_thread.ts";

/** The largest usual amount a charge takes, in minor units (decision 0189; the database checks it too). */
const USUAL_AMOUNT_MAX_MINOR = 999_999_999_999n;

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
  if ((PROJECT_FORECAST_WRITES as readonly string[]).includes(name)) {
    return projectForecastWrite(name as typeof PROJECT_FORECAST_WRITES[number], args, rpc);
  }
  if ((BANK_WRITES as readonly string[]).includes(name)) return bankWrite(name as typeof BANK_WRITES[number], args, rpc);
  if ((THREAD_WRITES as readonly string[]).includes(name)) return threadWrite(name as typeof THREAD_WRITES[number], args, rpc);
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
  } else if (name === "book_line") {
    // FLOW-948 (decision 0208): book a P&L line from balanced legs. The database validates the legs
    // balance, hit one bank leg, and land on the caller's own accounts; it writes the equivalent legacy
    // rows (a line, or a split through save_line_split) so the unchanged P&L reflects it. FLOW-950:
    // transaction_id books the caller's existing line instead (undo kind line_split).
    // FLOW-953 (decision 0210): legs may sit on asset and liability accounts; the database files each
    // as a kept-out category part, so the schema is unchanged.
    const parsed = bookLineSchema.safeParse(args);
    if (!parsed.success) return invalidDetail(parsed.error);
    rpcName = "mcp_book_line";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_doc_date: parsed.data.doc_date ?? null,
      p_direction: parsed.data.direction,
      p_currency: parsed.data.currency ?? null,
      p_description: parsed.data.description ?? null,
      p_legs: parsed.data.legs.map((leg) => ({
        account_id: leg.account_id,
        amount_minor: leg.amount_minor,
        ...(leg.project_id == null ? {} : { project_id: leg.project_id }),
      })),
      p_project_id: parsed.data.project_id ?? null,
      p_transaction_id: parsed.data.transaction_id ?? null,
    };
  } else if (name === "create_manual_entry") {
    // FLOW-369: the cash or cheque line. The database refuses another company's project or category.
    const parsed = createManualEntrySchema.safeParse(args);
    if (!parsed.success) return invalid(parsed.error);
    rpcName = "mcp_create_manual_entry";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_direction: parsed.data.direction,
      p_amount_minor: parsed.data.amount_minor,
      p_doc_date: parsed.data.doc_date,
      p_payee: parsed.data.payee,
      p_project_id: parsed.data.project_id ?? null,
      p_category_id: parsed.data.category_id,
      p_method: parsed.data.method,
      p_cheque_number: parsed.data.method === "cheque" ? parsed.data.cheque_number ?? null : null,
    };
  } else if (name === "attach_document") {
    // FLOW-369: one document on a line that exists. No line is made.
    const parsed = attachDocumentSchema.safeParse(args);
    if (!parsed.success) return invalid(parsed.error);
    rpcName = "mcp_attach_document";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_transaction_id: parsed.data.transaction_id,
      p_document: parsed.data.document,
    };
  } else if (name === "create_project") {
    const parsed = createProjectSchema.safeParse(args);
    if (!parsed.success) return invalid(parsed.error);
    rpcName = "mcp_create_project";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_name: parsed.data.name,
      ...(parsed.data.status == null ? {} : { p_status: parsed.data.status }),
      ...(parsed.data.type == null ? {} : { p_type: parsed.data.type }),
      ...(parsed.data.budget_minor == null ? {} : { p_budget_minor: parsed.data.budget_minor }),
    };
  } else if (name === "update_project") {
    // FLOW-445: only the fields the caller sent go in the patch; null clears type or budget.
    const parsed = updateProjectSchema.safeParse(args);
    if (!parsed.success) return invalid(parsed.error);
    rpcName = "mcp_update_project";
    const patch: Record<string, unknown> = {};
    for (const key of ["name", "type", "budget_minor", "status"] as const) {
      if (parsed.data[key] !== undefined) patch[key] = parsed.data[key];
    }
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_id: parsed.data.id,
      p_patch: patch,
    };
  } else if (name === "delete_project") {
    const parsed = deleteProjectSchema.safeParse(args);
    if (!parsed.success) return invalid(parsed.error);
    rpcName = "mcp_delete_project";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_id: parsed.data.id,
    };
  } else if (name === "set_forecast_item") {
    // FLOW-141: the patch holds only the fields the caller sent; reset goes alone.
    const parsed = setForecastItemSchema.safeParse(args);
    if (!parsed.success) return invalid(parsed.error);
    rpcName = "mcp_set_forecast_item";
    const patch: Record<string, unknown> = {};
    for (const key of ["amount_minor", "due_on", "moved_out"] as const) {
      if (parsed.data[key] !== undefined) patch[key] = parsed.data[key];
    }
    if (parsed.data.reset === true) patch.reset = true;
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_month: parsed.data.month,
      p_item_key: parsed.data.item_key,
      p_patch: patch,
    };
  } else if (name === "reset_forecast") {
    const parsed = resetForecastSchema.safeParse(args);
    if (!parsed.success) return invalid(parsed.error);
    rpcName = "mcp_reset_forecast";
    body = { p_idempotency_key: parsed.data.idempotency_key, p_month: parsed.data.month };
  } else if (name === "create_category") {
    const parsed = createCategorySchema.safeParse(args);
    if (!parsed.success) return invalid(parsed.error);
    rpcName = "mcp_create_category";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_name: parsed.data.name,
      p_kind: parsed.data.kind,
      ...(parsed.data.parent_id == null ? {} : { p_parent_id: parsed.data.parent_id }),
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
  } else if (name === "invite_member") {
    const parsed = inviteMemberSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_invite_member";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_email: parsed.data.email,
      p_role: parsed.data.role,
    };
  } else if (name === "set_member_role") {
    const parsed = setMemberRoleSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_set_member_role";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_user_id: parsed.data.member_id,
      p_role: parsed.data.role,
    };
  } else if (name === "remove_member") {
    const parsed = removeMemberSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_remove_member";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_user_id: parsed.data.member_id,
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
    if (!parsed.success) return invalidDetail(parsed.error);
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
        ...(part.gross_up ? { gross_up: true } : {}),
        ...(part.effect === undefined ? {} : { effect: part.effect }),
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
  } else if (name === "set_category_cash") {
    const parsed = setCategoryCashSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_set_category_cash";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_category_id: parsed.data.category_id,
      p_in_cash: parsed.data.in_cash,
    };
  } else if (name === "set_line_cash") {
    const parsed = setLineCashSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_set_line_cash";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_transaction_id: parsed.data.transaction_id,
      p_in_cash: parsed.data.in_cash,
    };
  } else if (name === "set_lines_cash") {
    const parsed = setLinesCashSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_set_lines_cash";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_items: parsed.data.items,
    };
  } else if (name === "set_cash_basis") {
    const parsed = setCashBasisSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_set_cash_basis";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_basis: parsed.data.basis,
    };
  } else if (name === "set_line_recurring") {
    const parsed = setLineRecurringSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_set_line_recurring";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_transaction_id: parsed.data.transaction_id,
      p_recurring: parsed.data.recurring,
      ...(parsed.data.project_id == null ? {} : { p_project_id: parsed.data.project_id }),
    };
  } else if (name === "set_line_pace") {
    const parsed = setLinePaceSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_set_line_pace";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_transaction_id: parsed.data.transaction_id,
      p_pace: parsed.data.pace,
      ...(parsed.data.project_id == null ? {} : { p_project_id: parsed.data.project_id }),
    };
  } else if (name === "set_line_usual_amount") {
    const parsed = setLineUsualAmountSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    const minor = parsed.data.amount == null ? null : minorFromMajor(parsed.data.amount);
    if (minor != null && typeof minor !== "bigint") return minor;
    if (minor != null && minor > USUAL_AMOUNT_MAX_MINOR) return fail("validation", "validation");
    rpcName = "mcp_set_line_usual_amount";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_transaction_id: parsed.data.transaction_id,
      p_amount_minor: minor == null ? null : Number(minor),
      ...(parsed.data.project_id == null ? {} : { p_project_id: parsed.data.project_id }),
    };
  } else if (name === "answer_recurring_match") {
    const parsed = answerRecurringMatchSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_answer_recurring_match";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_direction: parsed.data.direction,
      p_party_id: parsed.data.party_id,
      p_match_party_id: parsed.data.match_party_id,
      p_same: parsed.data.same,
    };
  } else if (name === "reassign_recurring_charge") {
    const parsed = reassignRecurringChargeSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_reassign_recurring_charge";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_direction: parsed.data.direction,
      p_party_id: parsed.data.party_id,
      p_currency: parsed.data.currency,
      p_charge_project_id: parsed.data.charge_project_id ?? null,
      p_project_id: parsed.data.project_id ?? null,
      p_category_id: parsed.data.category_id ?? null,
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
  } else if (name === "link_invoice_payment" || name === "dismiss_invoice_match") {
    const parsed = invoiceBankWriteSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = name === "link_invoice_payment" ? "mcp_link_invoice_payment" : "mcp_dismiss_invoice_match";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_invoice_id: parsed.data.invoice_id,
      p_transaction_id: parsed.data.transaction_id,
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
  } else if (name === "set_category_parent") {
    const parsed = setCategoryParentSchema.safeParse(args);
    if (!parsed.success) return invalid(parsed.error);
    rpcName = "mcp_set_category_parent";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_category_id: parsed.data.category_id,
      p_parent_id: parsed.data.parent_id,
    };
  } else if (name === "create_project_group") {
    const parsed = createProjectGroupSchema.safeParse(args);
    if (!parsed.success) return invalid(parsed.error);
    rpcName = "mcp_create_project_group";
    body = { p_idempotency_key: parsed.data.idempotency_key, p_name: parsed.data.name };
  } else if (name === "set_project_group") {
    const parsed = setProjectGroupSchema.safeParse(args);
    if (!parsed.success) return invalid(parsed.error);
    rpcName = "mcp_set_project_group";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_project_id: parsed.data.project_id,
      p_group_id: parsed.data.group_id,
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
    if (!parsed.success) return invalidDetail(parsed.error);
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
