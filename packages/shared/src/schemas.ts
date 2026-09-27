import { z } from "zod";

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

const uuid = z.uuid();
const agorot = z.number().int();
const timestamptz = z.iso.datetime({ offset: true });

export const companySchema = z.object({
  id: uuid,
  ownerId: uuid,
  name: z.string().min(1),
  taxId: z.string().nullable(),
  vatRateBp: z.number().int().min(0).max(10000),
  createdAt: timestamptz,
  updatedAt: timestamptz,
});

export const projectSchema = z.object({
  id: uuid,
  companyId: uuid,
  name: z.string().min(1),
  status: projectStatusSchema,
  stateLabel: z.string().nullable(),
  budgetAgorot: agorot.nullable(),
  sumitBudgetSectionId: z.number().int().nullable(),
  createdAt: timestamptz,
  updatedAt: timestamptz,
});

export const customerSchema = z.object({
  id: uuid,
  companyId: uuid,
  name: z.string().min(1),
  companyNumber: z.string().nullable(),
  sumitExternalId: z.number().int().nullable(),
  createdAt: timestamptz,
  updatedAt: timestamptz,
});

export const supplierSchema = z.object({
  id: uuid,
  companyId: uuid,
  name: z.string().min(1),
  companyNumber: z.string().nullable(),
  vatExempt: z.boolean(),
  rememberedProjectId: uuid.nullable(),
  rememberedCategoryId: uuid.nullable(),
  sumitExternalId: z.number().int().nullable(),
  createdAt: timestamptz,
  updatedAt: timestamptz,
});

export const categorySchema = z.object({
  id: uuid,
  companyId: uuid,
  name: z.string().min(1),
  kind: categoryKindSchema,
  sortOrder: z.number().int(),
  isDefault: z.boolean(),
  hidden: z.boolean(),
  createdAt: timestamptz,
  updatedAt: timestamptz,
});

export const transactionSchema = z
  .object({
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
  })
  .refine((row) => row.amountGross === row.amountNet + row.vatAmount, {
    message: "amount_gross must equal amount_net + vat_amount",
  });

export const allocationSchema = z.object({
  id: uuid,
  companyId: uuid,
  transactionId: uuid,
  projectId: uuid,
  shareBp: z.number().int().min(1).max(10000),
  amountNet: agorot,
  createdAt: timestamptz,
  updatedAt: timestamptz,
});

export const splitRuleSchema = z.object({
  id: uuid,
  companyId: uuid,
  supplierId: uuid.nullable(),
  method: splitMethodSchema,
  label: z.string().min(1),
  createdAt: timestamptz,
  updatedAt: timestamptz,
});

/**
 * SUMIT connection as the client is allowed to see it.
 * Ciphertext is opaque. There is no plaintext key field.
 */
export const sumitConnectionSchema = z.object({
  id: uuid,
  companyId: uuid,
  sumitCompanyId: z.number().int().nullable(),
  keyCiphertextB64: z.string().min(1),
  keyNonceB64: z.string().min(1),
  dekCiphertextB64: z.string().min(1),
  dekNonceB64: z.string().min(1),
  kekVersion: z.string().min(1),
  createdAt: timestamptz,
  updatedAt: timestamptz,
});

export const DEFAULT_EXPENSE_CATEGORIES = [
  "חומרים",
  "קבלני משנה",
  "עבודה",
  "ציוד והשכרה",
  "הובלה",
  "ביטוח",
  "אחר",
] as const;

export const DEFAULT_INCOME_CATEGORIES = ["תקבול מלקוח", "הכנסה אחרת"] as const;

export type VatStatus = z.infer<typeof vatStatusSchema>;
export type TransactionInput = z.infer<typeof transactionSchema>;
export type SumitConnection = z.infer<typeof sumitConnectionSchema>;
