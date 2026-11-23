// MCP tool: the end date of a line's recurring charge (FLOW-1266). One write, set_line_end_date, through
// mcp_set_line_end_date with the idempotency key, the write rate limit and undo (kind line_end, id: the
// transaction). Split out of tools_specs.ts and tools_schemas.ts to keep them under the file-size limit.
import { z } from "zod";
import { DATE, envelopeOf, fail, type ToolResult, type ToolRpc, UUID, WRITE_REFUSED } from "./tools_args.ts";

const ID = z.string().regex(UUID);

const endDateSchema = z.object({
  idempotency_key: z.string().min(1).max(128),
  transaction_id: ID,
  ends_on: z.string().regex(DATE).nullable(),
  project_id: ID.optional(),
}).strict();

/** The tool's argument allow-list, merged into ALLOWED in tools_schemas.ts. */
export const END_DATE_ALLOWED: Record<string, Set<string>> = {
  set_line_end_date: new Set(["idempotency_key", "transaction_id", "ends_on", "project_id"]),
};

export const END_DATE_WRITES = ["set_line_end_date"] as const;
export const END_DATE_UNDO_KINDS = ["line_end"] as const;

function spec(name: string, description: string, properties: Record<string, unknown>) {
  return {
    name,
    description,
    inputSchema: { type: "object", properties, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  };
}

export const END_DATE_WRITE_SPECS = [
  spec("set_line_end_date", "Set the end date of a line's recurring charge (that supplier or customer in that line's currency, for the line's project; FLOW-1266), YYYY-MM-DD from today on; null removes it. The charge is not expected on a due day (its usual day, capped at the month's last day) after the end date: get_expected_months, the forecast and get_missing_bills stop there, and get_recurring_schedule and get_expected_months say ends_on. Once the date has passed, or when the charge has not come this month and its next due day is after the date, the charge is not recurring (it leaves get_recurring_schedule); marking it recurring again (set_line_recurring) clears an end date that has passed. A line with no supplier or customer is refused. Returns transaction_id, party, project_id, ends_on, recurring (whether the charge still recurs), id and undo_kind; undo is kind line_end with the transaction id, a conflict once the date was changed again. Optional project_id names another project's charge the line feeds, as set_line_usual_amount.", {
    idempotency_key: { type: "string" },
    transaction_id: { type: "string" },
    ends_on: { type: ["string", "null"] },
    project_id: { type: "string" },
  }),
];

export async function endDateWrite(args: Record<string, unknown>, rpc: ToolRpc): Promise<ToolResult> {
  const parsed = endDateSchema.safeParse(args);
  if (!parsed.success) return fail("validation", "validation");
  const result = await rpc("mcp_set_line_end_date", {
    p_idempotency_key: parsed.data.idempotency_key,
    p_transaction_id: parsed.data.transaction_id,
    p_ends_on: parsed.data.ends_on,
    ...(parsed.data.project_id == null ? {} : { p_project_id: parsed.data.project_id }),
  });
  if (result.status >= 400) return fail("refused", WRITE_REFUSED);
  return envelopeOf(result.json);
}
