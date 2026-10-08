// Cycle 2 reads, cycle 3a single-expense writes, cycle 4 project/category/sync, cycle 5 loans, cycle 6 batch. Decision 0080.
// sync_bank starts a job and get_sync_status reads it. Decision 0102.
// Identity is not an argument. The handler signs from the credential row.
// Zod checks write arguments. A failure is the fixed validation message.

import { z } from "zod";
import { MERCURY_SYNC_FUNCTION } from "../_shared/connectors/mercury/capabilities.ts";
import {
  buildLoanSchedule,
  demandAccrual,
  demandStatement,
  LoanScheduleError,
  LOAN_TERM_MONTHS_MAX,
  regularPaymentMinor,
  type DemandPayment,
  type LoanKind,
  type LoanRate,
  type LoanScheduleRow,
} from "../../../packages/shared/src/loan-schedule.ts";
import {
  allocateLoanSplitWithFees,
  firstUnpaidRowIndex,
  loanTakesPaymentOn,
  paidInterestAndPrincipal,
  scheduleRowForDate,
  sumScheduleRows,
} from "../../../packages/shared/src/loan-split.ts";
import type { LoanSplitAmount, LoanStatus, ScheduledSum } from "../../../packages/shared/src/loan-split.ts";
import { parseDecimalHalfEven } from "../../../packages/shared/src/money.ts";

export const READ_TOOL_NAMES = [
  "list_projects",
  "get_project",
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
  "split_line",
  "set_line_pnl",
  "set_lines_pnl",
  "undo",
  "undo_batch",
] as const;

const IDENTITY = new Set(["user_id", "p_user", "company_id", "sub", "mcp_tid"]);
const READ_REFUSED = "The read was refused.";
const WRITE_REFUSED = "The write was refused.";
const TOOL_CODES = new Set(["forbidden", "validation", "not_found", "conflict", "already_closed", "refused", "unavailable"]);
const ALLOWED: Record<string, Set<string>> = {
  list_projects: new Set(["from", "to", "basis"]),
  get_project: new Set(["id", "basis", "from", "to"]),
  list_categories: new Set(),
  list_review: new Set(["direction", "reason", "supplier", "query", "from", "to", "limit", "offset"]),
  get_expense: new Set(["transaction_id"]),
  search_expenses: new Set(["scope", "query", "limit", "offset"]),
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
  split_line: new Set(["idempotency_key", "transaction_id", "parts"]),
  set_line_pnl: new Set(["idempotency_key", "transaction_id", "in_pnl"]),
  set_lines_pnl: new Set(["idempotency_key", "items"]),
  undo: new Set(["idempotency_key", "kind", "id"]),
  undo_batch: new Set(["idempotency_key", "batch_key"]),
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Any case is accepted; the database compares ids in lower case (FLOW-205).
const UUID_TEXT = z.string().regex(UUID).transform((id) => id.toLowerCase());
const IDEMPOTENCY_KEY = z.string().min(1).max(128);
// A batch key leaves room for ":" and a three-digit ordinal on each row key.
const BATCH_KEY = z.string().min(1).max(124);
const assignSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  transaction_id: UUID_TEXT,
  // Optional: a line under a kept-out category needs no project (the RPC checks it).
  project_id: UUID_TEXT.nullable().optional(),
  category_id: UUID_TEXT,
  remember: z.boolean().optional(),
}).strict();
const splitShareSchema = z.object({
  project_id: UUID_TEXT,
  share: z.number().int().min(1).max(100),
}).strict();
const SPLIT_SHARES = z.array(splitShareSchema).min(2).max(50);
// Projects are unique and the whole percents sum to 100.
function sharesAreValid(shares: { project_id: string; share: number }[]): boolean {
  const seen = new Set<string>();
  let total = 0;
  for (const item of shares) {
    if (seen.has(item.project_id)) return false;
    seen.add(item.project_id);
    total += item.share;
  }
  return total === 100;
}
const assignExpenseSplitSchema = z.object({
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
const splitLineSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  transaction_id: UUID_TEXT,
  parts: z.array(linePartSchema),
}).strict().superRefine((body, ctx) => {
  if (!linePartsAreValid(body.parts)) ctx.addIssue({ code: z.ZodIssueCode.custom });
});
const categorySchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  transaction_id: UUID_TEXT,
  category_id: UUID_TEXT,
}).strict();
const undoSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  kind: z.enum(["review", "reassign", "project", "category", "category_hidden", "category_pnl", "loan", "loan_update", "loan_split", "overhead_project", "company", "line_split", "line_pnl", "loan_rate"]),
  id: UUID_TEXT,
}).strict();
// Same rule as private.company_name_problem: 2 to 100 code points after trim()
// (SQL private.trim_name strips the same whitespace) and no control character.
function companyNameIsValid(name: string): boolean {
  const points = Array.from(name);
  if (points.length < 2 || points.length > 100) return false;
  return points.every((point) => {
    const code = point.codePointAt(0) ?? 0;
    return code >= 0x20 && (code < 0x7f || code > 0x9f);
  });
}
const renameCompanySchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  name: z.string().trim().refine(companyNameIsValid),
}).strict();
// Control characters, line/paragraph separators, every format character (zero-width,
// bidi marks and controls incl. U+061C, BOM, soft hyphen, tag characters) and blank
// fillers make two names look the same. ZWJ (U+200D) stays for emoji sequences.
const HIDDEN_CHARS = /[\p{Cc}\p{Zl}\p{Zp}\u034f\u115f\u1160\u3164\uffa0]|(?!\u200d)\p{Cf}/u;
function visibleName(min: number, max: number) {
  return z.string().trim().min(min).max(max).refine((name) => !HIDDEN_CHARS.test(name));
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
const addLoanSchema = z.object({
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
const updateLoanSchema = z.object({
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
const setLoanRateSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  loan_id: UUID_TEXT,
  effective_date: z.string().regex(DATE),
  // null removes the rate row for that date.
  annual_rate_percent: z.union([z.number(), z.string()]).nullable(),
}).strict();
const LOAN_MONEY = z.union([z.number(), z.string()]);
/** Installments one payment may cover (decision 0130). */
const LOAN_INSTALLMENTS_MAX = 12;
const attachLoanSchema = z.object({
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
const createProjectSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  name: visibleName(2, 120),
  status: z.enum(["active", "finished"]).optional(),
}).strict();
const createCategorySchema = z.object({
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
const createProjectsSchema = z.object({
  idempotency_key: BATCH_KEY,
  items: z.array(PROJECT_ROW).min(1).max(100),
}).strict().superRefine(uniqueRows<z.infer<typeof PROJECT_ROW>>((row) => row.name));
const createCategoriesSchema = z.object({
  idempotency_key: BATCH_KEY,
  items: z.array(CATEGORY_ROW).min(1).max(100),
}).strict().superRefine(uniqueRows<z.infer<typeof CATEGORY_ROW>>((row) => `${row.kind}|${row.name}`));
const syncBankSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
}).strict();
const hideCategorySchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  category_id: UUID_TEXT,
}).strict();
const setCategoryPnlSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  category_id: UUID_TEXT,
  excluded: z.boolean(),
}).strict();
const setOverheadProjectSchema = z.object({
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
const assignExpensesSchema = z.object({
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
const setLinePnlSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  transaction_id: UUID_TEXT,
  in_pnl: z.boolean().nullable(),
}).strict();
const setLinesPnlSchema = z.object({
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
const undoBatchSchema = z.object({
  idempotency_key: BATCH_KEY,
  batch_key: UUID_TEXT,
}).strict();

export type ToolRpc = (name: string, body: Record<string, unknown>) => Promise<{ status: number; json: unknown }>;
export type ToolInvoke = (fn: string, body: Record<string, unknown>) => Promise<{ status: number; json: unknown }>;
/** Keeps work running after the response is sent (EdgeRuntime.waitUntil). */
export type ToolDefer = (work: Promise<unknown>) => void;

type ToolResult = {
  isError: boolean;
  structuredContent: { ok: true; data: unknown } | { ok: false; error: { code: string; message: string } };
};

function fail(code: string, message: string): ToolResult {
  return { isError: true, structuredContent: { ok: false, error: { code, message } } };
}

function ok(data: unknown): ToolResult {
  return { isError: false, structuredContent: { ok: true, data } };
}

function argsOf(input: unknown, allowed: Set<string>): Record<string, unknown> | ToolResult {
  if (input == null) return {};
  if (typeof input !== "object" || Array.isArray(input)) return fail("validation", "validation");
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (IDENTITY.has(key) || !allowed.has(key)) return fail("validation", "validation");
  }
  return record;
}

function isFail(value: Record<string, unknown> | ToolResult): value is ToolResult {
  return "isError" in value;
}

function limitOf(value: unknown, fallback: number): number | ToolResult {
  if (value == null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) {
    return fail("validation", "validation");
  }
  return value;
}

/** FLOW-304. A line's bank details. Every field is null when the provider gave none. */
const NO_LINE_META = {
  method: null,
  card_last4: null,
  memo: null,
  account: null,
  counterparty: null,
  bank_description: null,
} as const;

/**
 * Bank details for these ledger ids, keyed by id. A failed read fails the tool, so a
 * row never looks like it has no bank details when the read was refused.
 */
async function lineMetaOf(rpc: ToolRpc, ids: string[]): Promise<Map<string, Record<string, unknown>> | ToolResult> {
  const wanted = [...new Set(ids.filter((id) => UUID.test(id)))];
  const found = new Map<string, Record<string, unknown>>();
  if (wanted.length === 0) return found;
  const result = await rpc("get_line_meta", { p_ids: wanted });
  if (result.status >= 400 || !Array.isArray(result.json)) return fail("refused", READ_REFUSED);
  for (const row of result.json as unknown[]) {
    if (row == null || typeof row !== "object" || Array.isArray(row)) continue;
    const { transaction_id: id, ...meta } = row as Record<string, unknown>;
    if (typeof id === "string") found.set(id, { ...NO_LINE_META, ...meta });
  }
  return found;
}

/** Adds meta to each row, read by the row's ledger id. */
async function withLineMeta<T extends Record<string, unknown>>(
  rpc: ToolRpc,
  rows: T[],
  idOf: (row: T) => unknown,
): Promise<Array<T & { meta: Record<string, unknown> }> | ToolResult> {
  const metas = await lineMetaOf(rpc, rows.map(idOf).filter((id): id is string => typeof id === "string"));
  if (!(metas instanceof Map)) return metas;
  return rows.map((row) => {
    const id = idOf(row);
    return { ...row, meta: (typeof id === "string" ? metas.get(id) : undefined) ?? { ...NO_LINE_META } };
  });
}

function offsetOf(value: unknown): number | ToolResult {
  if (value == null) return 0;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return fail("validation", "validation");
  return value;
}

function dateOf(value: unknown): string | null | ToolResult {
  if (value == null) return null;
  if (typeof value !== "string" || !DATE.test(value)) return fail("validation", "validation");
  return value;
}

/** get_profit_months refuses a range of this many calendar months or more, as the RPC does. */
const PROFIT_MONTHS_MAX = 240;

/** Calendar months from the month of `from` to the month of `to`, both YYYY-MM-DD. */
function monthsBetween(from: string, to: string): number {
  return (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7));
}

function textOf(value: unknown): string | null | ToolResult {
  if (value == null) return null;
  if (typeof value !== "string") return fail("validation", "validation");
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

const SAFE_MINOR = BigInt(Number.MAX_SAFE_INTEGER);

function decimalText(value: number | string): string {
  return typeof value === "string" ? value : Object.is(value, -0) ? "0" : value.toString();
}

function minorFromMajor(value: unknown): bigint | ToolResult {
  if (typeof value !== "number" && typeof value !== "string") return fail("validation", "validation");
  try {
    const minor = parseDecimalHalfEven(decimalText(value).trim().replace(/[\s,]/g, ""), 2);
    if (minor <= 0n || minor > SAFE_MINOR) return fail("validation", "validation");
    return minor;
  } catch {
    return fail("validation", "validation");
  }
}

function minorFromMajorNonNegative(value: unknown, fallback = 0n): bigint | ToolResult {
  if (value == null) return fallback;
  if (typeof value !== "number" && typeof value !== "string") return fail("validation", "validation");
  try {
    const minor = parseDecimalHalfEven(decimalText(value).trim().replace(/[\s,]/g, ""), 2);
    if (minor < 0n || minor > SAFE_MINOR) return fail("validation", "validation");
    return minor;
  } catch {
    return fail("validation", "validation");
  }
}

function ppmFromPercent(value: unknown): number | ToolResult {
  if (typeof value !== "number" && typeof value !== "string") return fail("validation", "validation");
  const text = decimalText(value).trim();
  if (text.endsWith(".")) return fail("validation", "validation");
  try {
    const ppm = parseDecimalHalfEven(text, 4);
    if (ppm < 0n || ppm > 1_000_000n) return fail("validation", "validation");
    return Number(ppm);
  } catch {
    return fail("validation", "validation");
  }
}

function scheduleLimitOf(value: unknown, fallback: number): number | ToolResult {
  if (value == null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > LOAN_TERM_MONTHS_MAX) {
    return fail("validation", "validation");
  }
  return value;
}

function majorString(minor: bigint): string {
  const whole = minor / 100n;
  const frac = minor % 100n;
  if (frac === 0n) return whole.toString();
  return `${whole.toString()}.${frac.toString().padStart(2, "0")}`;
}

function scheduleRowOut(row: LoanScheduleRow) {
  return {
    date: row.dueDate,
    payment: majorString(row.paymentMinor),
    interest: majorString(row.interestMinor),
    escrow: majorString(row.escrowMinor),
    principal: majorString(row.principalMinor),
    balance: majorString(row.balanceMinor),
    payment_minor: Number(row.paymentMinor),
    interest_minor: Number(row.interestMinor),
    escrow_minor: Number(row.escrowMinor),
    principal_minor: Number(row.principalMinor),
    balance_minor: Number(row.balanceMinor),
  };
}

type LoanRow = {
  id: string;
  name: string;
  currency: string;
  principal_minor: number;
  annual_rate_ppm: number;
  /** Null for a demand loan only. */
  term_months: number | null;
  start_date: string;
  /** Null for a demand loan only. */
  payment_minor: number | null;
  escrow_minor: number;
  balance_minor: number;
  flagged_parts?: number;
  flagged_transaction_ids?: string[];
  project_id?: string | null;
  project_name?: string | null;
  status?: LoanStatus;
  closed_on?: string | null;
  interest_category_id?: string | null;
  escrow_category_id?: string | null;
  principal_category_id?: string | null;
  fees_category_id?: string | null;
  /** Absent on a row from before decision 0132: amortizing. */
  kind?: LoanKind;
  interest_only_months?: number | null;
  amortization_months?: number | null;
  rates?: Array<{ id?: string; effective_date: string; annual_rate_ppm: number }>;
};

function loanKindOf(loan: LoanRow): LoanKind {
  return loan.kind ?? "amortizing";
}

function loanRatesOf(loan: LoanRow): LoanRate[] {
  return (loan.rates ?? []).map((rate) => ({ effectiveDate: rate.effective_date, annualRatePpm: rate.annual_rate_ppm }));
}

/** A stored loan whose terms no longer build a schedule, for example one saved before FLOW-111. */
function storedLoanSchedule(loan: LoanRow): ReturnType<typeof buildLoanSchedule> | ToolResult {
  if (loanKindOf(loan) === "demand" || loan.term_months == null || loan.payment_minor == null) {
    return fail("refused", "a demand loan has no schedule rows");
  }
  try {
    return buildLoanSchedule({
      principalMinor: BigInt(loan.principal_minor),
      annualRatePpm: loan.annual_rate_ppm,
      termMonths: loan.term_months,
      startDate: loan.start_date,
      paymentMinor: BigInt(loan.payment_minor),
      escrowMinor: BigInt(loan.escrow_minor),
      kind: loanKindOf(loan),
      interestOnlyMonths: loan.interest_only_months ?? null,
      amortizationMonths: loan.amortization_months ?? null,
      rates: loanRatesOf(loan),
    });
  } catch (error) {
    if (error instanceof LoanScheduleError && error.code === "payment_below_interest") {
      return fail("refused", "payment below interest");
    }
    if (error instanceof LoanScheduleError) return fail("refused", "invalid loan terms");
    throw error;
  }
}

async function loadLoans(rpc: ToolRpc): Promise<ToolResult | LoanRow[]> {
  const result = await rpc("mcp_list_loans", {});
  if (result.status >= 400 || !Array.isArray(result.json)) return fail("refused", READ_REFUSED);
  return result.json as LoanRow[];
}

/** One attached payment of a loan, from `mcp_loan_payments` (oldest first). */
type LoanPaymentRow = {
  transaction_id: string;
  doc_date: string;
  line_status: string;
  needs_review: boolean;
  interest_minor: number;
  escrow_minor: number;
  principal_minor: number;
  fees_minor: number;
};

async function loadLoanPayments(loanId: string, rpc: ToolRpc): Promise<ToolResult | LoanPaymentRow[]> {
  const result = await rpc("mcp_loan_payments", { p_loan_id: loanId });
  if (result.status >= 400 || !Array.isArray(result.json)) return fail("refused", READ_REFUSED);
  return result.json as LoanPaymentRow[];
}

/** Payments that count: not waiting for review, and not the line being attached. */
function countedPayments(payments: LoanPaymentRow[], exceptTransactionId: string | null): LoanPaymentRow[] {
  return payments.filter((row) => !row.needs_review && row.transaction_id !== exceptTransactionId);
}

function demandPaymentsOf(payments: LoanPaymentRow[]): DemandPayment[] {
  return payments.map((row) => ({
    date: row.doc_date,
    interestMinor: BigInt(row.interest_minor),
    escrowMinor: BigInt(row.escrow_minor),
    principalMinor: BigInt(row.principal_minor),
    feesMinor: BigInt(row.fees_minor),
  }));
}

function demandTermsOf(loan: LoanRow) {
  return {
    principalMinor: BigInt(loan.principal_minor),
    annualRatePpm: loan.annual_rate_ppm,
    startDate: loan.start_date,
    rates: loanRatesOf(loan),
  };
}

/** A real calendar day as YYYY-MM-DD (2026-02-30 is not one). */
function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/** Today in UTC, as YYYY-MM-DD: a demand loan's interest accrues to it. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function defaultLoanCurrency(rpc: ToolRpc): Promise<string | ToolResult> {
  const result = await rpc("mcp_company_loan_currency", {});
  if (result.status >= 400 || typeof result.json !== "string") return fail("refused", READ_REFUSED);
  return result.json;
}

type Review = Record<string, unknown>;

export function filterReviews(rows: Review[], input: {
  direction: string | null;
  reason: string | null;
  supplier: string | null;
  query: string | null;
  from: string | null;
  to: string | null;
  limit: number;
  offset: number;
}): { total: number; reviews: Review[] } {
  const filtered = rows.filter((row) => {
    if (input.direction && row.direction !== input.direction) return false;
    if (input.reason && row.reason !== input.reason) return false;
    if (input.supplier) {
      const name = typeof row.supplier_name === "string" ? row.supplier_name : "";
      if (!name.includes(input.supplier)) return false;
    }
    if (input.query) {
      const description = typeof row.description === "string" ? row.description : "";
      if (!description.includes(input.query)) return false;
    }
    const doc = typeof row.doc_date === "string" ? row.doc_date : "";
    if (input.from && doc < input.from) return false;
    if (input.to && doc > input.to) return false;
    return true;
  });
  return { total: filtered.length, reviews: filtered.slice(input.offset, input.offset + input.limit) };
}

function projectRow(row: Review) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    budget_agorot: row.budget_agorot ?? null,
    income_agorot: row.income_agorot,
    direct_agorot: row.direct_agorot,
    shared_agorot: row.shared_agorot,
    profit_agorot: row.profit_agorot,
    is_overhead: row.is_overhead === true,
    by_currency: row.by_currency ?? [],
  };
}

function totalsOf(body: Review) {
  return {
    company_id: body.company_id ?? null,
    name: body.name ?? null,
    basis: body.basis,
    from: body.from ?? null,
    to: body.to ?? null,
    income_agorot: body.income_agorot,
    direct_agorot: body.direct_agorot,
    shared_agorot: body.shared_agorot,
    overhead_agorot: body.overhead_agorot,
    expense_agorot: body.expense_agorot,
    unassigned_income_agorot: body.unassigned_income_agorot,
    unassigned_expense_agorot: body.unassigned_expense_agorot,
    overhead_project_id: body.overhead_project_id ?? null,
    net_profit_agorot: body.net_profit_agorot,
    active_projects: body.active_projects,
    review_count: body.review_count,
    excluded_income_agorot: body.excluded_income_agorot,
    excluded_expense_agorot: body.excluded_expense_agorot,
    by_currency: body.by_currency ?? [],
  };
}

async function dashboard(rpc: ToolRpc, from: string | null, to: string | null, basis: string): Promise<ToolResult | Review> {
  const result = await rpc("get_dashboard", { p_from: from, p_to: to, p_basis: basis });
  if (result.status >= 400 || result.json == null || typeof result.json !== "object" || Array.isArray(result.json)) {
    return fail("refused", READ_REFUSED);
  }
  return result.json as Review;
}

function toolSpec(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  write = false,
) {
  return {
    name,
    description,
    inputSchema: { type: "object", properties, additionalProperties: false },
    annotations: write
      ? { readOnlyHint: false, destructiveHint: true, idempotentHint: true }
      : { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  };
}

export function isWriteTool(name: string): boolean {
  return (WRITE_TOOL_NAMES as readonly string[]).includes(name);
}

function readTools() {
  return [
    toolSpec("list_projects", "Projects and their profit for a period. Omit both dates for all time. Amounts in *_agorot are ILS only. by_currency gives each currency's P&L in minor units (cents for USD). The output echoes basis.", {
      from: { type: "string" },
      to: { type: "string" },
      basis: { type: "string", enum: ["cash", "invoiced"] },
    }),
    toolSpec("get_project", "One project's P&L, categories, and its 40 newest lines, for all time or for a period (from and to, YYYY-MM-DD, both or neither). With the same dates and basis it matches the list_projects row. id is the project id from list_projects. basis is cash or invoiced (default cash, like list_projects and get_totals). Amounts in *_agorot are ILS only. by_currency and categories_by_currency are in minor units per currency (cents for USD). Expense categories kept out of the P&L are not in categories or the totals; they are listed in excluded_categories_by_currency. Kept-out project income is listed by category in excluded_income_by_currency (positive minor units). A guessed (category_suggested) kept-out category still counts until it is confirmed. Each transaction carries its currency, its line_status (pending or posted) and its full line amount, including pending lines and the whole of a shared line. transactions also lists lines with a split_line part filed to this project; parts_minor is the sum of a split line's parts on this project (0 when none is here, null for an unsplit line). kept_out is true when no part of the line counts in this project's P&L (a kept-out category, or the owner took the line out). other_currencies count counts each bank line once. loans lists the loans filed under this project (id, name, currency, balance_minor); it does not change the P&L numbers. A project outside the company is not_found.", {
      id: { type: "string" },
      basis: { type: "string", enum: ["cash", "invoiced"] },
      from: { type: "string" },
      to: { type: "string" },
    }),
    toolSpec("list_categories", "The company's categories.", {}),
    toolSpec("list_review", "Open review items. id is the review id. transaction_id is the ledger id. meta is the line's bank details (see get_expense).", {
      direction: { type: "string", enum: ["expense", "income"] },
      reason: { type: "string" },
      supplier: { type: "string" },
      query: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      limit: { type: "integer" },
      offset: { type: "integer" },
    }),
    toolSpec("get_expense", "One ledger row, including its allocations; for a split line, line_split.parts; and its loan split. loan_split is null, or the parts of a loan payment: by_parts says whether the P&L counts the line by its parts, and then each part's in_pnl says whether that part counts (the principal is kept out). in_pnl says whether the line counts in the P&L, in_pnl_override is its own override (null follows the category), and category_excluded_from_pnl is the category flag; category_suggested is true while the category is only a guess, and a guessed kept-out category still counts. meta is the line's bank details: method (card, ach, wire, check, transfer, other, or null when the provider gave none), card_last4 (only the last 4 digits), memo, account (the bank account's name), counterparty, and bank_description (the bank's original text); a field is null when unknown. transaction_id is the ledger id.", {
      transaction_id: { type: "string" },
    }),
    toolSpec("search_expenses", "Search pending review rows, filed rows, or both. id is the ledger id. meta is the line's bank details (see get_expense).", {
      scope: { type: "string", enum: ["pending", "filed", "all"] },
      query: { type: "string" },
      limit: { type: "integer" },
      offset: { type: "integer" },
    }),
    toolSpec("get_totals", "Company totals for a period. Omit both dates for all time. Amounts in *_agorot are ILS only. by_currency gives each currency's P&L in minor units (cents for USD). direct + shared + overhead + unassigned expense = expense. unassigned is income with no project, and cost with no role, a project role and no project, or a shared role and no split.", {
      from: { type: "string" },
      to: { type: "string" },
      basis: { type: "string", enum: ["cash", "invoiced"] },
    }),
    toolSpec("list_loans", "Loans in the company with current principal balance. flagged_parts counts loan parts waiting for review (they do not lower the balance) and flagged_transaction_ids names their lines. project_id and project_name show the project a loan is filed under, or null. status is open, paid_off or closed, and closed_on is the day it ended (null while open). include_closed false lists open loans only (default true). interest_category_id, escrow_category_id and principal_category_id (with *_name) are the loan's own categories for its payment parts, or null for the defaults. fees_category_id (with fees_category_name) is the category for a payment's fees part, or null when the loan names none (then each attach with fees must name one). kind is amortizing, interest_only (with interest_only_months), balloon (with amortization_months) or demand (term_months and payment_minor null); rates lists the loan's rate changes (id, effective_date, annual_rate_ppm), oldest first.", {
      include_closed: { type: "boolean" },
    }),
    toolSpec("get_loan_schedule", "Amortization rows for one loan (from and limit page them; kind says which kind it is). Interest uses the rate in force on each row's date (set_loan_rate); a rate change recasts the payment over the months left (for an amortizing loan whose payment is below the term annuity, over the months left in the amortization period that payment implies, so the balloon stays at the term). An interest_only loan's first interest_only_months rows pay interest and escrow only; a balloon loan's last row pays the rest of the balance. A demand loan has nothing scheduled ahead: rows are the payments attached so far (oldest first, with the balance after each), and accrued is the interest due on as_of (YYYY-MM-DD, default today): carried (interest earlier payments left unpaid, simple interest) plus what accrued from the last one (or the start), daily on actual/365, with since, days, carried, interest and balance.", {
      loan_id: { type: "string" },
      from: { type: "integer" },
      limit: { type: "integer" },
      as_of: { type: "string" },
    }),
    syncStatusSpec(),
    toolSpec("get_breakdown", "Income or expenses for a period, grouped by category, project, or payer (supplier or customer). Omit both dates for all time. basis is cash or invoiced (default cash, like get_totals). Without group: totals[], groups[] ({key, name, currency, amount_minor, count, shared}), excluded[] (kept-out categories, not in the totals), review_count. totals match get_totals. Under project, key is a project id, overhead, or unassigned; shared marks a project holding a share of a shared cost. A null name means no category, payer, or project. With group (a key from groups) and currency (default ILS): that group's lines, newest first, in rows[] with has_more. excluded true lists the kept-out lines instead. amount_minor is in minor units (agorot, cents), positive for income and for a normal expense. A loan payment with a valid split counts by part.", {
      direction: { type: "string", enum: ["income", "expense"] },
      from: { type: "string" },
      to: { type: "string" },
      group_by: { type: "string", enum: ["category", "project", "payer"] },
      basis: { type: "string", enum: ["cash", "invoiced"] },
      group: { type: "string" },
      currency: { type: "string" },
      excluded: { type: "boolean" },
      limit: { type: "integer" },
      offset: { type: "integer" },
    }),
    toolSpec("get_jev_status", "The Jev AI tagger for this company: enabled, mode (off, shadow or auto), threshold, daily_call_cap and calls_today (calls per UTC day), last_run_at, and lines_without_suggestion (open expense and income lines in review that Jev has not labelled yet). Jev only suggests a project and category; it never approves a line. It runs within about 5 minutes after a bank sync, up to the daily cap.", {}),
    toolSpec("get_jev_accuracy", "How often Jev's suggestions matched what the owner filed, for lines resolved in a period (from and to are YYYY-MM-DD, by the UTC day the review was approved or changed; omit both for all time). lines counts resolved lines that had a Jev suggestion. all_matched counts lines where every compared field matched. project_compared/project_matched and category_compared/category_matched count each field; a shared, overhead or multi-project line is not compared on project, and a line split by category is not compared on category. at_threshold has lines and all_matched for suggestions at or above the company's threshold, which is what auto mode would pre-fill. bands splits by confidence: high from 0.9, medium from 0.7, low below.", {
      from: { type: "string" },
      to: { type: "string" },
    }),
    toolSpec("get_profit_months", "Profit per calendar month, newest first, for the company or one project (project_id from list_projects). from and to are YYYY-MM-DD, both or neither (neither: from the first month with a line to this month); at most 240 months. basis is cash or invoiced (default cash). Each month has month (YYYY-MM), from and to (cut to the range), open (the current month), and by_currency[] (currency, income_minor, expense_minor, profit_minor; ILS first and always present). The company's months add up to get_totals for the range; a project's add up to get_project for the range (income less direct and shared cost). For a project, each month also has overhead_share_agorot, its ILS share of that month's overhead weighted by that month's income on the same basis (null when no project has income that month, 0 when only this one has none), and the output has after_overhead. by_currency[] at the top sums the months.", {
      from: { type: "string" },
      to: { type: "string" },
      basis: { type: "string", enum: ["cash", "invoiced"] },
      project_id: { type: "string" },
    }),
    toolSpec("get_anomalies", "Flags on the open review lines (newest 500), found in SQL: duplicate (another posted line of the same supplier or customer, document kind, gross amount and currency, within 7 days, not an invoice and its own receipt; other_transaction_id, other_doc_date), amount_spike (at least 3 times the median of that supplier's or customer's last 12 lines in the year before, and at least 100.00 more; typical_amount_minor, ratio), new_party_large (the first line of a supplier or customer, at or above the company's 90th percentile posted line over the year up to the newest open line; company_p90_minor). Each item has transaction_id, kind and jev_score (0 to 1: how likely Jev thinks the flag is a real problem, scored in the same call that labelled the line; null when Jev did not score it). A flag is a reason to look, not an error; the owner decides.", {}),
    toolSpec("get_jev_suggestions", "Jev's suggestions on the open review lines (newest 500 that have one): transaction_id, direction (expense or income), project_id and project_name, category_id and category_name (null when Jev did not answer), confidence, reason, party_filings and matching_filings, and anomaly_score (Jev's score of an anomaly flag on that line, or null). reason comes from SQL: same_as_last (the suggestion equals how the owner filed this supplier or customer last time), usual_for_party (it equals at least 2 of the last 5 filed lines), new_party (nothing filed yet for that party), model_only (none of these). Jev only suggests; it never approves a line, and assign_expense or assign_expenses is still how a line is filed.", {}),
    toolSpec("get_missing_bills", "Recurring suppliers (an expense line in at least 3 of the last 6 complete months and in one of the last 2) with no expense line yet this month, after their usual day plus 5 days (Israel time; on the month's last day when that falls later). Each has supplier_id, supplier_name, currency, typical_amount_minor (median monthly net, negative for expenses), typical_day, expected_by, months_seen, last_doc_date, and the usual project_id and category_id.", {}),
    toolSpec("get_expected_months", "Expected income and expense per month from recurring suppliers and customers (median monthly net), for this month and the next ones. months is 1 to 12 (default 3). This month (open: true) counts only the recurring ones not seen yet this month. project_id limits it to parties whose usual project is that one. Output: today, project_id, months[] (month YYYY-MM, open, by_currency[] with currency, income_minor, expense_minor; expenses are negative) and recurring[] (direction, party_id, name, currency, typical_amount_minor, typical_day, months_seen, seen_this_month, project_id, category_id). A projection from past months, not booked lines.", {
      months: { type: "integer", minimum: 1, maximum: 12 },
      project_id: { type: "string" },
    }),
  ];
}

function syncStatusSpec() {
  return toolSpec("get_sync_status", "State of a sync_bank job: running, done, or failed. job_id is from sync_bank. When done it has added, duplicates (lines already stored, skipped), removed, and newest_date. When failed it has error.", {
    job_id: { type: "string" },
  });
}

/** get_sync_status is allowed with read or write scope. Other tools need their own scope. */
export function scopeAllows(name: string, scope: string[]): boolean {
  if (name === SYNC_STATUS_TOOL) return scope.includes("read") || scope.includes("write");
  if ((WRITE_TOOL_NAMES as readonly string[]).includes(name)) return scope.includes("write");
  if ((READ_TOOL_NAMES as readonly string[]).includes(name)) return scope.includes("read");
  return false;
}

const SHARES_SPEC = {
  type: "array",
  items: {
    type: "object",
    properties: {
      project_id: { type: "string" },
      share: { type: "integer" },
    },
    required: ["project_id", "share"],
    additionalProperties: false,
  },
};

const LINE_PARTS_SPEC = {
  type: "array",
  items: {
    type: "object",
    properties: {
      category_id: { type: "string" },
      project_id: { type: ["string", "null"] },
      amount_minor: { type: "integer" },
      percent: { type: "number" },
      rest: { type: "boolean", enum: [true] },
    },
    additionalProperties: false,
  },
};

function writeTools() {
  return [
    toolSpec("assign_expense", "Assign one expense or income line to a project and category. An open review is closed. A line needs a project unless its category is an income category kept out of the P&L; then project_id can be left out or null. The category kind decides the P&L side, so an outflow under an income category is a reversal (negative income) and an inflow under an expense category is a reversal (negative expense). An income-kind category needs a project, also on an outflow.", {
      idempotency_key: { type: "string" },
      transaction_id: { type: "string" },
      project_id: { type: ["string", "null"] },
      category_id: { type: "string" },
      remember: { type: "boolean" },
    }, true),
    toolSpec("assign_expense_split", "Split one expense across projects. Each share is a whole percent; shares must sum to 100. Optional category_id sets the category like assign_expense.", {
      idempotency_key: { type: "string" },
      transaction_id: { type: "string" },
      category_id: { type: "string" },
      shares: SHARES_SPEC,
    }, true),
    toolSpec("assign_expenses", "Assign up to 200 expenses in one write. Partial success is allowed. A row with shares[] splits that expense like assign_expense_split. A row with only transaction_id and parts[] runs split_line on that line (same parts; parts [] clears the split); its undo_kind is line_split. remember needs project_id on the same row. undo_batch with the returned batch_key undoes the rows that succeeded.", {
      idempotency_key: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            transaction_id: { type: "string" },
            project_id: { type: "string" },
            category_id: { type: "string" },
            remember: { type: "boolean" },
            shares: SHARES_SPEC,
            parts: LINE_PARTS_SPEC,
          },
          required: ["transaction_id"],
          additionalProperties: false,
        },
      },
    }, true),
    toolSpec("set_expense_category", "Set one expense category. Shares stay. An open review is closed. A category of the other kind is a reversal: an outflow under an income category is negative income, an inflow under an expense category is negative expense.", {
      idempotency_key: { type: "string" },
      transaction_id: { type: "string" },
      category_id: { type: "string" },
    }, true),
    toolSpec("create_project", "Create a project in the owner's company.", {
      idempotency_key: { type: "string" },
      name: { type: "string" },
      status: { type: "string", enum: ["active", "finished"] },
    }, true),
    toolSpec("create_category", "Create a category in the owner's company.", {
      idempotency_key: { type: "string" },
      name: { type: "string" },
      kind: { type: "string", enum: ["expense", "income"] },
    }, true),
    toolSpec("create_projects", "Create up to 100 projects in one write, for a company setup. Partial success is allowed: each row returns ok with its id, or a code; a name that is already taken returns existing_id. undo_batch with the returned batch_key removes the rows that were created.", {
      idempotency_key: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            status: { type: "string", enum: ["active", "finished"] },
          },
          required: ["name"],
          additionalProperties: false,
        },
      },
    }, true),
    toolSpec("create_categories", "Create up to 100 categories in one write, for a company setup. Partial success is allowed: each row returns ok with its id, or a code; a name already taken for that kind returns existing_id. undo_batch with the returned batch_key removes the rows that were created.", {
      idempotency_key: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            kind: { type: "string", enum: ["expense", "income"] },
          },
          required: ["name", "kind"],
          additionalProperties: false,
        },
      },
    }, true),
    toolSpec("sync_bank", "Start a pull of the latest Mercury bank lines for this company. Returns job_id and state at once; poll get_sync_status with job_id until state is done or failed. The same idempotency_key returns the same job.", {
      idempotency_key: { type: "string" },
    }, true),
    toolSpec("hide_category", "Hide a category. Undo restores the prior hidden flag.", {
      idempotency_key: { type: "string" },
      category_id: { type: "string" },
    }, true),
    toolSpec("set_category_pnl", "Count a category in the P&L or keep it out. Undo restores the prior setting.", {
      idempotency_key: { type: "string" },
      category_id: { type: "string" },
      excluded: { type: "boolean" },
    }, true),
    toolSpec("set_overhead_project", "Mark one project as the company's overhead project, so cost filed to it counts as overhead, not direct. project_id null clears it. Undo is kind overhead_project with the company id.", {
      idempotency_key: { type: "string" },
      project_id: { type: ["string", "null"] },
    }, true),
    toolSpec("rename_company", "Rename this company. 2 to 100 characters (code points) after trimming, with no control character. Undo restores the prior name.", {
      idempotency_key: { type: "string" },
      name: { type: "string" },
    }, true),
    toolSpec("add_loan", "Create a loan with a computed level payment unless payment is set. project_id (optional) files the loan under a project of this company; another company's project is refused. kind (default amortizing): interest_only needs interest_only_months (1 to term_months; those months pay interest only, then it amortizes over the months left, and when they equal the term the principal is due in the last month); balloon needs amortization_months (term_months to 600; the payment is the annuity over them and the rest is due at the term); demand takes no term_months, payment or escrow (interest accrues daily on actual/365 between payments; a 0% rate is allowed).", {
      idempotency_key: { type: "string" },
      name: { type: "string" },
      principal: { type: "string" },
      annual_rate_percent: { type: "number" },
      term_months: { type: "integer" },
      start_date: { type: "string" },
      payment: { type: "string" },
      escrow: { type: "string" },
      currency: { type: "string" },
      project_id: { type: "string" },
      kind: { type: "string", enum: ["amortizing", "interest_only", "balloon", "demand"] },
      interest_only_months: { type: "integer" },
      amortization_months: { type: "integer" },
    }, true),
    toolSpec("update_loan", "Patch loan terms. Currency cannot change. project_id files the loan under a project; null clears it; leaving it out keeps it. Payments already attached stay on the project they were filed under. status paid_off or closed needs closed_on (YYYY-MM-DD); a closed loan takes only payments dated on or before it, and closing before a payment already attached is refused (payments after closed_on). status open reopens the loan and clears closed_on. A loan that is not open returns balance_left, the principal Flow never saw paid. interest_category_id, escrow_category_id and principal_category_id file that part of later attached payments under a category of this company (null goes back to the default): interest and escrow need an expense category counted in the P&L, principal one kept out, and a built-in loan category takes only its own part (category does not fit the loan part). fees_category_id files the fees part of later payments when the attach names none: any expense category, counted in the P&L or kept out, that is not a built-in loan category, or the built-in interest one (category does not fit the loan part); null clears it, and there is no default. Payments already attached keep their categories. kind changes the loan's kind (interest_only needs interest_only_months, balloon amortization_months; demand clears the term, payment and escrow; another kind from demand needs term_months and payment); interest_only_months and amortization_months alone change that field. Undo restores the previous project, status, closed_on, categories and kind.", {
      idempotency_key: { type: "string" },
      loan_id: { type: "string" },
      name: { type: "string" },
      principal: { type: "string" },
      annual_rate_percent: { type: "number" },
      term_months: { type: "integer" },
      start_date: { type: "string" },
      payment: { type: "string" },
      escrow: { type: "string" },
      project_id: { type: ["string", "null"] },
      status: { type: "string", enum: ["open", "paid_off", "closed"] },
      closed_on: { type: ["string", "null"] },
      interest_category_id: { type: ["string", "null"] },
      escrow_category_id: { type: ["string", "null"] },
      principal_category_id: { type: ["string", "null"] },
      fees_category_id: { type: ["string", "null"] },
      kind: { type: "string", enum: ["amortizing", "interest_only", "balloon", "demand"] },
      interest_only_months: { type: "integer" },
      amortization_months: { type: "integer" },
    }, true),
    toolSpec("attach_loan_payment", "Split one expense line across interest, escrow, and principal, plus an optional fees part. Interest, escrow and principal go under the loan's own category for that part or the default. Fees have no default: they go under this call's fees_category_id (allowed only with fees), else the loan's fees_category_id, else the attach is refused (fees category required). A fees category is any expense category, in or out of the P&L, that is not a built-in loan category or is the built-in interest one (category does not fit the loan part; category not found for another company's). By default the parts follow the schedule row for the line's date: principal takes what is left over, and a shortfall comes out of principal, then escrow, then interest. installments (1 to 12) makes the payment cover that many schedule rows from the first one not yet paid (the first row whose scheduled interest plus principal through it is more than the interest plus principal already attached, pending lines included), using their sums (not enough schedule rows when they run past the schedule). A demand loan has no rows: interest is the balance times the rate for the days since the last attached payment (or the start), on actual/365, rounded half to even, plus interest earlier payments left unpaid (carried, simple interest), and the rest is principal; installments are refused (a demand loan has no schedule rows), and so are a line dated before the loan start (payment before the loan start) and one dated before a payment already attached (a later payment is already attached; a replay of the same attach is not refused). fees (an amount above zero) comes off the line first, then the rest splits as usual (fees exceed the line when the line is smaller). parts {interest, escrow, principal, fees?} gives the exact amounts, used as given; they must add up to the line exactly (parts don't add up), fees must be above zero, and parts cannot be combined with installments or fees. Amounts take at most two decimals. The schedule figures are still kept for comparison (0 when no row fits the date). Principal above the loan balance is refused (loan balance exceeded). The response lists each part, the fees part too when there is one. When the loan has a project and the line has no project, no shares and no role, the line is filed as a direct cost on that project, so interest and escrow count there and principal is kept out of the P&L (project_inherited true). Otherwise the line is left as it is and project_inherited_reason says why (a guessed category is not filed: confirm it with assign_expense; if filing fails the parts stay attached and the reason is project not set). A paid-off or closed loan takes only lines dated on or before its closed_on (loan closed). Undo of loan_split restores the line's previous project when nobody changed it since.", {
      idempotency_key: { type: "string" },
      transaction_id: { type: "string" },
      loan_id: { type: "string" },
      installments: { type: "integer" },
      fees: { type: "string" },
      parts: {
        type: "object",
        properties: {
          interest: { type: "string" },
          escrow: { type: "string" },
          principal: { type: "string" },
          fees: { type: "string" },
        },
        required: ["interest", "escrow", "principal"],
        additionalProperties: false,
      },
      fees_category_id: { type: "string" },
    }, true),
    toolSpec("set_loan_rate", "Set a loan's rate from effective_date (YYYY-MM-DD) on: annual_rate_percent (0 to 100, up to 4 decimals) is the nominal rate, entered by hand when an index such as prime changes; null removes that date's rate row (rate not found when there is none). A date before the loan's start_date is refused (rate before the loan start). The rate in force on a schedule row's date, or on each day of a demand loan's interest, is the latest row on or before it, else the loan's own rate. A change recasts the payment over the months left; payments already attached keep their parts. Returns the rate row id; undo is kind loan_rate with that id and puts the row back as it was.", {
      idempotency_key: { type: "string" },
      loan_id: { type: "string" },
      effective_date: { type: "string" },
      annual_rate_percent: { type: ["number", "string", "null"] },
    }, true),
    toolSpec("split_line", "Split one bank line into parts, each with its own category and optional project, and exactly one of: amount_minor (exact cents), percent (of the whole line, above 0 up to 100, at most 4 decimals), or rest: true (whatever the other parts leave; at most one; without category_id it keeps the line's own category). Percent parts are rounded together so they hit the line to the cent; a rest with nothing left is dropped. Without a rest part the parts must sum to the line. A part without project_id keeps the line's project. A part whose category is the other kind (an expense category on a refund inflow, an income category on an outflow) is a reversal and needs project_id. Returns the stored parts in cents. parts [] clears the split. When the bank changes a split line's amount, it counts whole and list_review shows it with reason split_mismatch; that review does not block split_line, and new parts or parts [] close it. Undo is kind line_split with the transaction id.", {
      idempotency_key: { type: "string" },
      transaction_id: { type: "string" },
      parts: LINE_PARTS_SPEC,
    }, true),
    toolSpec("set_line_pnl", "Take one line out of the P&L (in_pnl false), count it although its category is kept out (in_pnl true), or follow its category again (in_pnl null). Covers every part of a split line. A loan line is refused. Returns the line's in_pnl. Undo is kind line_pnl with the transaction id.", {
      idempotency_key: { type: "string" },
      transaction_id: { type: "string" },
      in_pnl: { type: ["boolean", "null"] },
    }, true),
    toolSpec("set_lines_pnl", "set_line_pnl for up to 200 lines in one write. Partial success is allowed. undo_batch with the returned batch_key undoes the rows that succeeded.", {
      idempotency_key: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            transaction_id: { type: "string" },
            in_pnl: { type: ["boolean", "null"] },
          },
          required: ["transaction_id", "in_pnl"],
          additionalProperties: false,
        },
      },
    }, true),
    toolSpec("undo", "Undo one assistant write recorded for this user.", {
      idempotency_key: { type: "string" },
      kind: { type: "string", enum: ["review", "reassign", "project", "category", "category_hidden", "category_pnl", "loan", "loan_update", "loan_split", "overhead_project", "company", "line_split", "line_pnl", "loan_rate"] },
      id: { type: "string" },
    }, true),
    toolSpec("undo_batch", "Undo every successful row from a prior assign_expenses, set_lines_pnl, create_projects or create_categories batch.", {
      idempotency_key: { type: "string" },
      batch_key: { type: "string" },
    }, true),
  ];
}

export function toolsFor(scope: string[]) {
  return [
    ...(scope.includes("read") ? readTools() : []),
    ...(scope.includes("write") ? writeTools() : []),
    ...(!scope.includes("read") && scope.includes("write") ? [syncStatusSpec()] : []),
  ];
}

function envelopeOf(json: unknown, refused = WRITE_REFUSED): ToolResult {
  if (json == null || typeof json !== "object" || Array.isArray(json)) return fail("refused", refused);
  const body = json as { ok?: unknown; data?: unknown; error?: { code?: unknown; message?: unknown } };
  if (body.ok === true && body.data != null && typeof body.data === "object") return ok(body.data);
  const code = body.error?.code;
  const message = body.error?.message;
  if (body.ok === false && typeof code === "string" && TOOL_CODES.has(code) && typeof message === "string") {
    return fail(code, message);
  }
  return fail("refused", refused);
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function countOf(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 1_000_000_000 ? value : null;
}

/** The mercury-sync counts as the stored result, or null when the shape is wrong. */
function syncResultOf(payload: Record<string, unknown>): Record<string, unknown> | null {
  const added = countOf(payload.inserted);
  const duplicates = countOf(payload.updated);
  const removed = countOf(payload.removed);
  if (added == null || duplicates == null || removed == null) return null;
  const newest = payload.newest_date;
  if (newest != null && (typeof newest !== "string" || !DATE_ONLY.test(newest))) return null;
  return { added, duplicates, removed, newest_date: newest ?? null };
}

type SyncOutcome = { ok: true; data: Record<string, unknown> } | { ok: false; error: { code: string; message: string } };

function syncFailure(code: string, message: string): SyncOutcome {
  return { ok: false, error: { code, message } };
}

async function pullBank(invoke: ToolInvoke): Promise<SyncOutcome> {
  const pulled = await invoke(MERCURY_SYNC_FUNCTION, { force: true });
  if (pulled.status === 429) return syncFailure("unavailable", "retry");
  if (pulled.status === 401) return syncFailure("unavailable", "unavailable");
  const payload = pulled.json != null && typeof pulled.json === "object" && !Array.isArray(pulled.json)
    ? pulled.json as Record<string, unknown>
    : null;
  if (payload?.error === "Mercury is not connected") return syncFailure("not_found", "bank is not connected");
  if (payload?.error === "auth") return syncFailure("refused", "bank key was rejected; reconnect in Settings");
  if (pulled.status === 200 && payload != null) {
    if (payload.skipped === true) return syncFailure("unavailable", "retry");
    if (payload.ok === true) {
      const data = syncResultOf(payload);
      if (data != null) return { ok: true, data };
    }
  }
  return syncFailure("refused", "The bank sync failed.");
}

/** Runs the pull and records the outcome on the job. Never throws. */
async function runSyncJob(jobId: string, rpc: ToolRpc, invoke?: ToolInvoke): Promise<void> {
  let outcome: SyncOutcome;
  try {
    outcome = invoke ? await pullBank(invoke) : syncFailure("unavailable", "unavailable");
  } catch {
    outcome = syncFailure("refused", "The bank sync failed.");
  }
  try {
    await rpc("mcp_sync_bank_finish", { p_job_id: jobId, p_response: outcome });
  } catch {
    // The job stays running and get_sync_status reports it as retry after the stale window.
  }
}

async function syncStatus(jobId: string, rpc: ToolRpc): Promise<ToolResult> {
  const result = await rpc("mcp_sync_status", { p_job_id: jobId });
  if (result.status >= 400) return fail("refused", READ_REFUSED);
  return envelopeOf(result.json, READ_REFUSED);
}

async function syncBank(
  key: string,
  rpc: ToolRpc,
  invoke?: ToolInvoke,
  defer?: ToolDefer,
): Promise<ToolResult> {
  const begin = await rpc("mcp_sync_bank_begin", { p_idempotency_key: key });
  if (begin.status >= 400) return fail("refused", WRITE_REFUSED);
  const begun = envelopeOf(begin.json);
  if (begun.isError) return begun;
  const state = (begun.structuredContent as { ok: true; data: Record<string, unknown> }).data;
  const jobId = typeof state.job_id === "string" && UUID.test(state.job_id) ? state.job_id : null;
  if (state.state === "replay" && jobId != null) return syncStatus(jobId, rpc);
  // A result stored before jobs existed has no state; it replays as it was.
  if (state.state == null && !("job_id" in state) && "added" in state) return ok(state);
  if (state.state !== "proceed" || jobId == null) return fail("refused", WRITE_REFUSED);
  const work = runSyncJob(jobId, rpc, invoke);
  if (defer) {
    defer(work);
    return ok({ job_id: jobId, state: "running" });
  }
  await work;
  return syncStatus(jobId, rpc);
}

async function addLoanWrite(args: Record<string, unknown>, rpc: ToolRpc): Promise<ToolResult> {
  const parsed = addLoanSchema.safeParse(args);
  if (!parsed.success) return fail("validation", "validation");
  const kind = parsed.data.kind ?? "amortizing";
  const principalMinor = minorFromMajor(parsed.data.principal);
  if (typeof principalMinor !== "bigint") return principalMinor;
  const ratePpm = ppmFromPercent(parsed.data.annual_rate_percent);
  if (typeof ratePpm !== "number") return ratePpm;
  const escrowMinor = minorFromMajorNonNegative(parsed.data.escrow, 0n);
  if (typeof escrowMinor !== "bigint") return escrowMinor;
  // A demand loan has no term and no fixed payment (decision 0132).
  let paymentMinor: bigint | null = null;
  let preview: LoanScheduleRow[] = [];
  if (kind === "demand") {
    try {
      demandAccrual({ principalMinor, annualRatePpm: ratePpm, startDate: parsed.data.start_date }, [], parsed.data.start_date);
    } catch (error) {
      if (error instanceof LoanScheduleError) return fail("validation", error.code);
      return fail("validation", "validation");
    }
  } else {
    const termMonths = parsed.data.term_months ?? 0;
    const kindFields = {
      kind,
      interestOnlyMonths: parsed.data.interest_only_months ?? null,
      amortizationMonths: parsed.data.amortization_months ?? null,
    };
    if (parsed.data.payment == null) {
      try {
        paymentMinor = regularPaymentMinor({ principalMinor, annualRatePpm: ratePpm, termMonths, escrowMinor, ...kindFields });
      } catch (error) {
        if (error instanceof LoanScheduleError) return fail("validation", error.code);
        return fail("validation", "validation");
      }
    } else {
      const given = minorFromMajor(parsed.data.payment);
      if (typeof given !== "bigint") return given;
      paymentMinor = given;
    }
    try {
      preview = buildLoanSchedule({
        principalMinor,
        annualRatePpm: ratePpm,
        termMonths,
        startDate: parsed.data.start_date,
        paymentMinor,
        escrowMinor,
        ...kindFields,
      }).rows.slice(0, 3);
    } catch (error) {
      if (error instanceof LoanScheduleError) return fail("validation", error.code);
      return fail("validation", "validation");
    }
  }
  let currency = parsed.data.currency;
  if (currency == null) {
    const defaulted = await defaultLoanCurrency(rpc);
    if (typeof defaulted !== "string") return defaulted;
    currency = defaulted;
  }
  const result = await rpc("mcp_add_loan", {
    p_idempotency_key: parsed.data.idempotency_key,
    p_name: parsed.data.name,
    p_principal_minor: Number(principalMinor),
    p_annual_rate_ppm: ratePpm,
    p_term_months: parsed.data.term_months ?? null,
    p_start_date: parsed.data.start_date,
    p_payment_minor: paymentMinor == null ? null : Number(paymentMinor),
    p_escrow_minor: Number(escrowMinor),
    p_currency: currency,
    ...(parsed.data.project_id == null ? {} : { p_project_id: parsed.data.project_id }),
    // Sent only for a new kind, so an amortizing loan's call is the same as before.
    ...(kind === "amortizing" ? {} : {
      p_kind: kind,
      p_interest_only_months: parsed.data.interest_only_months ?? null,
      p_amortization_months: parsed.data.amortization_months ?? null,
    }),
  });
  if (result.status >= 400) return fail("refused", WRITE_REFUSED);
  const wrapped = envelopeOf(result.json);
  if (wrapped.isError) return wrapped;
  const data = (wrapped.structuredContent as { ok: true; data: Record<string, unknown> }).data;
  return ok({
    ...data,
    payment: paymentMinor == null ? null : majorString(paymentMinor),
    payment_minor: paymentMinor == null ? null : Number(paymentMinor),
    schedule_preview: preview.map(scheduleRowOut),
  });
}

async function updateLoanWrite(args: Record<string, unknown>, rpc: ToolRpc): Promise<ToolResult> {
  const parsed = updateLoanSchema.safeParse(args);
  if (!parsed.success) return fail("validation", "validation");
  const patch: Record<string, unknown> = {};
  if (parsed.data.name != null) patch.name = parsed.data.name;
  if (parsed.data.principal != null) {
    const minor = minorFromMajor(parsed.data.principal);
    if (typeof minor !== "bigint") return minor;
    patch.principal_minor = Number(minor);
  }
  if (parsed.data.annual_rate_percent != null) {
    const ppm = ppmFromPercent(parsed.data.annual_rate_percent);
    if (typeof ppm !== "number") return ppm;
    patch.annual_rate_ppm = ppm;
  }
  if (parsed.data.term_months != null) patch.term_months = parsed.data.term_months;
  if (parsed.data.start_date != null) patch.start_date = parsed.data.start_date;
  if (parsed.data.payment != null) {
    const minor = minorFromMajor(parsed.data.payment);
    if (typeof minor !== "bigint") return minor;
    patch.payment_minor = Number(minor);
  }
  if (parsed.data.escrow != null) {
    const minor = minorFromMajorNonNegative(parsed.data.escrow);
    if (typeof minor !== "bigint") return minor;
    patch.escrow_minor = Number(minor);
  }
  if (parsed.data.project_id !== undefined) patch.project_id = parsed.data.project_id;
  if (parsed.data.status != null) patch.status = parsed.data.status;
  if (parsed.data.closed_on !== undefined) patch.closed_on = parsed.data.closed_on;
  for (const key of ["interest_category_id", "escrow_category_id", "principal_category_id", "fees_category_id"] as const) {
    if (parsed.data[key] !== undefined) patch[key] = parsed.data[key];
  }
  // A kind change clears the fields the new kind does not have (decision 0132).
  if (parsed.data.interest_only_months !== undefined) patch.interest_only_months = parsed.data.interest_only_months;
  if (parsed.data.amortization_months !== undefined) patch.amortization_months = parsed.data.amortization_months;
  if (parsed.data.kind != null) {
    patch.kind = parsed.data.kind;
    if (parsed.data.kind !== "interest_only") patch.interest_only_months = null;
    if (parsed.data.kind !== "balloon") patch.amortization_months = null;
    if (parsed.data.kind === "demand") {
      patch.term_months = null;
      patch.payment_minor = null;
      patch.escrow_minor = 0;
    }
  }
  if (Object.keys(patch).length === 0) return fail("validation", "validation");
  const result = await rpc("mcp_update_loan", {
    p_idempotency_key: parsed.data.idempotency_key,
    p_loan_id: parsed.data.loan_id,
    p_patch: patch,
  });
  if (result.status >= 400) return fail("refused", WRITE_REFUSED);
  return envelopeOf(result.json);
}

/** The exact parts of attach_loan_payment, in minor units. Fees, when given, are above zero. */
type ExactLoanParts = { interest: bigint; escrow: bigint; principal: bigint; fees: bigint | null };

/** More than two decimals: exact loan parts and fees are not rounded, they are refused. */
function hasSubCent(value: number | string): boolean {
  return /\.\d{3,}$/.test(decimalText(value).trim().replace(/[\s,]/g, ""));
}

/** An exact amount: two decimals at most, above zero when `positive`. */
function exactMinorOf(value: number | string, positive: boolean): bigint | ToolResult {
  if (hasSubCent(value)) return fail("validation", "validation");
  return positive ? minorFromMajor(value) : minorFromMajorNonNegative(value);
}

function exactLoanPartsOf(parts: {
  interest: number | string;
  escrow: number | string;
  principal: number | string;
  fees?: number | string;
}): ExactLoanParts | ToolResult {
  const interest = exactMinorOf(parts.interest, false);
  if (typeof interest !== "bigint") return interest;
  const escrow = exactMinorOf(parts.escrow, false);
  if (typeof escrow !== "bigint") return escrow;
  const principal = exactMinorOf(parts.principal, false);
  if (typeof principal !== "bigint") return principal;
  if (parts.fees === undefined) return { interest, escrow, principal, fees: null };
  const fees = exactMinorOf(parts.fees, true);
  if (typeof fees !== "bigint") return fees;
  return { interest, escrow, principal, fees };
}

/**
 * Whether this line is already split on this loan (`split`), and the principal it already
 * counts toward the loan's balance: a replay of the same attach then sees the balance as it
 * was the first time, so installments start on the same row and the payload rebuilds the
 * same. A split that needs review does not count in the balance, so it adds nothing.
 */
async function principalAlreadyAttached(
  transactionId: string,
  loanId: string,
  rpc: ToolRpc,
): Promise<{ split: boolean; principalMinor: bigint } | ToolResult> {
  const result = await rpc("get_loan_split", { p_transaction_id: transactionId });
  if (result.status >= 400) return fail("refused", READ_REFUSED);
  const split = result.json as { loan_id?: unknown; needs_review?: unknown; parts?: unknown } | null;
  if (split == null || typeof split !== "object" || split.loan_id !== loanId) {
    return { split: false, principalMinor: 0n };
  }
  if (split.needs_review === true || !Array.isArray(split.parts)) return { split: true, principalMinor: 0n };
  for (const part of split.parts as Array<{ part?: unknown; amount_minor?: unknown }>) {
    if (part.part === "principal" && typeof part.amount_minor === "number") {
      return { split: true, principalMinor: BigInt(part.amount_minor) };
    }
  }
  return { split: true, principalMinor: 0n };
}

async function attachLoanWrite(args: Record<string, unknown>, rpc: ToolRpc): Promise<ToolResult> {
  const parsed = attachLoanSchema.safeParse(args);
  if (!parsed.success) return fail("validation", "validation");
  // Amounts are checked before anything is read: fees above zero, exact parts zero or more.
  let feesMinor = 0n;
  if (parsed.data.fees !== undefined) {
    const fees = exactMinorOf(parsed.data.fees, true);
    if (typeof fees !== "bigint") return fees;
    feesMinor = fees;
  }
  let exact: ExactLoanParts | null = null;
  if (parsed.data.parts !== undefined) {
    const given = exactLoanPartsOf(parsed.data.parts);
    if (!("interest" in given)) return given;
    exact = given;
  }
  const txnResult = await rpc("get_transaction", { p_id: parsed.data.transaction_id });
  if (txnResult.status >= 400) return fail("refused", READ_REFUSED);
  if (txnResult.json == null || typeof txnResult.json !== "object" || Array.isArray(txnResult.json)) {
    return fail("not_found", "not found");
  }
  const txn = txnResult.json as Record<string, unknown>;
  const docDate = typeof txn.doc_date === "string" ? txn.doc_date : null;
  const lineMinorRaw = txn.amount_original;
  const currency = typeof txn.currency === "string" ? txn.currency : null;
  if (docDate == null || typeof lineMinorRaw !== "number" || currency == null) {
    return fail("refused", WRITE_REFUSED);
  }
  const lineMinor = BigInt(lineMinorRaw);
  const loans = await loadLoans(rpc);
  if (!Array.isArray(loans)) return loans;
  const loan = loans.find((row) => row.id === parsed.data.loan_id);
  if (loan == null) return fail("refused", "loan not found");
  if (loan.currency !== currency) return fail("refused", "loan currency mismatch");
  if (!loanTakesPaymentOn({ status: loan.status, closedOn: loan.closed_on }, docDate)) {
    return fail("refused", "loan closed");
  }
  const attached = await principalAlreadyAttached(parsed.data.transaction_id, loan.id, rpc);
  if (!("split" in attached)) return attached;
  // The balance before this line's own split, if it is already attached (an idempotent replay).
  let balanceMinor = BigInt(loan.balance_minor) + attached.principalMinor;
  if (balanceMinor <= 0n) return fail("refused", "loan balance exceeded");
  // The scheduled figures: several rows from the first unpaid one, the row for the date, or
  // for a demand loan the interest accrued since the last payment (decision 0132).
  let scheduled: ScheduledSum | null;
  if (loanKindOf(loan) === "demand") {
    if (parsed.data.installments !== undefined) return fail("refused", "a demand loan has no schedule rows");
    if (docDate < loan.start_date) return fail("refused", "payment before the loan start");
    const payments = await loadLoanPayments(loan.id, rpc);
    if (!Array.isArray(payments)) return payments;
    const counted = countedPayments(payments, parsed.data.transaction_id);
    // Interest runs from the last payment, so payments are attached in date order. A line
    // already split on this loan is a replay (or a refused re-attach): the database answers
    // it, and the payments dated after it do not change its accrual.
    if (!attached.split && counted.some((row) => row.doc_date > docDate)) {
      return fail("refused", "a later payment is already attached");
    }
    // The interest accrued since the last payment, plus what earlier payments left unpaid.
    const accrual = demandAccrual(demandTermsOf(loan), demandPaymentsOf(counted), docDate);
    // Pending payments lower it too, so two quick attaches do not both take the same principal.
    if (accrual.balanceMinor < balanceMinor) balanceMinor = accrual.balanceMinor;
    if (balanceMinor <= 0n) return fail("refused", "loan balance exceeded");
    const left = lineMinor - feesMinor - accrual.interestMinor;
    scheduled = {
      interestMinor: accrual.interestMinor,
      escrowMinor: 0n,
      principalMinor: left < 0n ? 0n : left,
    };
  } else {
    const schedule = storedLoanSchedule(loan);
    if (!("rows" in schedule)) return schedule;
    if (parsed.data.installments !== undefined) {
      // FLOW-135 N1: interest plus principal paid so far, pending lines too (decision 0132).
      const payments = await loadLoanPayments(loan.id, rpc);
      if (!Array.isArray(payments)) return payments;
      const paidMinor = paidInterestAndPrincipal(payments.map((row) => ({
        transactionId: row.transaction_id,
        interestMinor: BigInt(row.interest_minor),
        principalMinor: BigInt(row.principal_minor),
        needsReview: row.needs_review,
      })), parsed.data.transaction_id);
      const start = firstUnpaidRowIndex(schedule.rows, paidMinor);
      scheduled = start < 0 ? null : sumScheduleRows(schedule.rows, start, parsed.data.installments);
      if (scheduled == null) return fail("refused", "not enough schedule rows");
    } else {
      scheduled = scheduleRowForDate(schedule.rows, docDate);
      // FLOW-135 N3: exact parts need no row; their scheduled figures are then 0.
      if (scheduled == null && exact != null) scheduled = { interestMinor: 0n, escrowMinor: 0n, principalMinor: 0n };
      if (scheduled == null) return fail("refused", "no schedule row for this date");
    }
  }
  let parts: readonly LoanSplitAmount[];
  if (exact != null) {
    if (exact.interest + exact.escrow + exact.principal + (exact.fees ?? 0n) !== lineMinor) {
      return fail("refused", "parts don't add up");
    }
    parts = [
      { part: "interest", amountMinor: exact.interest, scheduledMinor: scheduled.interestMinor },
      { part: "escrow", amountMinor: exact.escrow, scheduledMinor: scheduled.escrowMinor },
      { part: "principal", amountMinor: exact.principal, scheduledMinor: scheduled.principalMinor },
      ...(exact.fees == null ? [] : [{ part: "fees" as const, amountMinor: exact.fees, scheduledMinor: exact.fees }]),
    ];
  } else {
    const allocated = allocateLoanSplitWithFees({
      lineMinor,
      feesMinor,
      interestMinor: scheduled.interestMinor,
      escrowMinor: scheduled.escrowMinor,
      principalMinor: scheduled.principalMinor,
    });
    if (allocated == null) return fail("refused", "fees exceed the line");
    parts = allocated;
  }
  const principalPart = parts.find((part) => part.part === "principal")?.amountMinor ?? 0n;
  if (principalPart > balanceMinor) return fail("refused", "loan balance exceeded");
  // Fees go to this call's category, else the loan's. There is no default (decision 0130).
  const hasFees = parts.some((part) => part.part === "fees");
  const callFeesCategory = parsed.data.fees_category_id ?? null;
  if (hasFees && callFeesCategory == null && (loan.fees_category_id ?? null) == null) {
    return fail("refused", "fees category required");
  }
  const payload = parts.map((part) => ({
    part: part.part,
    amount_minor: Number(part.amountMinor),
    scheduled_minor: Number(part.scheduledMinor),
    ...(part.part === "fees" && callFeesCategory != null ? { category_id: callFeesCategory } : {}),
  }));
  const result = await rpc("mcp_attach_loan_payment", {
    p_idempotency_key: parsed.data.idempotency_key,
    p_transaction_id: parsed.data.transaction_id,
    p_loan_id: parsed.data.loan_id,
    p_parts: payload,
  });
  if (result.status >= 400) return fail("refused", WRITE_REFUSED);
  const wrapped = envelopeOf(result.json);
  if (wrapped.isError) return wrapped;
  return ok({
    ...(wrapped.structuredContent as { ok: true; data: Record<string, unknown> }).data,
    parts: payload.map((part) => ({
      part: part.part,
      ...("category_id" in part ? { category_id: part.category_id } : {}),
      amount: majorString(BigInt(part.amount_minor)),
      scheduled: majorString(BigInt(part.scheduled_minor)),
      amount_minor: part.amount_minor,
      scheduled_minor: part.scheduled_minor,
    })),
  });
}

async function callWrite(
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
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_create_project";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_name: parsed.data.name,
      ...(parsed.data.status == null ? {} : { p_status: parsed.data.status }),
    };
  } else if (name === "create_category") {
    const parsed = createCategorySchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_create_category";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_name: parsed.data.name,
      p_kind: parsed.data.kind,
    };
  } else if (name === "create_projects") {
    const parsed = createProjectsSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_create_projects";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_items: parsed.data.items.map((item) => item.status == null ? { name: item.name } : item),
    };
  } else if (name === "create_categories") {
    const parsed = createCategoriesSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
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
    if (!parsed.success) return fail("validation", "validation");
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

export async function callTool(
  name: string,
  input: unknown,
  scope: string[],
  rpc: ToolRpc,
  invoke?: ToolInvoke,
  defer?: ToolDefer,
): Promise<ToolResult> {
  const write = (WRITE_TOOL_NAMES as readonly string[]).includes(name);
  const read = (READ_TOOL_NAMES as readonly string[]).includes(name);
  if (!write && !read) return fail("validation", "validation");
  if (!scopeAllows(name, scope)) return fail("forbidden", "forbidden");
  if (write) return callWrite(name as typeof WRITE_TOOL_NAMES[number], input, rpc, invoke, defer);
  const args = argsOf(input, ALLOWED[name] ?? new Set());
  if (isFail(args)) return args;

  if (name === SYNC_STATUS_TOOL) {
    const jobId = args.job_id;
    if (typeof jobId !== "string" || !UUID.test(jobId)) return fail("validation", "validation");
    return syncStatus(jobId, rpc);
  }

  if (name === "list_projects" || name === "get_totals") {
    const from = dateOf(args.from);
    if (typeof from !== "string" && from != null) return from;
    const to = dateOf(args.to);
    if (typeof to !== "string" && to != null) return to;
    const basis = args.basis == null ? "cash" : args.basis;
    if (basis !== "cash" && basis !== "invoiced") return fail("validation", "validation");
    const body = await dashboard(rpc, from, to, basis);
    if (isFail(body)) return body;
    if (name === "get_totals") return ok(totalsOf(body));
    const projects = Array.isArray(body.projects) ? body.projects as Review[] : [];
    return ok({ basis, projects: projects.map(projectRow) });
  }

  if (name === "get_project") {
    const projectId = args.id;
    if (typeof projectId !== "string" || !UUID.test(projectId)) return fail("validation", "validation");
    const basis = args.basis == null ? "cash" : args.basis;
    if (basis !== "cash" && basis !== "invoiced") return fail("validation", "validation");
    const from = dateOf(args.from);
    if (typeof from !== "string" && from != null) return from;
    const to = dateOf(args.to);
    if (typeof to !== "string" && to != null) return to;
    if ((from == null) !== (to == null) || (from != null && to != null && from > to)) return fail("validation", "validation");
    const body: Record<string, unknown> = { p_id: projectId, p_basis: basis };
    if (from != null) Object.assign(body, { p_from: from, p_to: to });
    const result = await rpc("get_project", body);
    if (result.status >= 400) return fail("refused", READ_REFUSED);
    // The RPC returns null for an unknown id and for another company's project.
    if (result.json == null) return fail("not_found", "not found");
    if (typeof result.json !== "object" || Array.isArray(result.json)) return fail("refused", READ_REFUSED);
    return ok({ ...(result.json as Review), basis });
  }

  if (name === "get_profit_months") {
    const from = dateOf(args.from);
    if (typeof from !== "string" && from != null) return from;
    const to = dateOf(args.to);
    if (typeof to !== "string" && to != null) return to;
    if ((from == null) !== (to == null) || (from != null && to != null && from > to)) return fail("validation", "validation");
    if (from != null && to != null && monthsBetween(from, to) >= PROFIT_MONTHS_MAX) return fail("validation", "validation");
    const basis = args.basis == null ? "cash" : args.basis;
    if (basis !== "cash" && basis !== "invoiced") return fail("validation", "validation");
    const projectId = args.project_id == null ? null : args.project_id;
    if (projectId != null && (typeof projectId !== "string" || !UUID.test(projectId))) return fail("validation", "validation");
    const result = await rpc("get_profit_months", { p_from: from, p_to: to, p_basis: basis, p_project_id: projectId });
    if (result.status >= 400) return fail("refused", READ_REFUSED);
    // The RPC returns null for a project of another company or an unknown one.
    if (result.json == null) return projectId == null ? fail("refused", READ_REFUSED) : fail("not_found", "not found");
    if (typeof result.json !== "object" || Array.isArray(result.json)) return fail("refused", READ_REFUSED);
    return ok(result.json as Review);
  }

  if (name === "get_jev_status") {
    const result = await rpc("mcp_jev_status", {});
    const status = result.json;
    if (result.status >= 400 || status === null || typeof status !== "object" || Array.isArray(status)) {
      return fail("refused", READ_REFUSED);
    }
    return ok(status);
  }

  if (name === "get_jev_accuracy") {
    const from = dateOf(args.from);
    if (typeof from !== "string" && from != null) return from;
    const to = dateOf(args.to);
    if (typeof to !== "string" && to != null) return to;
    if (from != null && to != null && from > to) return fail("validation", "validation");
    const result = await rpc("mcp_jev_accuracy", { p_from: from, p_to: to });
    const report = result.json;
    if (result.status >= 400 || report === null || typeof report !== "object" || Array.isArray(report)) {
      return fail("refused", READ_REFUSED);
    }
    return ok(report);
  }

  if (name === "get_anomalies" || name === "get_missing_bills" || name === "get_jev_suggestions") {
    const fn = name === "get_anomalies"
      ? "mcp_review_anomalies"
      : name === "get_jev_suggestions"
      ? "mcp_jev_suggestions"
      : "missing_bills";
    const result = await rpc(fn, {});
    const data = result.json;
    if (result.status >= 400 || data === null || typeof data !== "object") return fail("refused", READ_REFUSED);
    if (name !== "get_missing_bills") {
      if (Array.isArray(data)) return fail("refused", READ_REFUSED);
      return ok(data);
    }
    if (!Array.isArray(data)) return fail("refused", READ_REFUSED);
    return ok({ missing: data });
  }

  if (name === "get_expected_months") {
    const months = args.months == null ? 3 : args.months;
    if (typeof months !== "number" || !Number.isInteger(months) || months < 1 || months > 12) {
      return fail("validation", "validation");
    }
    const projectId = args.project_id ?? null;
    if (projectId != null && (typeof projectId !== "string" || !UUID.test(projectId))) return fail("validation", "validation");
    const result = await rpc("expected_months", { p_months: months, p_project_id: projectId });
    const data = result.json;
    if (result.status >= 400 || data === null || typeof data !== "object" || Array.isArray(data)) {
      return fail("refused", READ_REFUSED);
    }
    return ok(data);
  }

  if (name === "get_breakdown") {
    const direction = args.direction;
    if (direction !== "income" && direction !== "expense") return fail("validation", "validation");
    const groupBy = args.group_by == null ? "category" : args.group_by;
    if (groupBy !== "category" && groupBy !== "project" && groupBy !== "payer") return fail("validation", "validation");
    const basis = args.basis == null ? "cash" : args.basis;
    if (basis !== "cash" && basis !== "invoiced") return fail("validation", "validation");
    const from = dateOf(args.from);
    if (typeof from !== "string" && from != null) return from;
    const to = dateOf(args.to);
    if (typeof to !== "string" && to != null) return to;
    // get_totals counts nothing for a period with one date; refuse it so totals stay equal.
    if ((from == null) !== (to == null)) return fail("validation", "validation");
    const range = { p_direction: direction, p_from: from, p_to: to, p_group_by: groupBy, p_basis: basis };
    const excluded = args.excluded == null ? false : args.excluded;
    if (typeof excluded !== "boolean") return fail("validation", "validation");
    // The kept-out list has no group; a group with excluded would be silently ignored.
    if (excluded && args.group != null) return fail("validation", "validation");
    if (args.group == null && !excluded) {
      if (args.currency != null || args.limit != null || args.offset != null) return fail("validation", "validation");
      const result = await rpc("get_breakdown", range);
      if (result.status >= 400 || result.json == null || typeof result.json !== "object" || Array.isArray(result.json)) {
        return fail("refused", READ_REFUSED);
      }
      return ok(result.json as Review);
    }
    const group = args.group == null ? null : args.group;
    if (group != null && (typeof group !== "string" || group.length === 0 || group.length > 64)) return fail("validation", "validation");
    const currency = args.currency == null ? "ILS" : args.currency;
    if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) return fail("validation", "validation");
    const limit = limitOf(args.limit, 40);
    if (typeof limit !== "number") return limit;
    const offset = offsetOf(args.offset);
    if (typeof offset !== "number") return offset;
    const result = await rpc("get_breakdown_lines", {
      ...range,
      p_group_key: group,
      p_currency: currency,
      p_excluded: excluded,
      p_limit: limit,
      p_offset: offset,
    });
    if (result.status >= 400 || result.json == null || typeof result.json !== "object" || Array.isArray(result.json)) {
      return fail("refused", READ_REFUSED);
    }
    return ok(result.json as Review);
  }

  if (name === "list_categories") {
    const result = await rpc("list_categories", {});
    if (result.status >= 400 || !Array.isArray(result.json)) return fail("refused", "The read was refused.");
    return ok({ categories: result.json });
  }

  if (name === "list_review" || name === "search_expenses") {
    const limit = limitOf(args.limit, 50);
    if (typeof limit !== "number") return limit;
    const offset = offsetOf(args.offset);
    if (typeof offset !== "number") return offset;
    if (name === "search_expenses") {
      const scopeName = args.scope == null ? "pending" : args.scope;
      if (scopeName !== "pending" && scopeName !== "filed" && scopeName !== "all") return fail("validation", "validation");
      const query = textOf(args.query);
      if (typeof query !== "string" && query != null) return query;
      if (scopeName === "pending") {
        const listed = await rpc("list_review", {});
        if (listed.status >= 400 || !Array.isArray(listed.json)) return fail("refused", "The read was refused.");
        const page = filterReviews(listed.json as Review[], {
          direction: null,
          reason: null,
          supplier: null,
          query,
          from: null,
          to: null,
          limit,
          offset,
        });
        const expenses = await withLineMeta(
          rpc,
          page.reviews.map((row) => ({ ...row, id: row.transaction_id })),
          (row) => row.id,
        );
        if (!Array.isArray(expenses)) return expenses;
        return ok({ total: page.total, expenses });
      }
      const found = await rpc("search_transactions", {
        p_query: query,
        p_scope: scopeName,
        p_limit: limit,
        p_offset: offset,
      });
      if (found.status >= 400 || found.json == null || typeof found.json !== "object") {
        return fail("refused", READ_REFUSED);
      }
      const body = found.json as { expenses?: unknown };
      const rows = Array.isArray(body.expenses) ? (body.expenses as Array<Record<string, unknown>>) : [];
      const expenses = await withLineMeta(rpc, rows, (row) => row.id);
      if (!Array.isArray(expenses)) return expenses;
      return ok({ ...found.json, expenses });
    }
    const direction = textOf(args.direction);
    if (typeof direction !== "string" && direction != null) return direction;
    if (direction != null && direction !== "expense" && direction !== "income") return fail("validation", "validation");
    const reason = textOf(args.reason);
    if (typeof reason !== "string" && reason != null) return reason;
    const supplier = textOf(args.supplier);
    if (typeof supplier !== "string" && supplier != null) return supplier;
    const query = textOf(args.query);
    if (typeof query !== "string" && query != null) return query;
    const from = dateOf(args.from);
    if (typeof from !== "string" && from != null) return from;
    const to = dateOf(args.to);
    if (typeof to !== "string" && to != null) return to;
    const listed = await rpc("list_review", {});
    if (listed.status >= 400 || !Array.isArray(listed.json)) return fail("refused", "The read was refused.");
    const page = filterReviews(listed.json as Review[], {
      direction,
      reason,
      supplier,
      query,
      from,
      to,
      limit,
      offset,
    });
    const reviews = await withLineMeta(rpc, page.reviews, (row) => row.transaction_id);
    if (!Array.isArray(reviews)) return reviews;
    return ok({ ...page, reviews });
  }

  if (name === "list_loans") {
    const includeClosed = args.include_closed ?? true;
    if (typeof includeClosed !== "boolean") return fail("validation", "validation");
    const loans = await loadLoans(rpc);
    if (!Array.isArray(loans)) return loans;
    return ok({ loans: includeClosed ? loans : loans.filter((loan) => (loan.status ?? "open") === "open") });
  }

  if (name === "get_loan_schedule") {
    const loanId = args.loan_id;
    if (typeof loanId !== "string" || !UUID.test(loanId)) return fail("validation", "validation");
    const fromIndex = args.from == null ? 0 : args.from;
    if (typeof fromIndex !== "number" || !Number.isInteger(fromIndex) || fromIndex < 0) {
      return fail("validation", "validation");
    }
    const limit = scheduleLimitOf(args.limit, 12);
    if (typeof limit !== "number") return limit;
    const loans = await loadLoans(rpc);
    if (!Array.isArray(loans)) return loans;
    const asOf = args.as_of ?? todayIso();
    if (!isCalendarDate(asOf)) return fail("validation", "validation");
    const loan = loans.find((row) => row.id === loanId);
    if (loan == null) return fail("not_found", "not found");
    if (loanKindOf(loan) === "demand") {
      // Nothing is scheduled ahead: the payments attached so far, then the interest accrued
      // from the last one to as_of (default today), daily on actual/365 (decision 0132).
      const payments = await loadLoanPayments(loan.id, rpc);
      if (!Array.isArray(payments)) return payments;
      const counted = countedPayments(payments, null).filter((row) => row.doc_date <= asOf);
      let statement: ReturnType<typeof demandStatement>;
      try {
        statement = demandStatement(demandTermsOf(loan), demandPaymentsOf(counted), asOf);
      } catch (error) {
        if (error instanceof LoanScheduleError) return fail("validation", "validation");
        throw error;
      }
      const accrued = statement.accrued;
      return ok({
        loan_id: loanId,
        kind: "demand",
        from: fromIndex,
        limit,
        total: statement.rows.length,
        rows: statement.rows.slice(fromIndex, fromIndex + limit).map(scheduleRowOut),
        accrued: {
          as_of: asOf,
          since: accrued.fromDate,
          days: accrued.days,
          carried: majorString(accrued.carriedMinor),
          carried_minor: Number(accrued.carriedMinor),
          interest: majorString(accrued.interestMinor),
          interest_minor: Number(accrued.interestMinor),
          balance: majorString(accrued.balanceMinor),
          balance_minor: Number(accrued.balanceMinor),
        },
      });
    }
    const schedule = storedLoanSchedule(loan);
    if (!("rows" in schedule)) return schedule;
    const rows = schedule.rows.slice(fromIndex, fromIndex + limit).map(scheduleRowOut);
    return ok({ loan_id: loanId, kind: loanKindOf(loan), from: fromIndex, limit, total: schedule.rows.length, rows });
  }

  if (name !== "get_expense") return fail("validation", "validation");

  const transactionId = args.transaction_id;
  if (typeof transactionId !== "string" || !UUID.test(transactionId)) return fail("validation", "validation");
  const result = await rpc("get_transaction", { p_id: transactionId });
  if (result.status >= 400) return fail("refused", "The read was refused.");
  if (result.json == null) return fail("not_found", "not found");
  const metas = await lineMetaOf(rpc, [transactionId]);
  if (!(metas instanceof Map)) return metas;
  const row: Record<string, unknown> = {
    ...(result.json as Record<string, unknown>),
    meta: metas.get(transactionId) ?? { ...NO_LINE_META },
  };
  // A line split by category shows its parts. A failed parts read fails the whole read, so a
  // split line never looks whole under its own category.
  const split = await rpc("get_line_split", { p_transaction_id: transactionId });
  if (split.status >= 400) return fail("refused", "The read was refused.");
  const parts = (split.json as { parts?: unknown } | null)?.parts;
  let out: Record<string, unknown> = row;
  if (Array.isArray(parts) && parts.length > 0 && typeof row === "object" && !Array.isArray(row)) {
    const { transaction_id: _id, ...lineSplit } = split.json as Record<string, unknown>;
    out = { ...row, line_split: lineSplit };
  }
  if (row.direction === "income") return ok({ ...out, loan_split: null });
  const loanSplit = await rpc("get_loan_split", { p_transaction_id: transactionId });
  if (loanSplit.status >= 400) return fail("refused", "The read was refused.");
  return ok({ ...out, loan_split: loanSplit.json ?? null });
}
