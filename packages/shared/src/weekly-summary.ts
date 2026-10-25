import { z } from "zod";

/** JSON numbers and digit strings both become bigint minor units. Fractions are rejected. */
const minorSchema = z.union([z.number().int(), z.string().regex(/^-?\d+$/)]).transform((value) => BigInt(value));

const countSchema = z.number().int().nonnegative();

/**
 * FLOW-517: `weekly_summary`, one company's week (Sunday to Saturday, Israel time) for the sheet the
 * Sunday push opens over Home. Money is in the base currency, in minor units; in − out = profit +
 * kept out. Lines waiting for review count in the sums, as on Home.
 */
export const weeklySummarySchema = z.object({
  week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  /** Bank and SUMIT lines that came in during the week. */
  lines: countSchema,
  /** Of those, never needed a review (0011). */
  auto_approved: countSchema,
  /** Of those, still waiting for review. */
  week_waiting: countSchema,
  /** The whole open review queue now, as Home and the push count it. */
  waiting: countSchema,
  in_minor: minorSchema,
  out_minor: minorSchema,
  profit_minor: minorSchema,
  /** Not counted in profit (renovation, owner's equity and the like). */
  kept_out_minor: minorSchema,
  /** The week before's profit; null before the books start. */
  prev_profit_minor: minorSchema.nullable(),
  /** The active project most over budget (largest overrun in percent), or null. */
  alert: z
    .object({
      project_id: z.string(),
      name: z.string(),
      spent_minor: minorSchema,
      budget_minor: minorSchema,
    })
    .nullable(),
  /** How many other active projects are over budget. */
  more_over_budget: countSchema,
});

export type WeeklySummary = z.output<typeof weeklySummarySchema>;
