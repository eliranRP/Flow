// MCP tools: the read and write tool names, the scope allowlist and the zod schemas for write arguments.
// Split out of tools.ts (FLOW-807). Decision 0080.

import { z } from "zod";
import { LOAN_TERM_MONTHS_MAX, type LoanKind } from "../../../packages/shared/src/loan-schedule.ts";
import { DATE, fail, isCalendarDate, type ToolResult, UUID } from "./tools_args.ts";

export const READ_TOOL_NAMES = [
  "list_projects",
  "get_project",
  "get_project_categories",
  "list_categories",
  "list_review",
  "get_expense",
  "search_expenses",
  "get_totals",
  "list_loans",
  "get_loan_schedule",
  "get_sync_status",
  "get_breakdown",
  "get_jev_status",
  "get_jev_accuracy",
  "get_profit_months",
  "get_anomalies",
  "get_jev_suggestions",
  "get_missing_bills",
  "get_expected_months",
  "list_unpaid",
] as const;

/** Read tool that a write-only token may also call: it polls that token's own sync job. */
export const SYNC_STATUS_TOOL = "get_sync_status";

export const WRITE_TOOL_NAMES = [
  "assign_expense",
  "assign_expense_split",
  "assign_expenses",
  "set_expense_category",
  "create_project",
  "create_category",
  "create_projects",
  "create_categories",
  "sync_bank",
  "hide_category",
  "set_category_pnl",
  "set_overhead_project",
  "rename_company",
  "add_loan",
  "update_loan",
  "attach_loan_payment",
  "set_loan_rate",
  "set_loan_index",
  "set_index_rate",
  "split_line",
  "set_line_pnl",
  "set_lines_pnl",
  "set_invoice_paid",
  "detach_loan_payment",
  "delete_loan",
  "reorder_loans",
  "set_project_investment",
  "set_category_rehab",
  "delete_category",
  "move_category_lines",
  "set_company_currency",
  "rename_category",
  "set_category_group",
  "set_jev_mode",
  "undo_jev_prefill",
  "undo",
  "undo_batch",
] as const;
export const ALLOWED: Record<string, Set<string>> = {
  list_projects: new Set(["from", "to", "basis"]),
  get_project: new Set(["id", "basis", "from", "to"]),
  get_project_categories: new Set(["id", "months"]),
  list_categories: new Set(),
  list_review: new Set(["direction", "reason", "supplier", "query", "from", "to", "limit", "offset"]),
  get_expense: new Set(["transaction_id"]),
  search_expenses: new Set(["scope", "query", "limit", "offset", "from", "to", "project_id", "category_id", "direction", "amount", "amount_min", "amount_max"]),
  get_totals: new Set(["from", "to", "basis"]),
  list_loans: new Set(["include_closed"]),
  get_loan_schedule: new Set(["loan_id", "from", "limit", "as_of"]),
  get_sync_status: new Set(["job_id"]),
  get_breakdown: new Set(["direction", "from", "to", "group_by", "basis", "group", "currency", "excluded", "limit", "offset"]),
  get_jev_status: new Set(),
  get_jev_accuracy: new Set(["from", "to"]),
  get_profit_months: new Set(["from", "to", "basis", "project_id"]),
  get_anomalies: new Set(),
  get_jev_suggestions: new Set(),
  get_missing_bills: new Set(),
  get_expected_months: new Set(["months", "project_id"]),
  list_unpaid: new Set(),
  assign_expense: new Set(["idempotency_key", "transaction_id", "project_id", "category_id", "remember"]),
  assign_expense_split: new Set(["idempotency_key", "transaction_id", "category_id", "shares"]),
  assign_expenses: new Set(["idempotency_key", "items"]),
  set_expense_category: new Set(["idempotency_key", "transaction_id", "category_id"]),
  create_project: new Set(["idempotency_key", "name", "status"]),
  create_category: new Set(["idempotency_key", "name", "kind"]),
  create_projects: new Set(["idempotency_key", "items"]),
  create_categories: new Set(["idempotency_key", "items"]),
  sync_bank: new Set(["idempotency_key"]),
  hide_category: new Set(["idempotency_key", "category_id"]),
  set_category_pnl: new Set(["idempotency_key", "category_id", "excluded"]),
  set_overhead_project: new Set(["idempotency_key", "project_id"]),
  rename_company: new Set(["idempotency_key", "name"]),
  add_loan: new Set([
    "idempotency_key", "name", "principal", "annual_rate_percent", "term_months",
    "start_date", "payment", "escrow", "currency", "project_id",
    "kind", "interest_only_months", "amortization_months",
  ]),
  update_loan: new Set(["idempotency_key", "loan_id", "name", "principal", "annual_rate_percent", "term_months", "start_date", "payment", "escrow", "project_id", "status", "closed_on", "interest_category_id", "escrow_category_id", "principal_category_id", "fees_category_id", "kind", "interest_only_months", "amortization_months"]),
  attach_loan_payment: new Set(["idempotency_key", "transaction_id", "loan_id", "installments", "fees", "parts", "fees_category_id"]),
  set_loan_rate: new Set(["idempotency_key", "loan_id", "effective_date", "annual_rate_percent"]),
  set_loan_index: new Set(["idempotency_key", "loan_id", "rate_index", "margin_percent"]),
  set_index_rate: new Set(["idempotency_key", "rate_index", "effective_date", "annual_rate_percent"]),
  split_line: new Set(["idempotency_key", "transaction_id", "parts"]),
  set_line_pnl: new Set(["idempotency_key", "transaction_id", "in_pnl"]),
  set_lines_pnl: new Set(["idempotency_key", "items"]),
  set_invoice_paid: new Set(["idempotency_key", "transaction_id", "paid"]),
  detach_loan_payment: new Set(["idempotency_key", "transaction_id"]),
  delete_loan: new Set(["idempotency_key", "loan_id"]),
  reorder_loans: new Set(["idempotency_key", "loan_ids"]),
  set_project_investment: new Set(["idempotency_key", "project_id", "currency", "purchase_minor", "arv_minor", "value_minor", "value_date"]),
  set_category_rehab: new Set(["idempotency_key", "category_id", "rehab"]),
  delete_category: new Set(["idempotency_key", "category_id"]),
  move_category_lines: new Set(["idempotency_key", "from_category_id", "into_category_id"]),
  set_company_currency: new Set(["idempotency_key", "currency"]),
  rename_category: new Set(["idempotency_key", "category_id", "name"]),
  set_category_group: new Set(["idempotency_key", "category_id", "group_name"]),
  set_jev_mode: new Set(["idempotency_key", "enabled", "mode", "threshold"]),
  undo_jev_prefill: new Set(["idempotency_key", "transaction_id"]),
  undo: new Set(["idempotency_key", "kind", "id"]),
  undo_batch: new Set(["idempotency_key", "batch_key"]),
};
// Any case is accepted; the database compares ids in lower case (FLOW-205).
const UUID_TEXT = z.string().regex(UUID).transform((id) => id.toLowerCase());
const IDEMPOTENCY_KEY = z.string().min(1).max(128);
// A batch key leaves room for ":" and a three-digit ordinal on each row key.
const BATCH_KEY = z.string().min(1).max(124);
export const assignSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  transaction_id: UUID_TEXT,
  // Optional: a line under a kept-out category needs no project (the RPC checks it).
  project_id: UUID_TEXT.nullable().optional(),
  category_id: UUID_TEXT,
  remember: z.boolean().optional(),
}).strict();
// A share is a whole percent (share) or, since FLOW-346, an exact amount_minor (cents).
const splitShareSchema = z.object({
  project_id: UUID_TEXT,
  share: z.number().int().min(1).max(100).optional(),
  amount_minor: z.number().int().min(1).max(99_999_999_999_999).optional(),
}).strict().refine((item) => (item.share === undefined) !== (item.amount_minor === undefined));
const SPLIT_SHARES = z.array(splitShareSchema).min(2).max(50);
// Projects are unique, and every share is one kind: whole percents that sum to 100, or exact
// amounts (the database checks that they sum to the line).
function sharesAreValid(shares: { project_id: string; share?: number; amount_minor?: number }[]): boolean {
  const seen = new Set<string>();
  let total = 0;
  for (const item of shares) {
    const id = item.project_id.toLowerCase();
    if (seen.has(id)) return false;
    seen.add(id);
    total += item.share ?? 0;
  }
  const amounts = shares.filter((item) => item.amount_minor !== undefined).length;
  if (amounts > 0) return amounts === shares.length;
  return total === 100;
}
export const assignExpenseSplitSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  transaction_id: UUID_TEXT,
  category_id: UUID_TEXT.optional(),
  shares: SPLIT_SHARES,
}).strict().superRefine((body, ctx) => {
  if (!sharesAreValid(body.shares)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom });
  }
});
// Each part gives exactly one of amount_minor (cents), percent (of the whole line, up to 4
// decimals) or rest: true (what the other parts leave). Only a rest part may omit
// category_id: it then keeps the line's own category.
const linePartSchema = z.object({
  category_id: UUID_TEXT.optional(),
  project_id: UUID_TEXT.nullable().optional(),
  amount_minor: z.number().int().min(1).max(999_999_999_999_999).optional(),
  percent: z.number().gt(0).max(100).refine((n) => Math.round(n * 10000) / 10000 === n).optional(),
  rest: z.literal(true).optional(),
}).strict().refine((part) =>
  [part.amount_minor, part.percent, part.rest].filter((v) => v !== undefined).length === 1 &&
  (part.rest === true || part.category_id !== undefined)
);
// Two to 50 parts, or none to clear the split. A category and project pair appears once, and
// at most one part is the rest. The database rounds percents and checks the sum.
// Two to 50 parts (or none, to clear), at most one rest, and a category and project pair once.
function linePartsAreValid(parts: z.infer<typeof linePartSchema>[]): boolean {
  if (parts.length === 1 || parts.length > 50) return false;
  if (parts.filter((part) => part.rest).length > 1) return false;
  const seen = new Set<string>();
  for (const part of parts) {
    if (part.category_id === undefined) continue;
    const pair = `${part.category_id.toLowerCase()}|${(part.project_id ?? "").toLowerCase()}`;
    if (seen.has(pair)) return false;
    seen.add(pair);
  }
  return true;
}
export const splitLineSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  transaction_id: UUID_TEXT,
  parts: z.array(linePartSchema),
}).strict().superRefine((body, ctx) => {
  if (!linePartsAreValid(body.parts)) ctx.addIssue({ code: z.ZodIssueCode.custom });
});
export const categorySchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  transaction_id: UUID_TEXT,
  category_id: UUID_TEXT,
}).strict();
export const undoSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  kind: z.enum(["review", "reassign", "project", "category", "category_hidden", "category_pnl", "loan", "loan_update", "loan_split", "overhead_project", "company", "line_split", "line_pnl", "loan_rate", "invoice_paid", "loan_detach", "loan_delete", "loan_order", "project_investment", "category_rehab", "category_delete", "category_move", "company_currency", "category_name", "category_group", "jev_mode", "loan_index", "index_rate"]),
  id: UUID_TEXT,
}).strict();
// Control characters, line/paragraph separators, every format character (zero-width,
// bidi marks and controls incl. U+061C, BOM, soft hyphen, tag characters) and blank
// fillers make two names look the same. ZWJ (U+200D) stays for emoji sequences.
// SQL private.name_has_hidden_char spells out the same set (migration 20261010160000).
const HIDDEN_CHARS = /[\p{Cc}\p{Zl}\p{Zp}\u034f\u115f\u1160\u3164\uffa0]|(?!\u200d)\p{Cf}/u;
// No-break and other wide spaces inside a name become a plain space (SQL private.plain_spaces).
const WIDE_SPACES = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/gu;
/** The validation message for a refused name, so a client knows to strip a pasted mark. */
const HIDDEN_NAME = "name has an invisible or control character";
function plainSpaces(name: string): string {
  return name.replace(WIDE_SPACES, " ");
}
// Same rule as private.company_name_problem: 2 to 100 code points after trim()
// (SQL private.trim_name strips the same whitespace) and no hidden character.
function companyNameIsValid(name: string): boolean {
  const points = Array.from(name);
  return points.length >= 2 && points.length <= 100;
}
export const renameCompanySchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  name: z.string().trim().transform(plainSpaces)
    .refine((name) => !HIDDEN_CHARS.test(name), { message: HIDDEN_NAME })
    .refine(companyNameIsValid),
}).strict();
function visibleName(min: number, max: number) {
  return z.string().trim().min(min).max(max).transform(plainSpaces)
    .refine((name) => !HIDDEN_CHARS.test(name), { message: HIDDEN_NAME });
}
/** `validation`, naming the hidden-character rule when that is what failed. */
export function invalid(error: z.ZodError): ToolResult {
  return fail("validation", error.issues.some((issue) => issue.message === HIDDEN_NAME) ? HIDDEN_NAME : "validation");
}
const LOAN_NAME = visibleName(1, 80);
const LOAN_CURRENCY = z.string().regex(/^[A-Z]{3}$/);
const LOAN_KIND = z.enum(["amortizing", "interest_only", "balloon", "demand"]);
const LOAN_MONTHS = z.number().int().min(1).max(LOAN_TERM_MONTHS_MAX);
/**
 * The kind fields go together (decision 0132): interest_only_months only with interest_only,
 * amortization_months only with balloon, and a demand loan has no term, payment or escrow.
 */
function kindFieldsFit(body: {
  kind?: LoanKind;
  term_months?: number;
  payment?: unknown;
  escrow?: unknown;
  interest_only_months?: number | null;
  amortization_months?: number | null;
}): boolean {
  const kind = body.kind ?? "amortizing";
  if ((kind === "interest_only") !== (body.interest_only_months != null)) return false;
  if ((kind === "balloon") !== (body.amortization_months != null)) return false;
  if (kind === "demand") return body.term_months === undefined && body.payment === undefined && body.escrow === undefined;
  return body.term_months !== undefined;
}
export const addLoanSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  name: LOAN_NAME,
  principal: z.union([z.number(), z.string()]),
  annual_rate_percent: z.union([z.number(), z.string()]),
  // Required unless kind is demand, which has none.
  term_months: LOAN_MONTHS.optional(),
  start_date: z.string().regex(DATE),
  payment: z.union([z.number(), z.string()]).optional(),
  escrow: z.union([z.number(), z.string()]).optional(),
  currency: LOAN_CURRENCY.optional(),
  project_id: UUID_TEXT.optional(),
  kind: LOAN_KIND.optional(),
  interest_only_months: LOAN_MONTHS.optional(),
  amortization_months: LOAN_MONTHS.optional(),
}).strict().superRefine((body, ctx) => {
  if (!kindFieldsFit(body)) ctx.addIssue({ code: z.ZodIssueCode.custom });
});
export const updateLoanSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  loan_id: UUID_TEXT,
  name: LOAN_NAME.optional(),
  principal: z.union([z.number(), z.string()]).optional(),
  annual_rate_percent: z.union([z.number(), z.string()]).optional(),
  term_months: z.number().int().min(1).max(LOAN_TERM_MONTHS_MAX).optional(),
  start_date: z.string().regex(DATE).optional(),
  payment: z.union([z.number(), z.string()]).optional(),
  escrow: z.union([z.number(), z.string()]).optional(),
  // null clears the project, an absent key leaves it.
  project_id: UUID_TEXT.nullable().optional(),
  status: z.enum(["open", "paid_off", "closed"]).optional(),
  // null clears the date (status open does too), an absent key leaves it.
  closed_on: z.string().regex(DATE).nullable().optional(),
  // A part's own category; null goes back to the default, an absent key leaves it.
  interest_category_id: UUID_TEXT.nullable().optional(),
  escrow_category_id: UUID_TEXT.nullable().optional(),
  principal_category_id: UUID_TEXT.nullable().optional(),
  fees_category_id: UUID_TEXT.nullable().optional(),
  // The kind and its own field (decision 0132). A kind change clears the other kind's field;
  // demand also clears the term, payment and escrow.
  kind: LOAN_KIND.optional(),
  interest_only_months: LOAN_MONTHS.optional(),
  amortization_months: LOAN_MONTHS.optional(),
}).strict().superRefine((body, ctx) => {
  if (body.interest_only_months !== undefined && body.kind !== undefined && body.kind !== "interest_only") {
    ctx.addIssue({ code: z.ZodIssueCode.custom });
  }
  if (body.amortization_months !== undefined && body.kind !== undefined && body.kind !== "balloon") {
    ctx.addIssue({ code: z.ZodIssueCode.custom });
  }
  if (body.kind === "interest_only" && body.interest_only_months === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom });
  if (body.kind === "balloon" && body.amortization_months === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom });
  if (body.kind === "demand" && (body.term_months !== undefined || body.payment !== undefined || body.escrow !== undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom });
  }
});
export const setLoanRateSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  loan_id: UUID_TEXT,
  effective_date: z.string().regex(DATE),
  // null removes the rate row for that date.
  annual_rate_percent: z.union([z.number(), z.string()]).nullable(),
}).strict();
/** FLOW-137 (decision 0160): the indexes a loan's rate can follow. */
export const RATE_INDEXES = ["il_prime"] as const;
export const setLoanIndexSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  loan_id: UUID_TEXT,
  // null with a null margin unlinks the loan.
  rate_index: z.enum(RATE_INDEXES).nullable(),
  margin_percent: z.union([z.number(), z.string()]).nullable(),
}).strict();
export const setIndexRateSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  rate_index: z.enum(RATE_INDEXES),
  effective_date: z.string().regex(DATE),
  annual_rate_percent: z.union([z.number(), z.string()]),
}).strict();
const LOAN_MONEY = z.union([z.number(), z.string()]);
/** Installments one payment may cover (decision 0130). */
const LOAN_INSTALLMENTS_MAX = 12;
export const attachLoanSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  transaction_id: UUID_TEXT,
  loan_id: UUID_TEXT,
  installments: z.number().int().min(1).max(LOAN_INSTALLMENTS_MAX).optional(),
  fees: LOAN_MONEY.optional(),
  // The exact split, used as given. It cannot be combined with installments or fees.
  parts: z.object({
    interest: LOAN_MONEY,
    escrow: LOAN_MONEY,
    principal: LOAN_MONEY,
    fees: LOAN_MONEY.optional(),
  }).strict().optional(),
  // This payment's fees category; only with fees (top-level or in parts).
  fees_category_id: UUID_TEXT.optional(),
}).strict().superRefine((body, ctx) => {
  if (body.parts !== undefined && (body.installments !== undefined || body.fees !== undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom });
  }
  if (body.fees_category_id !== undefined && body.fees === undefined && body.parts?.fees === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom });
  }
});
export const createProjectSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  name: visibleName(2, 120),
  status: z.enum(["active", "finished"]).optional(),
}).strict();
export const createCategorySchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  name: visibleName(2, 120),
  kind: z.enum(["expense", "income"]),
}).strict();
// A setup batch: up to 100 rows, a name at most once (per kind for categories).
const PROJECT_ROW = z.object({
  name: visibleName(2, 120),
  status: z.enum(["active", "finished"]).optional(),
}).strict();
const CATEGORY_ROW = z.object({
  name: visibleName(2, 120),
  kind: z.enum(["expense", "income"]),
}).strict();
function uniqueRows<T>(keyOf: (row: T) => string) {
  return (body: { items: T[] }, ctx: z.RefinementCtx) => {
    const seen = new Set<string>();
    for (const item of body.items) {
      const key = keyOf(item);
      if (seen.has(key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom });
        return;
      }
      seen.add(key);
    }
  };
}
export const createProjectsSchema = z.object({
  idempotency_key: BATCH_KEY,
  items: z.array(PROJECT_ROW).min(1).max(100),
}).strict().superRefine(uniqueRows<z.infer<typeof PROJECT_ROW>>((row) => row.name));
export const createCategoriesSchema = z.object({
  idempotency_key: BATCH_KEY,
  items: z.array(CATEGORY_ROW).min(1).max(100),
}).strict().superRefine(uniqueRows<z.infer<typeof CATEGORY_ROW>>((row) => `${row.kind}|${row.name}`));
export const syncBankSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
}).strict();
export const hideCategorySchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  category_id: UUID_TEXT,
}).strict();
export const setCategoryPnlSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  category_id: UUID_TEXT,
  excluded: z.boolean(),
}).strict();
export const setOverheadProjectSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  project_id: UUID_TEXT.nullable(),
}).strict();
const batchItemSchema = z.object({
  transaction_id: UUID_TEXT,
  project_id: UUID_TEXT.optional(),
  category_id: UUID_TEXT.optional(),
  remember: z.boolean().optional(),
  shares: SPLIT_SHARES.optional(),
  parts: z.array(linePartSchema).optional(),
}).strict().superRefine((item, ctx) => {
  if (item.parts != null) {
    // A split_line row takes only transaction_id and parts[] (FLOW-312).
    if (
      item.shares != null || item.project_id != null || item.category_id != null ||
      item.remember != null || !linePartsAreValid(item.parts)
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom });
    }
    return;
  }
  if (item.shares != null) {
    // A split row names its projects in shares[]; category_id is optional like assign_expense_split.
    if (item.project_id != null || item.remember != null || !sharesAreValid(item.shares)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom });
    }
    return;
  }
  if (item.project_id == null && item.category_id == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom });
  }
  if (item.project_id != null && item.category_id == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom });
  }
  // remember saves a project for the supplier, so a category-only row can't take it (FLOW-205).
  if (item.project_id == null && item.remember === true) {
    ctx.addIssue({ code: z.ZodIssueCode.custom });
  }
});
export const assignExpensesSchema = z.object({
  idempotency_key: BATCH_KEY,
  items: z.array(batchItemSchema).min(1).max(200),
}).strict().superRefine((body, ctx) => {
  const seen = new Set<string>();
  for (const item of body.items) {
    if (seen.has(item.transaction_id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom });
      return;
    }
    seen.add(item.transaction_id);
  }
});
// in_pnl false takes the line out of the P&L, true counts it, null follows its category.
export const setLinePnlSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  transaction_id: UUID_TEXT,
  in_pnl: z.boolean().nullable(),
}).strict();
export const setLinesPnlSchema = z.object({
  idempotency_key: BATCH_KEY,
  items: z.array(z.object({
    transaction_id: UUID_TEXT,
    in_pnl: z.boolean().nullable(),
  }).strict()).min(1).max(200),
}).strict().superRefine((body, ctx) => {
  const seen = new Set<string>();
  for (const item of body.items) {
    if (seen.has(item.transaction_id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom });
      return;
    }
    seen.add(item.transaction_id);
  }
});
export const setInvoicePaidSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  transaction_id: UUID_TEXT,
  paid: z.boolean(),
}).strict();
export const undoJevPrefillSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  transaction_id: UUID_TEXT,
}).strict();
export const detachLoanPaymentSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  transaction_id: UUID_TEXT,
}).strict();
export const deleteLoanSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  loan_id: UUID_TEXT,
}).strict();
export const reorderLoansSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  loan_ids: z.array(UUID_TEXT).min(1).max(200),
}).strict();
const INVESTMENT_AMOUNT = z.number().int().min(0).max(999_999_999_999_999);
export const INVESTMENT_KEYS = ["currency", "purchase_minor", "arv_minor", "value_minor", "value_date"] as const;
export const setProjectInvestmentSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  project_id: UUID_TEXT,
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  purchase_minor: INVESTMENT_AMOUNT.nullable().optional(),
  arv_minor: INVESTMENT_AMOUNT.nullable().optional(),
  value_minor: INVESTMENT_AMOUNT.nullable().optional(),
  value_date: z.string().refine((v) => isCalendarDate(v)).nullable().optional(),
}).strict().refine((v) => INVESTMENT_KEYS.some((k) => v[k] !== undefined));
export const setCategoryRehabSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  category_id: UUID_TEXT,
  rehab: z.boolean().nullable(),
}).strict();
export const deleteCategorySchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  category_id: UUID_TEXT,
}).strict();
export const moveCategoryLinesSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  from_category_id: UUID_TEXT,
  into_category_id: UUID_TEXT,
}).strict();
export const renameCategorySchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  category_id: UUID_TEXT,
  name: visibleName(2, 120),
}).strict();
export const setJevModeSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  enabled: z.boolean(),
  mode: z.enum(["off", "shadow", "auto"]).optional(),
  threshold: z.number().min(0.5).max(1).optional(),
}).strict();
export const setCategoryGroupSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  category_id: UUID_TEXT,
  group_name: z.string().trim().max(40).transform(plainSpaces)
    .refine((name) => !HIDDEN_CHARS.test(name), { message: HIDDEN_NAME }).nullable(),
}).strict();
export const setCompanyCurrencySchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  currency: z.string().regex(/^[A-Z]{3}$/),
}).strict();
export const undoBatchSchema = z.object({
  idempotency_key: BATCH_KEY,
  batch_key: UUID_TEXT,
}).strict();
