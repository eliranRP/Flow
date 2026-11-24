import { z } from "zod";

/** JSON numbers and digit strings both become bigint minor units. Fractions are rejected. */
const minorSchema = z.union([z.number().int(), z.string().regex(/^-?\d+$/)]).transform((value) => BigInt(value));

const dayText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * FLOW-1316: `loan_outlooks(p_today)` (FLOW-1310), one answer for the company's open loans with a built schedule:
 * `[{ loan_id, next, ahead_minor, to_end_minor, end_date, late_on }]`, ordered by loan id. Absent = null: a loan with
 * no next payment has no `next`, one that is not late has no `late_on`; a loan with neither is left out, and so is a
 * closed or demand loan. `next.amount_minor` is the sum of its three parts; `ahead_minor` is the next 12 payments' total.
 */
export const loanOutlooksSchema = z.array(
  z.object({
    loan_id: z.string(),
    next: z
      .object({
        due_date: dayText,
        interest_minor: minorSchema,
        escrow_minor: minorSchema,
        principal_minor: minorSchema,
        amount_minor: minorSchema,
      })
      .optional(),
    ahead_minor: minorSchema.optional(),
    to_end_minor: minorSchema.optional(),
    end_date: dayText.optional(),
    late_on: dayText.optional(),
  }),
);
export type LoanOutlooks = z.output<typeof loanOutlooksSchema>;
