// MCP tool: a bank or SUMIT change held for a line in a closed period (FLOW-1166, decision 0266). A sync does
// not change a line dated on or before set_books_closed_through's date: the change is held, and list_review
// shows the line with reason closed_month_change and `held`. One write, leave_held_change, through
// mcp_leave_held_change with the idempotency key, the write rate limit and undo (kind held_change_left, id:
// the line). The other way to settle it is to move the closed date back: the next sync then applies it.
import { z } from "zod";
import { envelopeOf, fail, type ToolResult, type ToolRpc, UUID, WRITE_REFUSED } from "./tools_args.ts";

const leaveSchema = z.object({
  idempotency_key: z.string().min(1).max(128),
  transaction_id: z.string().regex(UUID).transform((id) => id.toLowerCase()),
}).strict();

/** The tool's argument allow-list, merged into ALLOWED in tools_schemas.ts. */
export const HELD_ALLOWED: Record<string, Set<string>> = {
  leave_held_change: new Set(["idempotency_key", "transaction_id"]),
};

export const HELD_WRITES = ["leave_held_change"] as const;
export const HELD_UNDO_KINDS = ["held_change_left"] as const;

/** list_review's words for a held row, so the read and the write describe it the same way. */
export const HELD_REVIEW_NOTE =
  "reason closed_month_change: a bank (Mercury) or SUMIT sync brought a change to a line in the closed period (on or before set_books_closed_through's date); the line was not changed and the change waits in held: { kind (update: new provider facts; void: the bank dropped the line; remove: the SUMIT document is gone), amount_minor (the new gross, unsigned, in currency; null unless update), currency, doc_date, cash_date, line_status (pending or posted, the status the change brings), provider (mercury or sumit) }. Such a row cannot be assigned, split, recategorized or skipped (the books are closed through YYYY-MM-DD). The only ways to settle it: leave_held_change (keep the line as it is; the row is approved) or move the closed date back with set_books_closed_through, after which the next sync applies the change and the row goes.";

function spec(name: string, description: string, properties: Record<string, unknown>) {
  return {
    name,
    description,
    inputSchema: { type: "object", properties, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  };
}

export const HELD_WRITE_SPECS = [
  spec("leave_held_change", `Leave a held change (FLOW-1166; owner or editor): the line stays as it is in the closed period, the held bank or SUMIT change is kept aside and the line's closed_month_change review row is approved. transaction_id is the line (list_review transaction_id of a row with reason closed_month_change). The same change does not come back to review; a different change from a later sync opens the row again. To take the change instead, move the closed date back with set_books_closed_through (owner): the next sync applies it. Never leave a change without the user's word. Refused: review item not found (no held change on that line, another company's line, or a review id). Returns transaction_id, review_id, state left and undo_kind held_change_left; undo is kind held_change_left with the line's id and puts the change back to held with its row open, while the change still reads as left (conflict once a newer change replaced it).`, {
    idempotency_key: { type: "string" },
    transaction_id: { type: "string" },
  }),
];

export async function heldWrite(
  _name: typeof HELD_WRITES[number],
  args: Record<string, unknown>,
  rpc: ToolRpc,
): Promise<ToolResult> {
  const parsed = leaveSchema.safeParse(args);
  if (!parsed.success) return fail("validation", "validation");
  const result = await rpc("mcp_leave_held_change", {
    p_idempotency_key: parsed.data.idempotency_key,
    p_transaction_id: parsed.data.transaction_id,
  });
  if (result.status >= 400) return fail("refused", WRITE_REFUSED);
  return envelopeOf(result.json);
}
