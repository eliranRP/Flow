import { z } from "zod";

/**
 * FLOW-1166 (part 2b, decision 0266): the change a bank or SUMIT sync holds for a line in a closed period,
 * on a review row with the reason `closed_month_change` (private.review_held_changes). `update` carries the
 * line as the sync sent it (amount_minor: the gross amount in minor units of `currency`, unsigned); `void`
 * (the bank dropped the line) and `remove` (the SUMIT document is gone) carry no amount, currency or dates.
 * Each field is read leniently: an odd value drops to undefined, never the row. An unknown kind stays a
 * string, so the card shows its reason and hint without detail lines.
 */
export const reviewHeldSchema = z
  .object({
    kind: z.string(),
    amount_minor: z.number().int().nullable().optional().catch(undefined),
    currency: z.string().regex(/^[A-Z]{3}$/).nullable().optional().catch(undefined),
    doc_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().catch(undefined),
    cash_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().catch(undefined),
    line_status: z.string().nullable().optional().catch(undefined),
    provider: z.string().nullable().optional().catch(undefined),
  })
  .nullable()
  .optional()
  .catch(undefined);

/** The review row's fields for a held change, spread into reviewRowSchema: `held`, and the line's own status. */
export const reviewHeldFields = {
  held: reviewHeldSchema,
  /** The line's status as it stands (pending, posted, void). Older payloads omit it. */
  line_status: z.enum(["pending", "posted", "void"]).optional().catch(undefined),
};

export type ReviewHeld = NonNullable<z.infer<typeof reviewHeldSchema>>;
