import { z } from "zod";

// FLOW-445: projects_cash_month. One month's cash per project (the overhead project included), and the
// unassigned bucket. Amounts are integer minor units of each currency; the base currency comes first.

const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const monthSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const cashRowSchema = z.object({
  currency: currencySchema,
  in_minor: z.number().int(),
  out_minor: z.number().int(),
  net_minor: z.number().int(),
});

const projectRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string().nullable(),
  status: z.enum(["active", "finished"]),
  is_overhead: z.boolean(),
  group_id: z.string().nullable(),
  created_at: z.string(),
  finished_on: z.string().nullable(),
  budget_minor: z.number().int().nullable(),
  spent_minor: z.number().int(),
  cash: z.array(cashRowSchema),
  profit_month_minor: z.number().int(),
  profit_all_minor: z.number().int(),
  first_month: monthSchema.nullable(),
  pending_count: z.number().int(),
  deletable: z.boolean(),
});

/** `projects_cash_month`: null when no company is readable, or the project is another company's. */
export const projectsCashMonthSchema = z
  .object({
    month: monthSchema,
    base_currency: currencySchema,
    basis: z.enum(["paid", "invoice"]),
    projects: z.array(projectRowSchema),
    unassigned: z.object({
      count: z.number().int(),
      cash: z.array(cashRowSchema),
    }),
  })
  .nullable();

export type ProjectsCashMonth = z.infer<typeof projectsCashMonthSchema>;
export type ProjectCashRow = NonNullable<ProjectsCashMonth>["projects"][number];
export type ProjectCashCurrencyRow = ProjectCashRow["cash"][number];
