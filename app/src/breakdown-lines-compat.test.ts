import { breakdownLinesAllSchema, breakdownLinesSchema } from "@flow/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";

// FLOW-1211. Phones keep running the FLOW-1207 app for hours or days after a deploy, and the migration applies on merge,
// before it. That app parses the no-key read with its own schema, copied below from main as it was (packages/shared/src/
// dashboard.ts at 79d7395b): a row must still parse with it. Delete this file when no FLOW-1207 app is in use (FLOW-1217, on hold until about 2026-11-24).
const agorotSchema = z.union([z.number().int(), z.string().regex(/^-?\d+$/)]).transform((value) => BigInt(value));

const oldBreakdownLinesSchema = z
  .object({
    rows: z.array(
      z.object({
        transaction_id: z.string(),
        part: z.string().nullable(),
        description: z.string(),
        supplier_name: z.string().nullable(),
        project_name: z.string().nullable(),
        category_name: z.string().nullable(),
        doc_date: z.string(),
        currency: z.string().regex(/^[A-Z]{3}$/),
        amount_minor: agorotSchema,
        shared: z.boolean(),
        /** Where the line came from; "mercury" shows the bank icon (FLOW-125). Older payloads omit it. */
        source: z.string().optional().catch(undefined),
        /** FLOW-946: a gross-up part (paid from a deposit / netted against the line). Older payloads omit it. */
        gross_up: z.boolean().optional().catch(undefined),
        /** FLOW-954: the row's category, so a kept-out line sits under its own group. Older payloads omit it. */
        category_id: z.string().nullable().optional().catch(undefined),
        /** FLOW-1207: with no group key, the group the row belongs to (the key a keyed read would be asked with). Else omitted. */
        group_key: z.string().optional().catch(undefined),
      }),
    ),
    has_more: z.boolean(),
    /** FLOW-165: the whole group's total and row count, whatever page this is. Older payloads omit them. */
    total_minor: agorotSchema.optional().catch(undefined),
    count: z.number().int().nonnegative().optional().catch(undefined),
    /** FLOW-989: the group by project, as `get_pnl_statement` by project counts it (key: a project id, "overhead", "unassigned" or null). */
    projects: z.array(z.object({ key: z.string().nullable(), project_id: z.string().nullable(), name: z.string().nullable(), total_minor: agorotSchema })).optional().catch(undefined),
  })
  .nullable();

// A row the no-key read returns (invented): no category_id and no kept_out, with group_key.
const newRow = {
  transaction_id: "00000000-0000-4000-8000-000000000001", part: null, description: "חשבון לדוגמה", supplier_name: null, project_name: null,
  category_name: "ביטוח", doc_date: "2026-07-10", currency: "USD", amount_minor: 20000, shared: false, source: "manual", gross_up: false,
  group_key: "00000000-0000-4000-8000-0000000000c2",
};
const page = { rows: [newRow], has_more: false, total_minor: 20000, count: 1, projects: [] };

describe("the no-key lines read, for the FLOW-1207 app still live (FLOW-1211)", () => {
  it("a new-shape row parses with the FLOW-1207 schema, and keeps the group key the old app files it by", () => {
    const parsed = oldBreakdownLinesSchema.parse(page);
    expect(parsed?.rows).toHaveLength(1);
    expect(parsed?.rows[0]).toMatchObject({ category_name: "ביטוח", currency: "USD", shared: false, group_key: newRow.group_key, amount_minor: 20000n });
  });

  it("the same page parses with the new schemas, and the keyed schema takes a row without the key", () => {
    expect(breakdownLinesAllSchema.parse(page)?.rows[0]).toMatchObject({ group_key: newRow.group_key, category_name: "ביטוח" });
    expect(breakdownLinesSchema.parse({ ...page, rows: [{ ...newRow, group_key: undefined }] })?.rows[0]).toMatchObject({ currency: "USD", shared: false });
  });
});
