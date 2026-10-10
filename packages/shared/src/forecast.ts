import { z } from "zod";
import { agorotSchema } from "./dashboard.ts";

/**
 * Jev missing bills and expected months (decision 0131). Both are SQL reads; the app only
 * draws them. Amounts are minor units in the party's currency, expenses negative.
 */

const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** FLOW-415 (decision 0175): how often a recurring party comes. */
export const paceSchema = z.enum(["month", "2months", "quarter", "year"]);
export type RecurringPace = z.infer<typeof paceSchema>;

/** One recurring supplier whose bill for this month has not come in (`missing_bills`). */
export const missingBillSchema = z.object({
  /** null on an income row (decision 0175): the party is a customer. */
  supplier_id: z.string().nullable(),
  supplier_name: z.string().nullable().transform((name) => name ?? ""),
  /** FLOW-415 (decision 0175): the party, a supplier or a customer. */
  direction: z.enum(["expense", "income"]).optional(),
  party_id: z.string().optional(),
  party_name: z.string().nullable().optional(),
  currency: currencySchema,
  typical_amount_minor: agorotSchema,
  typical_day: z.number().int(),
  expected_by: daySchema,
  months_seen: z.number().int().nonnegative(),
  last_doc_date: daySchema.nullable().optional(),
  project_id: z.string().nullable().optional(),
  category_id: z.string().nullable().optional(),
  /** FLOW-415 (decision 0172): the last bill's net, and the names of where it files. */
  last_amount_minor: agorotSchema.nullable().optional(),
  project_name: z.string().nullable().optional(),
  category_name: z.string().nullable().optional(),
  /** `auto` found by the rule, `user` marked recurring by the owner. */
  source: z.enum(["auto", "user"]).optional(),
  /** FLOW-415 (decision 0175): how often it comes, and the month it is late for (YYYY-MM). */
  pace: paceSchema.optional(),
  pace_source: z.enum(["auto", "user"]).optional(),
  due_month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  /** The key `dismiss_recurring_alert('missing', …)` takes. */
  alert_key: z.string().optional(),
});

/** `missing_bills` returns a JSON array, ordered by the typical day. */
export const missingBillsSchema = z.array(missingBillSchema).nullable().transform((rows) => rows ?? []);

/**
 * FLOW-415 (decision 0172): a recurring supplier seen this month whose lines so far differ from the
 * usual amount by 20% or more, either way (`recurring_changes`). Largest change first.
 */
export const recurringChangeSchema = z.object({
  supplier_id: z.string().nullable(),
  supplier_name: z.string().nullable().transform((name) => name ?? ""),
  direction: z.enum(["expense", "income"]).optional(),
  party_id: z.string().optional(),
  party_name: z.string().nullable().optional(),
  /** `recurring_this_month` (decision 0175): true at 20% or more either way. */
  changed: z.boolean().optional(),
  pace: paceSchema.optional(),
  /** The key `dismiss_recurring_alert('change', …)` takes: the payment's id. */
  alert_key: z.string().optional(),
  currency: currencySchema,
  amount_minor: agorotSchema,
  typical_amount_minor: agorotSchema,
  /** Signed whole percent: 38 is up 38%. */
  change_percent: z.number().int(),
  typical_day: z.number().int().nullable().optional(),
  transaction_id: z.string(),
  project_id: z.string().nullable().optional(),
  project_name: z.string().nullable().optional(),
  category_id: z.string().nullable().optional(),
  category_name: z.string().nullable().optional(),
  source: z.enum(["auto", "user"]).optional(),
  /** FLOW-913: how many of this month's lines `amount_minor` sums (several rents from one party). */
  line_count: z.number().int().optional(),
});

export const recurringChangesSchema = z.array(recurringChangeSchema).nullable().transform((rows) => rows ?? []);

/**
 * FLOW-415 (decision 0175): every recurring supplier and customer seen this month, changed or not
 * (`recurring_this_month`), for הגיעו החודש. The same rows as `recurring_changes`, not filtered by
 * dismissals. Expenses first, then by name.
 */
export const recurringThisMonthSchema = recurringChangesSchema;

/**
 * FLOW-415: one payment's recurring switch (`payment_recurring`, and `set_payment_recurring` with
 * `prior_override` for the undo). A null party (no supplier or customer) cannot be marked.
 */
export const paymentRecurringSchema = z.object({
  transaction_id: z.string(),
  party: z
    .object({
      direction: z.enum(["income", "expense"]),
      id: z.string(),
      name: z.string().nullable().transform((name) => name ?? ""),
      currency: currencySchema,
    })
    .nullable(),
  recurring: z.boolean(),
  /** true or false: the owner's switch; null: the rule decides. */
  override: z.boolean().nullable(),
  detected: z.boolean(),
  typical_day: z.number().int().nullable(),
  typical_amount_minor: agorotSchema.nullable(),
  prior_override: z.boolean().nullable().optional(),
  /** FLOW-415 (decision 0175): how often it comes, the owner's or the detected one. */
  pace: paceSchema.nullable().optional(),
  /** The owner's pace; null: the detected one decides. */
  pace_override: paceSchema.nullable().optional(),
  detected_pace: paceSchema.nullable().optional(),
  /** yyyy-mm, the month the next payment is due. */
  next_due_month: z.string().nullable().optional(),
  /** set_payment_pace's pace before the change, for ביטול. */
  prior_pace: paceSchema.nullable().optional(),
});

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
export type RecurringChange = z.infer<typeof recurringChangeSchema>;
export type PaymentRecurring = z.infer<typeof paymentRecurringSchema>;
export type ExpectedParty = z.infer<typeof expectedPartySchema>;
export type ExpectedMonths = z.infer<typeof expectedMonthsSchema>;
export type ExpectedMonth = ExpectedMonths["months"][number];
