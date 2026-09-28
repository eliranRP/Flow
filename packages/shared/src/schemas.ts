import { z } from "zod";
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES } from "./categories.ts";
import { Constants } from "./database.types.ts";

export { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES };

const dbEnums = Constants.public.Enums;

export const vatStatusSchema = z.enum(dbEnums.vat_status);
export const txnDirectionSchema = z.enum(dbEnums.txn_direction);
export const txnSourceSchema = z.enum(dbEnums.txn_source);
export const pnlRoleSchema = z.enum(dbEnums.pnl_role);
export const docKindSchema = z.enum(dbEnums.doc_kind);
export const projectStatusSchema = z.enum(dbEnums.project_status);
export const categoryKindSchema = z.enum(dbEnums.category_kind);
export const reviewStatusSchema = z.enum(dbEnums.review_status);
export const splitMethodSchema = z.enum(dbEnums.split_method);
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
export type SumitConnectionStatus = z.infer<typeof sumitConnectionStatusSchema>;
export type HomeSummary = z.infer<typeof homeSummarySchema>;
