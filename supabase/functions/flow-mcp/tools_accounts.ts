// MCP tools: the chart of accounts (FLOW-152). create_account, update_account, archive_account,
// restore_account and merge_account write the company's own balance-sheet accounts through
// mcp_create_account and its siblings (owner or editor, idempotency key, undo). The system accounts are
// locked; the database refuses them in words.
import { z } from "zod";
import { envelopeOf, fail, type ToolResult, type ToolRpc, WRITE_REFUSED } from "./tools_args.ts";
import { IDEMPOTENCY_KEY, UUID_TEXT, visibleName } from "./tools_schemas.ts";

export const ACCOUNT_WRITES = ["create_account", "update_account", "archive_account", "restore_account", "merge_account"] as const;

const ACCOUNT_TYPE = z.enum(["asset", "liability", "equity"]);

const createAccountSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  name: visibleName(1, 60),
  type: ACCOUNT_TYPE,
  description: z.string().max(200).nullable().optional(),
}).strict();

// description: an empty string clears it; at least one of the three fields.
const updateAccountSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  account_id: UUID_TEXT,
  name: visibleName(1, 60).optional(),
  description: z.string().max(200).optional(),
  type: ACCOUNT_TYPE.optional(),
}).strict().refine((b) => b.name !== undefined || b.description !== undefined || b.type !== undefined, "nothing to change");

const accountIdSchema = z.object({ idempotency_key: IDEMPOTENCY_KEY, account_id: UUID_TEXT }).strict();

const mergeAccountSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  from_account_id: UUID_TEXT,
  into_account_id: UUID_TEXT,
}).strict();

export async function accountWrite(
  name: typeof ACCOUNT_WRITES[number],
  args: Record<string, unknown>,
  rpc: ToolRpc,
): Promise<ToolResult> {
  let rpcName: string;
  let body: Record<string, unknown>;
  if (name === "create_account") {
    const p = createAccountSchema.safeParse(args);
    if (!p.success) return fail("validation", "validation");
    rpcName = "mcp_create_account";
    body = {
      p_idempotency_key: p.data.idempotency_key,
      p_name: p.data.name,
      p_type: p.data.type,
      p_description: p.data.description ?? null,
    };
  } else if (name === "update_account") {
    const p = updateAccountSchema.safeParse(args);
    if (!p.success) return fail("validation", "validation");
    rpcName = "mcp_update_account";
    body = {
      p_idempotency_key: p.data.idempotency_key,
      p_account_id: p.data.account_id,
      p_name: p.data.name ?? null,
      p_description: p.data.description ?? null,
      p_type: p.data.type ?? null,
    };
  } else if (name === "merge_account") {
    const p = mergeAccountSchema.safeParse(args);
    if (!p.success) return fail("validation", "validation");
    rpcName = "mcp_merge_account";
    body = {
      p_idempotency_key: p.data.idempotency_key,
      p_from_account_id: p.data.from_account_id,
      p_into_account_id: p.data.into_account_id,
    };
  } else {
    const p = accountIdSchema.safeParse(args);
    if (!p.success) return fail("validation", "validation");
    rpcName = name === "archive_account" ? "mcp_archive_account" : "mcp_restore_account";
    body = { p_idempotency_key: p.data.idempotency_key, p_account_id: p.data.account_id };
  }
  const result = await rpc(rpcName, body);
  if (result.status >= 400) return fail("refused", WRITE_REFUSED);
  return envelopeOf(result.json);
}
