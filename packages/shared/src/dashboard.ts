import { z } from "zod";

export const basisSchema = z.enum(["cash", "invoiced"]);

/** JSON numbers and digit strings both become bigint agorot. Fractions are rejected. */
const agorotInput = z.union([z.number().int(), z.string().regex(/^-?\d+$/)]);

export const agorotSchema = agorotInput.transform((value) => BigInt(value));

const agorotOrNull = z
  .union([agorotInput, z.null()])
  .transform((value) => (value == null ? null : BigInt(value)));

const projectByCurrencyRowSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  income_minor: agorotSchema,
  direct_minor: agorotSchema,
  shared_minor: agorotSchema,
  profit_minor: agorotSchema,
});

const companyByCurrencyRowSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  income_minor: agorotSchema,
  direct_minor: agorotSchema,
  shared_minor: agorotSchema,
  overhead_minor: agorotSchema,
  expense_minor: agorotSchema,
  net_profit_minor: agorotSchema,
  excluded_income_minor: agorotSchema.optional(),
  excluded_expense_minor: agorotSchema.optional(),
  excluded_count: z.number().int().nonnegative().optional(),
  count: z.number().int().nonnegative(),
});

export const projectRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["active", "finished"]),
  state_label: z.string().nullable().optional(),
  budget_agorot: agorotOrNull.nullish(),
  sumit_budget_section_id: z.number().nullable().optional(),
  income_agorot: agorotSchema,
  direct_agorot: agorotSchema,
  shared_agorot: agorotSchema,
  profit_before_shared_agorot: agorotSchema,
  profit_agorot: agorotSchema,
  by_currency: z.array(projectByCurrencyRowSchema).optional().default([]),
});

export const dashboardSchema = z.object({
  company_id: z.string().nullable(),
  name: z.string().nullable(),
  vat_registered: z.boolean(),
  basis: basisSchema,
  from: z.string().nullable(),
  to: z.string().nullable(),
  income_agorot: agorotSchema,
  direct_agorot: agorotSchema,
  shared_agorot: agorotSchema,
  overhead_agorot: agorotSchema,
  expense_agorot: agorotSchema,
  net_profit_agorot: agorotSchema,
  prev_income_agorot: agorotOrNull,
  prev_expense_agorot: agorotOrNull,
  prev_net_agorot: agorotOrNull,
  active_projects: z.number(),
  review_count: z.number(),
  projects: z.array(projectRowSchema),
  after_overhead: z.boolean().optional(),
  excluded_income_agorot: agorotSchema.optional(),
  excluded_expense_agorot: agorotSchema.optional(),
  by_currency: z.array(companyByCurrencyRowSchema).optional().default([]),
});

export const unpaidRowSchema = z.object({
  id: z.string(),
  description: z.string(),
  doc_date: z.string(),
  project_name: z.string().nullable(),
  customer_name: z.string().nullable(),
  open_gross_agorot: agorotSchema,
  open_net_agorot: agorotSchema,
});

export const reviewRowSchema = z.object({
  id: z.string(),
  transaction_id: z.string(),
  description: z.string(),
  doc_date: z.string(),
  amount_net: agorotSchema,
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  direction: z.enum(["income", "expense"]),
  /** Bank state of the line. A pending line may still change; the statement row shows a chip. FLOW-305. */
  line_status: z.enum(["pending", "posted", "void"]).optional().catch(undefined),
  /** Where the line came from. Older payloads omit it. FLOW-305. */
  source: z.enum(["sumit", "mercury", "manual", "photo"]).optional().catch(undefined),
  reason: z.string().nullable(),
  /** Set by list_review so a split is not treated as a single project. */
  pnl_role: z.enum(["project", "shared", "overhead"]).nullable().optional(),
  share_count: z.number().int().nonnegative().optional(),
  project_id: z.string().nullable(),
  category_id: z.string().nullable(),
  supplier_name: z.string().nullable(),
  doc_kind: z.string().optional(),
  vat_agorot: agorotSchema.optional(),
  project_name: z.string().nullable().optional(),
  category_name: z.string().nullable().optional(),
  /** False once the owner picked the category. Omitted on older payloads, which stay a suggestion. */
  category_suggested: z.boolean().optional(),
  /** True when the project on this row is a guess. A split, an owner pick, and a supplier rule are not. */
  project_suggested: z.boolean().optional(),
  /** Present only when a suggestion carries a confidence. AI tagging is off, so live rows omit it. */
  confidence: z.number().int().min(0).max(100).nullable().optional(),
  auto_approved_today: z.number().int().nonnegative().optional(),
  /** True when today's filed set includes an assistant approval. Decision 0080. */
  assistant_filed_today: z.boolean().optional(),
});

/** A SUMIT row filed today with no open review item. Same filter as auto_approved_today. */
export const filedTodaySchema = z.object({
  id: z.string(),
  description: z.string(),
  doc_date: z.string(),
  amount_net: agorotSchema,
  direction: z.enum(["income", "expense"]),
  supplier_name: z.string().nullable(),
  project_name: z.string().nullable(),
  category_name: z.string().nullable(),
});

export const categoryRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["expense", "income"]),
  hidden: z.boolean(),
  is_default: z.boolean(),
  excluded_from_pnl: z.boolean().optional(),
  /** Set on the three loan categories. Omitted on older payloads. */
  loan_part: z.string().nullable().optional(),
});

export const sumitStatusSchema = z.object({
  connected: z.boolean(),
  sumit_company_id: z.number().nullable(),
  last_sync_at: z.string().nullable(),
  last_error: z.string().nullable(),
  next_attempt_at: z.string().nullable().optional(),
  syncing: z.boolean().optional(),
});

export const mercuryStatusSchema = z.object({
  company_id: z.string().nullable(),
  provider: z.enum(["sumit", "mercury"]).nullable(),
  connected: z.boolean(),
  last_sync_at: z.string().nullable(),
  last_error: z.string().nullable(),
  next_attempt_at: z.string().nullable(),
  import_from: z.string().nullable(),
  account_labels: z.unknown().nullable(),
  skip_count: z.number().nullable(),
  syncing: z.boolean().optional(),
});

export const projectDetailSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    status: z.string(),
    state_label: z.string().nullable(),
    budget_agorot: agorotOrNull,
    income_agorot: agorotSchema,
    direct_agorot: agorotSchema,
    shared_agorot: agorotSchema,
    profit_agorot: agorotSchema,
    after_overhead: z.boolean().optional(),
    overhead_share_agorot: agorotOrNull.optional(),
    profit_after_overhead_agorot: agorotSchema.optional(),
    overhead_weighted: z.boolean().optional(),
    by_currency: z.array(projectByCurrencyRowSchema).optional(),
    categories_by_currency: z
      .array(
        z.object({
          currency: z.string().regex(/^[A-Z]{3}$/),
          id: z.string().nullable(),
          name: z.string().nullable(),
          amount_minor: agorotSchema,
          has_shared_share: z.boolean().optional(),
        }),
      )
      .optional(),
    excluded_categories_by_currency: z
      .array(
        z.object({
          currency: z.string().regex(/^[A-Z]{3}$/),
          id: z.string().nullable(),
          name: z.string().nullable(),
          amount_minor: agorotSchema,
          has_shared_share: z.boolean().optional(),
        }),
      )
      .optional(),
    categories: z.array(
      z.object({
        id: z.string().nullable(),
        name: z.string().nullable(),
        amount_agorot: agorotSchema,
        /** True when this line includes this project's share of a shared cost. */
        has_shared_share: z.boolean().optional(),
      }),
    ),
    /** Project expenses whose category is still a suggestion. Omitted on older payloads. */
    pending_count: z.number().int().nonnegative().optional(),
    pending_agorot: agorotSchema.optional(),
    /** Waiting expenses that are not ILS. They are not inside pending_agorot. */
    pending_other_currencies: z.array(z.object({
      currency: z.string(),
      expense_minor: agorotSchema,
      count: z.number().int().nonnegative(),
    })).optional(),
    transactions: z.array(
      z.object({
        id: z.string(),
        description: z.string(),
        doc_date: z.string(),
        amount_net: agorotSchema,
        currency: z.string().regex(/^[A-Z]{3}$/).optional(),
        direction: z.string(),
        source: z.string().optional(),
        doc_kind: z.string().optional(),
        category: z.string().nullable(),
      }),
    ),
    /** FLOW-119. Loans filed under the project (decision 0105). Omitted on older payloads. */
    loans: z.array(z.object({
      id: z.string(),
      name: z.string(),
      currency: z.string(),
      balance_minor: agorotSchema,
    })).optional(),
  })
  .nullable();

export const transactionDetailSchema = z
  .object({
    id: z.string(),
    description: z.string(),
    direction: z.string(),
    doc_date: z.string(),
    amount_gross: agorotSchema,
    amount_net: agorotSchema,
    vat_amount: agorotSchema,
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    vat_status: z.string(),
    doc_kind: z.string().optional(),
    source: z.string(),
    pnl_role: z.enum(["project", "shared", "overhead"]).nullable().optional(),
    review_reason: z.string().nullable().optional(),
    project_id: z.string().nullable().optional(),
    project_name: z.string().nullable(),
    category_id: z.string().nullable().optional(),
    review_status: z.enum(["open", "approved", "skipped", "changed"]).nullable().optional(),
    paid: z.boolean().nullable().optional(),
    open_gross_agorot: agorotOrNull.optional(),
    allocations: z
      .array(
        z.object({
          project_id: z.string(),
          project_name: z.string().nullable().optional(),
          share_bp: z.number(),
          amount_net: agorotSchema,
        }),
      )
      .optional(),
    category_name: z.string().nullable(),
    supplier_name: z.string().nullable(),
    customer_name: z.string().nullable(),
    /** FLOW-108: false keeps the line out of the P&L, true counts it, null follows the category. */
    in_pnl_override: z.boolean().nullable().optional(),
    category_excluded_from_pnl: z.boolean().optional(),
    in_pnl: z.boolean().optional(),
    /** A loan line: its parts decide what counts, so the override is refused. */
    pnl_fixed: z.boolean().optional(),
  })
  .nullable();

/** One page of a category line. The rows use the same filters as that line. */
export const projectCategorySchema = z
  .object({
    category_name: z.string().nullable(),
    project_name: z.string().nullable(),
    total_agorot: agorotSchema,
    rows: z.array(
      z.object({
        id: z.string(),
        description: z.string(),
        doc_date: z.string(),
        amount_net: agorotSchema,
      }),
    ),
    next_offset: z.number().int().nonnegative().nullable(),
  })
  .nullable();

/** Open reviews for a project, plus suggested expenses that have no open review. */
export const projectWaitingRowSchema = z.object({
  review_id: z.string().nullable(),
  transaction_id: z.string(),
  description: z.string(),
  doc_date: z.string(),
  amount_net: agorotSchema,
  direction: z.enum(["income", "expense"]),
  reason: z.string().nullable(),
  project_id: z.string().nullable(),
  category_id: z.string().nullable(),
  category_name: z.string().nullable(),
  supplier_name: z.string().nullable(),
});

export const projectWaitingSchema = z.array(projectWaitingRowSchema);

/** FLOW-301. Home's income or expenses by group (decision 0110). Amounts are positive for income and for a normal expense. */
export const breakdownGroupBySchema = z.enum(["category", "project", "payer"]);
export const breakdownDirectionSchema = z.enum(["income", "expense"]);

const breakdownSumSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  amount_minor: agorotSchema,
  count: z.number().int().nonnegative(),
});

export const breakdownSchema = z
  .object({
    direction: breakdownDirectionSchema,
    basis: basisSchema,
    group_by: breakdownGroupBySchema,
    from: z.string().nullable(),
    to: z.string().nullable(),
    totals: z.array(breakdownSumSchema),
    groups: z.array(
      breakdownSumSchema.extend({
        key: z.string(),
        name: z.string().nullable(),
        shared: z.boolean(),
      }),
    ),
    excluded: z.array(breakdownSumSchema),
    review_count: z.number().int().nonnegative(),
  })
  .nullable();

export const breakdownLinesSchema = z
  .object({
    rows: z.array(
      z.object({
        transaction_id: z.string(),
        part: z.string().nullable(),
        description: z.string(),
        supplier_name: z.string().nullable(),
        project_name: z.string().nullable(),
        category_name: z.string().nullable(),
        doc_date: z.string(),
        currency: z.string().regex(/^[A-Z]{3}$/),
        amount_minor: agorotSchema,
        shared: z.boolean(),
      }),
    ),
    has_more: z.boolean(),
  })
  .nullable();

export type Basis = z.infer<typeof basisSchema>;
export type BreakdownGroupBy = z.infer<typeof breakdownGroupBySchema>;
export type BreakdownDirection = z.infer<typeof breakdownDirectionSchema>;
export type Breakdown = z.infer<typeof breakdownSchema>;
export type BreakdownLinesPage = z.infer<typeof breakdownLinesSchema>;
export type Dashboard = z.infer<typeof dashboardSchema>;
export type ProjectRow = z.infer<typeof projectRowSchema>;
export type UnpaidRow = z.infer<typeof unpaidRowSchema>;
export type ReviewRow = z.infer<typeof reviewRowSchema>;
export type FiledTodayRow = z.infer<typeof filedTodaySchema>;
export type CategoryRow = z.infer<typeof categoryRowSchema>;
export type SumitStatus = z.infer<typeof sumitStatusSchema>;
export type MercuryStatus = z.infer<typeof mercuryStatusSchema>;
export type ProjectDetail = z.infer<typeof projectDetailSchema>;
export type ProjectCategoryPage = z.infer<typeof projectCategorySchema>;
export type ProjectWaitingRow = z.infer<typeof projectWaitingRowSchema>;
export type TransactionDetail = z.infer<typeof transactionDetailSchema>;
