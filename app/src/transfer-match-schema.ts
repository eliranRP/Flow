import { z } from "zod";

/**
 * FLOW-941 (decision 0205): list_transfer_matches, parsed. Only read-schemas.ts re-exports this file, so
 * zod loads next to the read, not with Home's first paint.
 */
const minorSchema = z.union([z.number().int(), z.string().regex(/^-?\d+$/)]).transform((value) => BigInt(value));

const sideSchema = z.object({
  transaction_id: z.string(),
  doc_date: z.string(),
  amount_minor: minorSchema,
  currency: z.string(),
  description: z.string().nullable().optional().transform((value) => value ?? ""),
  party: z.string().nullable().optional().transform((value) => value ?? null),
  slot: z.number().int().nullable().optional().transform((value) => value ?? null),
  org_label: z.string().nullable().optional().transform((value) => value ?? null),
  account_name: z.string().nullable().optional().transform((value) => value ?? null),
  account_last4: z.string().nullable().optional().transform((value) => value ?? null),
});

export const transferMatchesSchema = z
  .object({
    matches: z.array(z.object({ out: sideSchema, in: sideSchema, day_diff: z.number().int(), name_hint: z.boolean() })),
  })
  .transform((body) => body.matches);
