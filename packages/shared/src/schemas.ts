import { z } from "zod";
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES } from "./categories.ts";
import { Constants } from "./database.types.ts";

export { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES };

export const demoDocKindSchema = z.enum(["inv", "rec", "invrec", "cred", "exp"]);

/** SUMIT fixture kind → stored doc_kind. One mapping for the P&L and the seed. */
export const demoKindToDocKind = {
  inv: "invoice",
  rec: "receipt",
  invrec: "invoice_receipt",
  cred: "credit",
  exp: "expense",
} as const satisfies Record<z.infer<typeof demoDocKindSchema>, DocKind>;

const uuid = z.uuid();

/** get_home() payload. Snake case, matching the RPC. */
export const homeSummarySchema = z.object({
  company_id: uuid.nullable(),
  name: z.string().nullable(),
  net_profit_agorot: z.union([z.number().int(), z.string().regex(/^-?\d+$/)]).transform((value) => BigInt(value)),
  is_demo: z.boolean(),
});

export type VatStatus = (typeof Constants.public.Enums.vat_status)[number];
export type PnlRole = (typeof Constants.public.Enums.pnl_role)[number];
export type DemoDocKind = z.infer<typeof demoDocKindSchema>;
export type DocKind = (typeof Constants.public.Enums.doc_kind)[number];
