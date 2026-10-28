// FLOW-948 (decision 0208). The balanced-legs booking tools (book_line, create_journal_entry of
// FLOW-149, set_category_account of FLOW-151). Split from tools_schemas.ts to keep it under the
// file-size limit.
import { z } from "zod";
import { isCalendarDate } from "./tools_args.ts";
import { IDEMPOTENCY_KEY, UUID_TEXT, visibleName } from "./tools_schemas.ts";

// One signed ledger leg. amount_minor is a SIGNED ledger value (debit positive / credit
// negative), not a P&L amount; the server routes it by its account's type.
const legSchema = z.object({
  account_id: UUID_TEXT,
  amount_minor: z.number().int().min(-999999999999999).max(999999999999999),
  project_id: UUID_TEXT.nullable().optional(),
}).strict();

// book_line: a P&L line booked from a balanced set of legs. The legs must sum to 0 (one of them is the
// bank movement); the server also checks exactly one bank leg and company ownership. Without
// transaction_id it books a NEW line (doc_date, currency and description required); with it, the
// caller's EXISTING posted line (FLOW-950), which keeps its own date, currency and description, so
// those three are refused there rather than silently ignored.
const LINE_FIELDS = ["doc_date", "currency", "description"] as const;
export const bookLineSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  transaction_id: UUID_TEXT.nullable().optional(),
  doc_date: z.string().refine((v) => isCalendarDate(v), "doc_date must be a calendar date (YYYY-MM-DD)").optional(),
  direction: z.enum(["income", "expense"]),
  currency: z.string().regex(/^[A-Z]{3}$/, "currency must be a 3-letter code").optional(),
  description: visibleName(1, 120).optional(),
  legs: z.array(legSchema).min(2).max(50),
  project_id: UUID_TEXT.nullable().optional(),
}).strict().superRefine((body, ctx) => {
  if (body.legs.reduce((sum, leg) => sum + leg.amount_minor, 0) !== 0) {
    ctx.addIssue({ code: "custom", message: "legs must balance to 0", path: ["legs"] });
  }
  const existing = body.transaction_id != null;
  for (const key of LINE_FIELDS) {
    if (!existing && body[key] == null) {
      ctx.addIssue({ code: "custom", message: "required for a new line", path: [key] });
    } else if (existing && body[key] != null) {
      ctx.addIssue({ code: "custom", message: "not taken with transaction_id (the line keeps its own)", path: [key] });
    }
  }
});

// FLOW-149 (decision 0228): create_journal_entry, an entry that moves no money (depreciation). The
// legs balance to 0 with no bank leg; the server checks the accounts and that the P&L legs, if any, do
// not net to 0 (FLOW-152: an entry on balance-sheet accounts only is allowed).
export const createJournalEntrySchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  doc_date: z.string().refine((v) => isCalendarDate(v), "doc_date must be a calendar date (YYYY-MM-DD)"),
  currency: z.string().regex(/^[A-Z]{3}$/, "currency must be a 3-letter code"),
  description: visibleName(1, 120),
  reference: visibleName(1, 60).nullable().optional(),
  legs: z.array(legSchema).min(2).max(50),
}).strict().superRefine((body, ctx) => {
  if (body.legs.reduce((sum, leg) => sum + leg.amount_minor, 0) !== 0) {
    ctx.addIssue({ code: "custom", message: "legs must balance to 0", path: ["legs"] });
  }
});

// FLOW-151 (decision 0231): set_category_account, the balance-sheet account a kept-out category posts
// to (account_id null: the default, its loan part's account or Suspense).
export const setCategoryAccountSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  category_id: UUID_TEXT,
  account_id: UUID_TEXT.nullable(),
}).strict();
