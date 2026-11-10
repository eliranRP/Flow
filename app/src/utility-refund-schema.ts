import { z } from "zod";

/**
 * FLOW-1135 (decision 0265): list_utility_refunds and list_utility_payers, parsed. Only read-schemas.ts
 * re-exports this file, so zod loads next to the read, not with Home's first paint.
 */
const minorSchema = z.union([z.number().int(), z.string().regex(/^-?\d+$/)]).transform((value) => BigInt(value));
const text = z.string().nullable().optional().transform((value) => value ?? null);

/** FLOW-1142: one part of a payment split by category (save_line_split), with its category and project. */
const partSchema = z.object({
  category_id: text,
  category_name: text,
  project_id: text,
  project_name: text,
  amount_minor: minorSchema,
});

const paymentSchema = z.object({
  transaction_id: z.string(),
  doc_date: z.string(),
  amount_minor: minorSchema,
  currency: z.string(),
  description: text,
  party: text,
  project_id: text,
  /** FLOW-1142: the payment's project, by name (null before the server sends it, and on no project). */
  project_name: text,
  category_id: text,
  category_name: text,
  split: z.boolean().optional().default(false),
  /** FLOW-1142: the payment's parts when it is split by category; [] when it is not (or before the server sends them). */
  parts: z.array(partSchema).optional().default([]),
});

const billSchema = z.object({
  bill_transaction_id: z.string(),
  project_id: z.string(),
  project_name: z.string(),
  supplier_id: z.string(),
  supplier_name: text,
  currency: z.string(),
  category_id: text,
  category_name: text,
  amount_minor: minorSchema,
  doc_date: z.string(),
  days: z.number().int(),
  // FLOW-1143: Flow suggests nothing, so no bill is "suggested".
  state: z.enum(["not_refunded", "refunded", "waiting", "seen"]),
  source: z.enum(["auto", "owner"]).nullable().optional().transform((value) => value ?? null),
  no_rent: z.boolean(),
  payment: paymentSchema.nullable().optional().transform((value) => value ?? null),
  wrong_category: z.boolean(),
  keep_category: z.boolean().optional().default(false),
  refiled: z.boolean(),
});

export const utilityRefundsSchema = z.object({ as_of: z.string(), bills: z.array(billSchema) });

export const utilityPayersSchema = z
  .object({
    project_id: z.string(),
    utilities: z.array(z.object({
      supplier_id: z.string(),
      supplier_name: z.string(),
      currency: z.string(),
      payer: z.enum(["tenant", "company"]),
      added: z.boolean(),
      found: z.boolean(),
      usual_minor: minorSchema.nullable().optional().transform((value) => value ?? null),
      bill_count: z.number().int(),
      last_bill_date: text,
      category_id: text,
      category_name: text,
    })),
  })
  .transform((body) => body.utilities);

/**
 * FLOW-1159: list_utility_income, a tenant-paid utility bill (with its state) and the money in on its property within
 * `months` months before and after it, newest first: each line with its parts on the property and the utility bills
 * it is the refund of.
 */
const incomeBillSchema = z.object({
  bill_transaction_id: z.string(),
  doc_date: z.string(),
  amount_minor: minorSchema,
  currency: z.string(),
  category_id: text,
  category_name: text,
  supplier_name: text,
  project_id: z.string(),
  project_name: z.string(),
  state: z.enum(["not_refunded", "refunded", "waiting", "seen"]),
  days: z.number().int(),
  payment_transaction_id: text,
});

const incomeLineSchema = z.object({
  transaction_id: z.string(),
  doc_date: z.string(),
  amount_minor: minorSchema,
  currency: z.string(),
  party: text,
  description: text,
  project_id: text,
  category_id: text,
  category_name: text,
  parts: z.array(z.object({ category_id: text, category_name: text, amount_minor: minorSchema })).optional().default([]),
  refunded_bills: z.array(z.object({
    bill_transaction_id: z.string(),
    doc_date: z.string(),
    amount_minor: minorSchema,
    category_id: text,
    category_name: text,
  })).optional().default([]),
});

export const utilityIncomeSchema = z.object({
  as_of: z.string(),
  months: z.number().int(),
  from: z.string(),
  to: z.string(),
  bill: incomeBillSchema,
  lines: z.array(incomeLineSchema),
});
