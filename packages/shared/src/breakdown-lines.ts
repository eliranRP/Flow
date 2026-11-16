import { z } from "zod";
import { agorotSchema } from "./dashboard.ts";

/** One counted line of `get_breakdown_lines` as a keyed read (a category, the kept-out lines, or one project) returns it. */
const breakdownLineSchema = z.object({
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
  /** Where the line came from; "mercury" shows the bank icon (FLOW-125). Older payloads omit it. */
  source: z.string().optional().catch(undefined),
  /** FLOW-946: a gross-up part (paid from a deposit / netted against the line). Older payloads omit it. */
  gross_up: z.boolean().optional().catch(undefined),
  /** FLOW-954: the row's category, so a kept-out line sits under its own group. Older payloads omit it. */
  category_id: z.string().nullable().optional().catch(undefined),
});

const breakdownLinesPaging = {
  has_more: z.boolean(),
  /** FLOW-165: the whole group's total and row count, whatever page this is. Older payloads omit them. */
  total_minor: agorotSchema.optional().catch(undefined),
  count: z.number().int().nonnegative().optional().catch(undefined),
  /** FLOW-989: the group by project, as `get_pnl_statement` by project counts it (key: a project id, "overhead", "unassigned" or null). */
  projects: z.array(z.object({ key: z.string().nullable(), project_id: z.string().nullable(), name: z.string().nullable(), total_minor: agorotSchema })).optional().catch(undefined),
};

export const breakdownLinesSchema = z.object({ rows: z.array(breakdownLineSchema), ...breakdownLinesPaging }).nullable();

/**
 * FLOW-1207, FLOW-1211. The read with no group key: every counted line of a direction in one call, each row lean. A row
 * holds what the date and amount lists read, and `group_key`: the key a keyed read would have been asked with (the
 * category id, or "none"), which files it. What a keyed row also holds, and this one does not: `category_id` (that key,
 * null for "none"), `currency` (the one asked), `category_name` (the breakdown's), `kept_out` (false) and `shared` (no reader).
 */
export const breakdownLinesAllSchema = z
  .object({
    rows: z.array(breakdownLineSchema.omit({ category_name: true, currency: true, shared: true, category_id: true }).extend({ group_key: z.string() })),
    ...breakdownLinesPaging,
  })
  .nullable();

export type BreakdownLinesPage = z.infer<typeof breakdownLinesSchema>;
export type BreakdownLinesAll = z.infer<typeof breakdownLinesAllSchema>;
