import { z } from "zod";

// FLOW-445: projects_cash_month. One month's cash per project (the overhead project included), and the
// unassigned bucket. Amounts are integer minor units of each currency; the base currency comes first.
// FLOW-1204: `pending_count` and `deletable` (the project menu's) come only with `p_project`; the list's answer has neither.
// FLOW-1205: no `group_id` on a row and no `month` or `basis`: nothing reads them.
// FLOW-1213: `unassigned` is the list's only (no `p_project`). FLOW-1223: one project's answer holds a constant stub
// ({count: 0, cash: []}) for the app before FLOW-1213, which requires the key, until FLOW-1224 drops it.

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
  created_at: z.string(),
  finished_on: z.string().nullable(),
  budget_minor: z.number().int().nullable(),
  spent_minor: z.number().int(),
  cash: z.array(cashRowSchema),
  profit_all_minor: z.number().int(),
  first_month: monthSchema.nullable(),
  /** Only in the answer for one project (`p_project`): the lines waiting on a review. */
  pending_count: z.number().int().optional(),
  /** Only in the answer for one project: nothing refers to it (private.project_is_empty), so the menu may offer to delete it. */
  deletable: z.boolean().optional(),
});

/** `projects_cash_month`: null when no company is readable, or the project is another company's. */
export const projectsCashMonthSchema = z
  .object({
    base_currency: currencySchema,
    projects: z.array(projectRowSchema),
    /** The lines with no project, in the list's answer (no `p_project`); one project's answer carries a stub (FLOW-1223). */
    unassigned: z
      .object({
        count: z.number().int(),
        cash: z.array(cashRowSchema),
      })
      .optional(),
  })
  .nullable();

export type ProjectsCashMonth = z.infer<typeof projectsCashMonthSchema>;
export type ProjectCashRow = NonNullable<ProjectsCashMonth>["projects"][number];
export type ProjectCashCurrencyRow = ProjectCashRow["cash"][number];
