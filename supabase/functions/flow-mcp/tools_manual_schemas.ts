// FLOW-369: the add sheet's write arguments (create_manual_entry, attach_document). Split from
// tools_schemas.ts to keep it under the file-size limit.
import { z } from "zod";
import { isCalendarDate } from "./tools_args.ts";
import { IDEMPOTENCY_KEY, UUID_TEXT, visibleName } from "./tools_schemas.ts";

// FLOW-369. A cash or cheque line from the add sheet: the payee is the description, the method
// and a cheque number are kept with it. The database checks the rest (project, category, amount).
export const createManualEntrySchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  direction: z.enum(["income", "expense"]),
  amount_minor: z.number().int().min(1).max(999999999999),
  doc_date: z.string().refine((v) => isCalendarDate(v)),
  payee: visibleName(2, 120),
  project_id: UUID_TEXT.nullable().optional(),
  category_id: UUID_TEXT,
  method: z.enum(["cash", "cheque"]),
  cheque_number: z.string().trim().regex(/^[0-9A-Za-z-]{1,20}$/).nullable().optional(),
}).strict().superRefine((body, ctx) => {
  if (body.method === "cheque" && body.cheque_number == null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cheque_number"] });
});
// FLOW-369. One document on an existing line: its metadata (no file is stored yet, FLOW-306).
export const attachDocumentSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  transaction_id: UUID_TEXT,
  document: z.object({
    name: visibleName(1, 200),
    mime: z.enum(["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"]),
    bytes: z.number().int().min(1).max(26214400),
    sha256: z.string().regex(/^[0-9a-fA-F]{64}$/).transform((hash) => hash.toLowerCase()),
  }).strict(),
}).strict();
