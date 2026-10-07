// Cycle 2 reads, cycle 3a single-expense writes, cycle 4 project/category/sync, cycle 5 loans, cycle 6 batch. Decision 0080.
// sync_bank starts a job and get_sync_status reads it. Decision 0101.
// Identity is not an argument. The handler signs from the credential row.
// Zod checks write arguments. A failure is the fixed validation message.

import { z } from "zod";
import { MERCURY_SYNC_FUNCTION } from "../_shared/connectors/mercury/capabilities.ts";
import {
  buildLoanSchedule,
  contractualPaymentMinor,
  LoanScheduleError,
  LOAN_TERM_MONTHS_MAX,
  type LoanScheduleRow,
} from "../../../packages/shared/src/loan-schedule.ts";
import { allocateLoanSplit, scheduleRowForDate } from "../../../packages/shared/src/loan-split.ts";
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
  "sync_bank",
  "hide_category",
  "set_category_pnl",
  "add_loan",
  "update_loan",
  "attach_loan_payment",
  "undo",
  "undo_batch",
] as const;

const IDENTITY = new Set(["user_id", "p_user", "company_id", "sub", "mcp_tid"]);
const READ_REFUSED = "The read was refused.";
const WRITE_REFUSED = "The write was refused.";
const TOOL_CODES = new Set(["forbidden", "validation", "not_found", "conflict", "already_closed", "refused", "unavailable"]);
const ALLOWED: Record<string, Set<string>> = {
  list_projects: new Set(["from", "to", "basis"]),
  get_project: new Set(["id", "basis"]),
  list_categories: new Set(),
  list_review: new Set(["direction", "reason", "supplier", "query", "from", "to", "limit", "offset"]),
  get_expense: new Set(["transaction_id"]),
  search_expenses: new Set(["scope", "query", "limit", "offset"]),
  get_totals: new Set(["from", "to", "basis"]),
  list_loans: new Set([]),
  get_loan_schedule: new Set(["loan_id", "from", "limit"]),
  get_sync_status: new Set(["job_id"]),
  assign_expense: new Set(["idempotency_key", "transaction_id", "project_id", "category_id", "remember"]),
  assign_expense_split: new Set(["idempotency_key", "transaction_id", "category_id", "shares"]),
  assign_expenses: new Set(["idempotency_key", "items"]),
  set_expense_category: new Set(["idempotency_key", "transaction_id", "category_id"]),
  create_project: new Set(["idempotency_key", "name", "status"]),
  create_category: new Set(["idempotency_key", "name", "kind"]),
  sync_bank: new Set(["idempotency_key"]),
  hide_category: new Set(["idempotency_key", "category_id"]),
  set_category_pnl: new Set(["idempotency_key", "category_id", "excluded"]),
  add_loan: new Set([
    "idempotency_key", "name", "principal", "annual_rate_percent", "term_months",
    "start_date", "payment", "escrow", "currency",
  ]),
  update_loan: new Set(["idempotency_key", "loan_id", "name", "principal", "annual_rate_percent", "term_months", "start_date", "payment", "escrow"]),
  attach_loan_payment: new Set(["idempotency_key", "transaction_id", "loan_id"]),
  undo: new Set(["idempotency_key", "kind", "id"]),
  undo_batch: new Set(["idempotency_key", "batch_key"]),
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_TEXT = z.string().regex(UUID);
const IDEMPOTENCY_KEY = z.string().min(1).max(128);
// A batch key leaves room for ":" and a three-digit ordinal on each row key.
const BATCH_KEY = z.string().min(1).max(124);
const assignSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  transaction_id: UUID_TEXT,
  project_id: UUID_TEXT,
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
const categorySchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  transaction_id: UUID_TEXT,
  category_id: UUID_TEXT,
}).strict();
const undoSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  kind: z.enum(["review", "reassign", "project", "category", "category_hidden", "category_pnl", "loan", "loan_update", "loan_split"]),
  id: UUID_TEXT,
}).strict();
const LOAN_NAME = z.string().trim().min(1).max(80);
const LOAN_CURRENCY = z.string().regex(/^[A-Z]{3}$/);
const addLoanSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  name: LOAN_NAME,
  principal: z.union([z.number(), z.string()]),
  annual_rate_percent: z.union([z.number(), z.string()]),
  term_months: z.number().int().min(1).max(LOAN_TERM_MONTHS_MAX),
  start_date: z.string().regex(DATE),
  payment: z.union([z.number(), z.string()]).optional(),
  escrow: z.union([z.number(), z.string()]).optional(),
  currency: LOAN_CURRENCY.optional(),
}).strict();
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
}).strict();
const attachLoanSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  transaction_id: UUID_TEXT,
  loan_id: UUID_TEXT,
}).strict();
const createProjectSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  name: z.string().trim().min(2).max(120),
  status: z.enum(["active", "finished"]).optional(),
}).strict();
const createCategorySchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  name: z.string().trim().min(2).max(120),
  kind: z.enum(["expense", "income"]),
}).strict();
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
const batchItemSchema = z.object({
  transaction_id: UUID_TEXT,
  project_id: UUID_TEXT.optional(),
  category_id: UUID_TEXT.optional(),
  remember: z.boolean().optional(),
  shares: SPLIT_SHARES.optional(),
}).strict().superRefine((item, ctx) => {
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
  term_months: number;
  start_date: string;
  payment_minor: number;
  escrow_minor: number;
  balance_minor: number;
};

function loanTermsOf(loan: LoanRow, paymentMinor: bigint, escrowMinor: bigint) {
  return {
    principalMinor: BigInt(loan.principal_minor),
    annualRatePpm: loan.annual_rate_ppm,
    termMonths: loan.term_months,
    startDate: loan.start_date,
    paymentMinor,
    escrowMinor,
  };
}

async function loadLoans(rpc: ToolRpc): Promise<ToolResult | LoanRow[]> {
  const result = await rpc("mcp_list_loans", {});
  if (result.status >= 400 || !Array.isArray(result.json)) return fail("refused", READ_REFUSED);
  return result.json as LoanRow[];
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
    toolSpec("list_projects", "Projects and their profit for a period. Omit both dates for all time. Amounts in *_agorot are ILS only. by_currency gives each currency's P&L in minor units (cents for USD).", {
      from: { type: "string" },
      to: { type: "string" },
      basis: { type: "string", enum: ["cash", "invoiced"] },
    }),
    toolSpec("get_project", "One project's P&L, categories, and its 40 newest lines. id is the project id from list_projects. basis is cash or invoiced (default cash, like list_projects and get_totals). Amounts in *_agorot are ILS only. by_currency and categories_by_currency are in minor units per currency (cents for USD). Expense categories kept out of the P&L are not in categories or the totals; they are listed in excluded_categories_by_currency. Each transaction carries its currency. A project outside the company is not_found.", {
      id: { type: "string" },
      basis: { type: "string", enum: ["cash", "invoiced"] },
    }),
    toolSpec("list_categories", "The company's categories.", {}),
    toolSpec("list_review", "Open review items. id is the review id. transaction_id is the ledger id.", {
      direction: { type: "string", enum: ["expense", "income"] },
      reason: { type: "string" },
      supplier: { type: "string" },
      query: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      limit: { type: "integer" },
      offset: { type: "integer" },
    }),
    toolSpec("get_expense", "One ledger row, including its allocations. transaction_id is the ledger id.", {
      transaction_id: { type: "string" },
    }),
    toolSpec("search_expenses", "Search pending review rows, filed rows, or both. id is the ledger id.", {
      scope: { type: "string", enum: ["pending", "filed", "all"] },
      query: { type: "string" },
      limit: { type: "integer" },
      offset: { type: "integer" },
    }),
    toolSpec("get_totals", "Company totals for a period. Omit both dates for all time. Amounts in *_agorot are ILS only. by_currency gives each currency's P&L in minor units (cents for USD).", {
      from: { type: "string" },
      to: { type: "string" },
      basis: { type: "string", enum: ["cash", "invoiced"] },
    }),
    toolSpec("list_loans", "Loans in the company with current principal balance.", {}),
    toolSpec("get_loan_schedule", "Amortization rows for one loan.", {
      loan_id: { type: "string" },
      from: { type: "integer" },
      limit: { type: "integer" },
    }),
    syncStatusSpec(),
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

function writeTools() {
  return [
    toolSpec("assign_expense", "Assign one expense or income line to a project and category. An open review is closed. Income needs a project unless the category is off-P&L.", {
      idempotency_key: { type: "string" },
      transaction_id: { type: "string" },
      project_id: { type: "string" },
      category_id: { type: "string" },
      remember: { type: "boolean" },
    }, true),
    toolSpec("assign_expense_split", "Split one expense across projects. Each share is a whole percent; shares must sum to 100. Optional category_id sets the category like assign_expense.", {
      idempotency_key: { type: "string" },
      transaction_id: { type: "string" },
      category_id: { type: "string" },
      shares: SHARES_SPEC,
    }, true),
    toolSpec("assign_expenses", "Assign up to 200 expenses in one write. Partial success is allowed. A row with shares[] splits that expense like assign_expense_split.", {
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
          },
          required: ["transaction_id"],
          additionalProperties: false,
        },
      },
    }, true),
    toolSpec("set_expense_category", "Set one expense category. Shares stay. An open review is closed.", {
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
    toolSpec("add_loan", "Create a loan with a computed level payment unless payment is set.", {
      idempotency_key: { type: "string" },
      name: { type: "string" },
      principal: { type: "string" },
      annual_rate_percent: { type: "number" },
      term_months: { type: "integer" },
      start_date: { type: "string" },
      payment: { type: "string" },
      escrow: { type: "string" },
      currency: { type: "string" },
    }, true),
    toolSpec("update_loan", "Patch loan terms. Currency cannot change.", {
      idempotency_key: { type: "string" },
      loan_id: { type: "string" },
      name: { type: "string" },
      principal: { type: "string" },
      annual_rate_percent: { type: "number" },
      term_months: { type: "integer" },
      start_date: { type: "string" },
      payment: { type: "string" },
      escrow: { type: "string" },
    }, true),
    toolSpec("attach_loan_payment", "Split one expense line across interest, escrow, and principal.", {
      idempotency_key: { type: "string" },
      transaction_id: { type: "string" },
      loan_id: { type: "string" },
    }, true),
    toolSpec("undo", "Undo one assistant write recorded for this user.", {
      idempotency_key: { type: "string" },
      kind: { type: "string", enum: ["review", "reassign", "project", "category", "category_hidden", "category_pnl", "loan", "loan_update", "loan_split"] },
      id: { type: "string" },
    }, true),
    toolSpec("undo_batch", "Undo every successful row from a prior assign_expenses batch.", {
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
  const principalMinor = minorFromMajor(parsed.data.principal);
  if (typeof principalMinor !== "bigint") return principalMinor;
  const ratePpm = ppmFromPercent(parsed.data.annual_rate_percent);
  if (typeof ratePpm !== "number") return ratePpm;
  const escrowMinor = minorFromMajorNonNegative(parsed.data.escrow, 0n);
  if (typeof escrowMinor !== "bigint") return escrowMinor;
  let paymentMinor: bigint | ToolResult;
  if (parsed.data.payment == null) {
    try {
      paymentMinor = contractualPaymentMinor({
        principalMinor,
        annualRatePpm: ratePpm,
        termMonths: parsed.data.term_months,
      }) + escrowMinor;
    } catch (error) {
      if (error instanceof LoanScheduleError) return fail("validation", error.code);
      return fail("validation", "validation");
    }
  } else {
    paymentMinor = minorFromMajor(parsed.data.payment);
    if (typeof paymentMinor !== "bigint") return paymentMinor;
  }
  let currency = parsed.data.currency;
  if (currency == null) {
    const defaulted = await defaultLoanCurrency(rpc);
    if (typeof defaulted !== "string") return defaulted;
    currency = defaulted;
  }
  try {
    buildLoanSchedule({
      principalMinor,
      annualRatePpm: ratePpm,
      termMonths: parsed.data.term_months,
      startDate: parsed.data.start_date,
      paymentMinor,
      escrowMinor,
    });
  } catch (error) {
    if (error instanceof LoanScheduleError) return fail("validation", error.code);
    return fail("validation", "validation");
  }
  const schedule = buildLoanSchedule({
    principalMinor,
    annualRatePpm: ratePpm,
    termMonths: parsed.data.term_months,
    startDate: parsed.data.start_date,
    paymentMinor,
    escrowMinor,
  });
  const result = await rpc("mcp_add_loan", {
    p_idempotency_key: parsed.data.idempotency_key,
    p_name: parsed.data.name,
    p_principal_minor: Number(principalMinor),
    p_annual_rate_ppm: ratePpm,
    p_term_months: parsed.data.term_months,
    p_start_date: parsed.data.start_date,
    p_payment_minor: Number(paymentMinor),
    p_escrow_minor: Number(escrowMinor),
    p_currency: currency,
  });
  if (result.status >= 400) return fail("refused", WRITE_REFUSED);
  const wrapped = envelopeOf(result.json);
  if (wrapped.isError) return wrapped;
  const data = (wrapped.structuredContent as { ok: true; data: Record<string, unknown> }).data;
  return ok({
    ...data,
    payment: majorString(paymentMinor),
    payment_minor: Number(paymentMinor),
    schedule_preview: schedule.rows.slice(0, 3).map(scheduleRowOut),
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
  if (Object.keys(patch).length === 0) return fail("validation", "validation");
  const result = await rpc("mcp_update_loan", {
    p_idempotency_key: parsed.data.idempotency_key,
    p_loan_id: parsed.data.loan_id,
    p_patch: patch,
  });
  if (result.status >= 400) return fail("refused", WRITE_REFUSED);
  return envelopeOf(result.json);
}

async function attachLoanWrite(args: Record<string, unknown>, rpc: ToolRpc): Promise<ToolResult> {
  const parsed = attachLoanSchema.safeParse(args);
  if (!parsed.success) return fail("validation", "validation");
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
  if (BigInt(loan.balance_minor) <= 0n) return fail("refused", "loan balance exceeded");
  const schedule = buildLoanSchedule(loanTermsOf(loan, BigInt(loan.payment_minor), BigInt(loan.escrow_minor)));
  const row = scheduleRowForDate(schedule.rows, docDate);
  if (row == null) return fail("refused", "no schedule row for this date");
  const parts = allocateLoanSplit({
    lineMinor,
    interestMinor: row.interestMinor,
    escrowMinor: row.escrowMinor,
    principalMinor: row.principalMinor,
  });
  const principalPart = parts.find((part) => part.part === "principal")?.amountMinor ?? 0n;
  if (principalPart > BigInt(loan.balance_minor)) return fail("refused", "loan balance exceeded");
  const payload = parts.map((part) => ({
    part: part.part,
    amount_minor: Number(part.amountMinor),
    scheduled_minor: Number(part.scheduledMinor),
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
      p_project_id: parsed.data.project_id,
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
  } else if (name === "add_loan") {
    return addLoanWrite(args, rpc);
  } else if (name === "update_loan") {
    return updateLoanWrite(args, rpc);
  } else if (name === "attach_loan_payment") {
    return attachLoanWrite(args, rpc);
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
    return ok({ projects: projects.map(projectRow) });
  }

  if (name === "get_project") {
    const projectId = args.id;
    if (typeof projectId !== "string" || !UUID.test(projectId)) return fail("validation", "validation");
    const basis = args.basis == null ? "cash" : args.basis;
    if (basis !== "cash" && basis !== "invoiced") return fail("validation", "validation");
    const result = await rpc("get_project", { p_id: projectId, p_basis: basis });
    if (result.status >= 400) return fail("refused", READ_REFUSED);
    // The RPC returns null for an unknown id and for another company's project.
    if (result.json == null) return fail("not_found", "not found");
    if (typeof result.json !== "object" || Array.isArray(result.json)) return fail("refused", READ_REFUSED);
    return ok({ ...(result.json as Review), basis });
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
        return ok({
          total: page.total,
          expenses: page.reviews.map((row) => ({ ...row, id: row.transaction_id })),
        });
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
      return ok(found.json);
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
    return ok(filterReviews(listed.json as Review[], {
      direction,
      reason,
      supplier,
      query,
      from,
      to,
      limit,
      offset,
    }));
  }

  if (name === "list_loans") {
    const loans = await loadLoans(rpc);
    if (!Array.isArray(loans)) return loans;
    return ok({ loans });
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
    const loan = loans.find((row) => row.id === loanId);
    if (loan == null) return fail("not_found", "not found");
    const schedule = buildLoanSchedule(loanTermsOf(loan, BigInt(loan.payment_minor), BigInt(loan.escrow_minor)));
    const rows = schedule.rows.slice(fromIndex, fromIndex + limit).map(scheduleRowOut);
    return ok({ loan_id: loanId, from: fromIndex, limit, total: schedule.rows.length, rows });
  }

  if (name !== "get_expense") return fail("validation", "validation");

  const transactionId = args.transaction_id;
  if (typeof transactionId !== "string" || !UUID.test(transactionId)) return fail("validation", "validation");
  const result = await rpc("get_transaction", { p_id: transactionId });
  if (result.status >= 400) return fail("refused", "The read was refused.");
  if (result.json == null) return fail("not_found", "not found");
  return ok(result.json);
}
