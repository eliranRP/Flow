import { z } from "zod";

export const basisSchema = z.enum(["cash", "invoiced"]);

/** JSON numbers and digit strings both become bigint agorot. Fractions are rejected. */
const agorotInput = z.union([z.number().int(), z.string().regex(/^-?\d+$/)]);

export const agorotSchema = agorotInput.transform((value) => BigInt(value));

const agorotOrNull = z
  .union([agorotInput, z.null()])
  .transform((value) => (value == null ? null : BigInt(value)));

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
  direction: z.enum(["income", "expense"]),
  reason: z.string().nullable(),
  project_id: z.string().nullable(),
  category_id: z.string().nullable(),
  supplier_name: z.string().nullable(),
  doc_kind: z.string().optional(),
  vat_agorot: agorotSchema.optional(),
  project_name: z.string().nullable().optional(),
  category_name: z.string().nullable().optional(),
  /** Present only when a suggestion carries a confidence. AI tagging is off, so live rows omit it. */
  confidence: z.number().int().min(0).max(100).nullable().optional(),
  auto_approved_today: z.number().int().nonnegative().optional(),
});

export const categoryRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["expense", "income"]),
  hidden: z.boolean(),
  is_default: z.boolean(),
});

export const sumitStatusSchema = z.object({
  connected: z.boolean(),
  sumit_company_id: z.number().nullable(),
  last_sync_at: z.string().nullable(),
  last_error: z.string().nullable(),
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
    categories: z.array(
      z.object({
        id: z.string().nullable(),
        name: z.string().nullable(),
        amount_agorot: agorotSchema,
      }),
    ),
    transactions: z.array(
      z.object({
        id: z.string(),
        description: z.string(),
        doc_date: z.string(),
        amount_net: agorotSchema,
        direction: z.string(),
        source: z.string().optional(),
        doc_kind: z.string().optional(),
        category: z.string().nullable(),
      }),
    ),
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
    vat_status: z.string(),
    doc_kind: z.string().optional(),
    source: z.string(),
    project_name: z.string().nullable(),
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
  })
  .nullable();

export type Basis = z.infer<typeof basisSchema>;
export type Dashboard = z.infer<typeof dashboardSchema>;
export type ProjectRow = z.infer<typeof projectRowSchema>;
export type UnpaidRow = z.infer<typeof unpaidRowSchema>;
export type ReviewRow = z.infer<typeof reviewRowSchema>;
export type CategoryRow = z.infer<typeof categoryRowSchema>;
export type SumitStatus = z.infer<typeof sumitStatusSchema>;
export type ProjectDetail = z.infer<typeof projectDetailSchema>;
export type TransactionDetail = z.infer<typeof transactionDetailSchema>;
