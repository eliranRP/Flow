// MCP tool: a recurring charge that moved to another payee (FLOW-1037, decision 0255). A loan moved to a new
// servicer: get_expected_months names the line that came under the new party (a charge's handover), and the
// forecast leaves the old charge out until the user answers. One write, answer_recurring_handover, through
// mcp_answer_recurring_handover with the idempotency key, the write rate limit and undo (kind recurring_handover,
// id: the write).
import { z } from "zod";
import { envelopeOf, fail, type ToolResult, type ToolRpc, UUID, WRITE_REFUSED } from "./tools_args.ts";

const ID = z.string().regex(UUID);

const answerSchema = z.object({
  idempotency_key: z.string().min(1).max(128),
  direction: z.enum(["expense", "income"]),
  party_id: ID,
  currency: z.string().regex(/^[A-Z]{3}$/),
  project_id: ID,
  to_party_id: ID,
  same: z.boolean().nullable(),
}).strict().refine((args) => args.party_id !== args.to_party_id);

/** The tool's argument allow-list, merged into ALLOWED in tools_schemas.ts. */
export const HANDOVER_ALLOWED: Record<string, Set<string>> = {
  answer_recurring_handover: new Set(["idempotency_key", "direction", "party_id", "currency", "project_id", "to_party_id", "same"]),
};

export const HANDOVER_WRITES = ["answer_recurring_handover"] as const;
export const HANDOVER_UNDO_KINDS = ["recurring_handover"] as const;

function spec(name: string, description: string, properties: Record<string, unknown>) {
  return {
    name,
    description,
    inputSchema: { type: "object", properties, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  };
}

export const HANDOVER_WRITE_SPECS = [
  spec("answer_recurring_handover", "Answer a recurring charge's handover (get_expected_months recurring[].handover, FLOW-1037): did the charge (direction, party_id, currency and project_id, the item's own) move to to_party_id (the handover's party_id), as when a loan moves to a new servicer? Until answered, the month forecast (get_forecast) leaves the old charge out and get_missing_bills does not call it late. true ends the old charge (its own recurring override: not recurring) and makes to_party_id's charge on the project recurring, with the old charge's pace when it is not monthly, so the next months expect the new payee; false brings the old charge back into the forecast and stops offering the pair; null takes the answer back and puts the overrides a yes wrote back as they were before it. Never answer without the user's word: nothing moves by itself. Owner or editor. Refused: validation (same party twice, no project), party not found, project not found. Returns direction, party_id, currency, project_id, to_party_id, same, id and undo_kind; undo is kind recurring_handover with id (the write), a conflict once the pair was answered again (even with the same answer).", {
    idempotency_key: { type: "string" },
    direction: { type: "string", enum: ["expense", "income"] },
    party_id: { type: "string" },
    currency: { type: "string" },
    project_id: { type: "string" },
    to_party_id: { type: "string" },
    same: { type: ["boolean", "null"] },
  }),
];

export async function handoverWrite(
  _name: typeof HANDOVER_WRITES[number],
  args: Record<string, unknown>,
  rpc: ToolRpc,
): Promise<ToolResult> {
  const parsed = answerSchema.safeParse(args);
  if (!parsed.success) return fail("validation", "validation");
  const result = await rpc("mcp_answer_recurring_handover", {
    p_idempotency_key: parsed.data.idempotency_key,
    p_direction: parsed.data.direction,
    p_party_id: parsed.data.party_id,
    p_currency: parsed.data.currency,
    p_project_id: parsed.data.project_id,
    p_to_party_id: parsed.data.to_party_id,
    p_same: parsed.data.same,
  });
  if (result.status >= 400) return fail("refused", WRITE_REFUSED);
  return envelopeOf(result.json);
}
