import { z } from "zod";

export const basisSchema = z.enum(["cash", "invoiced"]);

export const projectRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["active", "finished"]),
  state_label: z.string().nullable().optional(),
  budget_agorot: z.number().nullable().optional(),
  sumit_budget_section_id: z.number().nullable().optional(),
  income_agorot: z.number(),
  direct_agorot: z.number(),
  shared_agorot: z.number(),
  profit_before_shared_agorot: z.number(),
  profit_agorot: z.number(),
});

export const dashboardSchema = z.object({
  company_id: z.string().nullable(),
  name: z.string().nullable(),
  vat_registered: z.boolean(),
  basis: basisSchema,
  from: z.string().nullable(),
  to: z.string().nullable(),
  income_agorot: z.number(),
  direct_agorot: z.number(),
  shared_agorot: z.number(),
  overhead_agorot: z.number(),
  expense_agorot: z.number(),
  net_profit_agorot: z.number(),
  prev_income_agorot: z.number().nullable(),
  prev_expense_agorot: z.number().nullable(),
  prev_net_agorot: z.number().nullable(),
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
  open_gross_agorot: z.number(),
  open_net_agorot: z.number(),
});

export const reviewRowSchema = z.object({
  id: z.string(),
  transaction_id: z.string(),
  description: z.string(),
  doc_date: z.string(),
  amount_net: z.number(),
  direction: z.enum(["income", "expense"]),
  reason: z.string().nullable(),
  project_id: z.string().nullable(),
  category_id: z.string().nullable(),
  supplier_name: z.string().nullable(),
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
  drift_fields: z.string().nullable().optional(),
  calls_used: z.number().optional(),
  calls_cap: z.number().optional(),
});

export type Basis = z.infer<typeof basisSchema>;
export type Dashboard = z.infer<typeof dashboardSchema>;
export type ProjectRow = z.infer<typeof projectRowSchema>;
export type UnpaidRow = z.infer<typeof unpaidRowSchema>;
export type ReviewRow = z.infer<typeof reviewRowSchema>;
export type CategoryRow = z.infer<typeof categoryRowSchema>;
export type SumitStatus = z.infer<typeof sumitStatusSchema>;
