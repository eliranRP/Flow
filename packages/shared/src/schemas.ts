import { z } from "zod";
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES } from "./categories.ts";

export { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES };

export const vatStatusSchema = z.enum(["source", "derived", "assumed", "unknown"]);
export const txnDirectionSchema = z.enum(["income", "expense"]);
export const txnSourceSchema = z.enum(["sumit", "hapoalim", "manual", "photo"]);
export const pnlRoleSchema = z.enum(["project", "shared", "overhead"]);
export const docKindSchema = z.enum([
  "invoice",
  "receipt",
  "invoice_receipt",
  "credit",
  "expense",
  "other",
]);
export const projectStatusSchema = z.enum(["active", "finished"]);
export const categoryKindSchema = z.enum(["expense", "income"]);
export const reviewStatusSchema = z.enum(["open", "approved", "skipped", "changed"]);
export const splitMethodSchema = z.enum(["equal", "income_share", "manual", "worker_days"]);
export const demoDocKindSchema = z.enum(["inv", "rec", "invrec", "cred", "exp"]);

/** SUMIT fixture kind → stored doc_kind. One mapping for the P&L and the seed. */
export const demoKindToDocKind = {
  inv: "invoice",
  rec: "receipt",
  invrec: "invoice_receipt",
  cred: "credit",
  exp: "expense",
} as const satisfies Record<z.infer<typeof demoDocKindSchema>, z.infer<typeof docKindSchema>>;

const uuid = z.uuid();
const agorot = z.number().int();
const timestamptz = z.iso.datetime({ offset: true });

const transactionShape = {
  id: uuid,
  companyId: uuid,
  direction: txnDirectionSchema,
  docKind: docKindSchema,
  pnlRole: pnlRoleSchema.nullable(),
  amountGross: agorot,
  amountNet: agorot,
  vatAmount: agorot,
  vatStatus: vatStatusSchema,
  docDate: z.iso.date(),
  cashDate: z.iso.date().nullable(),
  source: txnSourceSchema,
  externalId: z.string().min(1).nullable(),
  idempotencyKey: z.string().min(1),
  projectId: uuid.nullable(),
  customerId: uuid.nullable(),
  supplierId: uuid.nullable(),
  categoryId: uuid.nullable(),
  description: z.string(),
  linkedExternalId: z.string().nullable(),
  createdAt: timestamptz,
  updatedAt: timestamptz,
};

export const transactionInsertSchema = z
  .object(transactionShape)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .refine((row) => row.amountGross === row.amountNet + row.vatAmount, {
    message: "amount_gross must equal amount_net + vat_amount",
  });

/**
 * What the browser may know about a SUMIT connection.
 * Ciphertext stays on the server. There is no key field here.
 */
export const sumitConnectionStatusSchema = z.object({
  companyId: uuid,
  sumitCompanyId: z.number().int().nullable(),
  connected: z.boolean(),
});

/** get_home() payload. Snake case, matching the RPC. */
export const homeSummarySchema = z.object({
  company_id: uuid.nullable(),
  name: z.string().nullable(),
  net_profit_agorot: z.number().int(),
  is_demo: z.boolean(),
});

export type VatStatus = z.infer<typeof vatStatusSchema>;
export type PnlRole = z.infer<typeof pnlRoleSchema>;
export type DemoDocKind = z.infer<typeof demoDocKindSchema>;
export type DocKind = z.infer<typeof docKindSchema>;
export type TransactionInsert = z.infer<typeof transactionInsertSchema>;
export type SumitConnectionStatus = z.infer<typeof sumitConnectionStatusSchema>;
export type HomeSummary = z.infer<typeof homeSummarySchema>;
