// FLOW-948 (decision 0208). The balanced-legs booking tool (book_line). Split from
// tools_schemas.ts to keep it under the file-size limit.
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

// book_line: a new P&L line booked from a balanced set of legs. The legs must sum to 0 (one of
// them is the bank movement); the server also checks exactly one bank leg and company ownership.
export const bookLineSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  doc_date: z.string().refine((v) => isCalendarDate(v)),
  direction: z.enum(["income", "expense"]),
  currency: z.string().regex(/^[A-Z]{3}$/),
  description: visibleName(1, 120),
  legs: z.array(legSchema).min(2).max(50),
  project_id: UUID_TEXT.nullable().optional(),
}).strict().refine(
  (body) => body.legs.reduce((sum, leg) => sum + leg.amount_minor, 0) === 0,
  { message: "legs must balance to 0", path: ["legs"] },
);
