import { z } from "zod";
import { agorotSchema } from "./dashboard.ts";

/**
 * FLOW-431 (decision 0178): a line's earlier charges from the same supplier (expense) or customer
 * (income) in its currency (`party_charges`). Amounts are minor units, expenses negative. The
 * server picks the usual amount and the percent; the app only draws them.
 */

const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const monthSchema = z.string().regex(/^\d{4}-\d{2}$/);

export const partyChargesSchema = z.object({
  transaction_id: z.string(),
  party: z
    .object({
      direction: z.enum(["income", "expense"]),
      id: z.string(),
      name: z.string().nullable().transform((name) => name ?? ""),
      currency: currencySchema,
    })
    .nullable(),
  /** yyyy-mm, the line's month; null with no party. */
  month: monthSchema.nullable(),
  /** The party's total in the line's month. */
  month_amount_minor: agorotSchema.nullable(),
  /** The recurring rule's usual amount, else the median of its earlier months; null with too little history. */
  typical_amount_minor: agorotSchema.nullable(),
  typical_source: z.enum(["recurring", "earlier_months"]).nullable(),
  /** Whole percent of the month against the usual amount, by size; null with no usual amount. */
  change_percent: z.number().int().nullable(),
  /** How many other charges the party has in the last 24 months. */
  others: z.number().int().nonnegative(),
  /** The 6 months up to the line's month, oldest first. */
  months: z.array(z.object({ month: monthSchema, amount_minor: agorotSchema })),
  /** The 12 newest charges, newest first. */
  charges: z.array(z.object({ id: z.string(), doc_date: daySchema, amount_minor: agorotSchema, pending: z.boolean() })),
});

export type PartyCharges = z.infer<typeof partyChargesSchema>;
