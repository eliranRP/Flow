// MCP tools: the zod schemas of the writes on a loan's attached payments and its order (detach, the
// part categories and switches of FLOW-148, delete, reorder). Split out of tools_schemas.ts.

import { z } from "zod";
import { DATE, UUID } from "./tools_args.ts";

const UUID_TEXT = z.string().regex(UUID).transform((id) => id.toLowerCase());
const IDEMPOTENCY_KEY = z.string().min(1).max(128);

export const detachLoanPaymentSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  transaction_id: UUID_TEXT,
}).strict();
/** FLOW-148 (decision 0227): the parts of a loan payment a category is set for. */
export const LOAN_PARTS = ["interest", "escrow", "principal", "fees"] as const;
export const setLoanPartCategorySchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  transaction_ids: z.array(UUID_TEXT).min(1).max(100)
    .refine((ids) => new Set(ids).size === ids.length, { message: "each line once" }),
  part: z.enum(LOAN_PARTS),
  // null: back to the category the payment would take today (a switch, the loan's, the default).
  category_id: UUID_TEXT.nullable(),
}).strict();
export const setLoanCategoryFromSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  loan_id: UUID_TEXT,
  part: z.enum(LOAN_PARTS),
  effective_date: z.string().regex(DATE),
  // null removes the switch on that date.
  category_id: UUID_TEXT.nullable(),
  apply_to_existing: z.boolean().optional(),
}).strict();
export const deleteLoanSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  loan_id: UUID_TEXT,
}).strict();
export const reorderLoansSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  loan_ids: z.array(UUID_TEXT).min(1).max(200),
}).strict();
