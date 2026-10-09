import { z } from "zod";
import { agorotSchema } from "./dashboard.ts";

/**
 * Jev missing bills and expected months (decision 0131). Both are SQL reads; the app only
 * draws them. Amounts are minor units in the party's currency, expenses negative.
 */

const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** One recurring supplier whose bill for this month has not come in (`missing_bills`). */
export const missingBillSchema = z.object({
  supplier_id: z.string(),
  supplier_name: z.string().nullable().transform((name) => name ?? ""),
  currency: currencySchema,
  typical_amount_minor: agorotSchema,
  typical_day: z.number().int(),
  expected_by: daySchema,
  months_seen: z.number().int().nonnegative(),
  last_doc_date: daySchema.nullable().optional(),
  project_id: z.string().nullable().optional(),
  category_id: z.string().nullable().optional(),
});

/** `missing_bills` returns a JSON array, ordered by the typical day. */
export const missingBillsSchema = z.array(missingBillSchema).nullable().transform((rows) => rows ?? []);

const expectedCurrencySchema = z.object({
  currency: currencySchema,
  income_minor: agorotSchema,
  expense_minor: agorotSchema,
});

/** One recurring party behind the expected figures. */
export const expectedPartySchema = z.object({
  direction: z.enum(["income", "expense"]),
  party_id: z.string(),
  name: z.string().nullable().transform((name) => name ?? ""),
  currency: currencySchema,
  typical_amount_minor: agorotSchema,
  typical_day: z.number().int(),
  months_seen: z.number().int().nonnegative(),
  seen_this_month: z.boolean(),
  project_id: z.string().nullable().optional(),
  category_id: z.string().nullable().optional(),
});

/** `expected_months(months, project_id)`: this month (still to come) and the next ones. */
export const expectedMonthsSchema = z.object({
  today: daySchema,
  project_id: z.string().nullable().optional(),
  months: z
    .array(
      z.object({
        month: z.string().regex(/^\d{4}-\d{2}$/),
        open: z.boolean(),
        by_currency: z.array(expectedCurrencySchema).nullable().transform((rows) => rows ?? []),
      }),
    )
    .nullable()
    .transform((rows) => rows ?? []),
  recurring: z.array(expectedPartySchema).nullable().transform((rows) => rows ?? []),
});

export type MissingBill = z.infer<typeof missingBillSchema>;
export type ExpectedParty = z.infer<typeof expectedPartySchema>;
export type ExpectedMonths = z.infer<typeof expectedMonthsSchema>;
export type ExpectedMonth = ExpectedMonths["months"][number];
