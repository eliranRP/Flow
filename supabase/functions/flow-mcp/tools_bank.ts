// MCP tools: the bank (Mercury) connections and the accounts each one syncs (FLOW-938, decisions 0095 and
// 0203), what Settings › חיבורים › Mercury does. One read (list_bank_connections) and two writes, each
// through its mcp_* function: set_bank_accounts (step 3 and the synced accounts list) and
// answer_bank_account (the new account card's כן, לסנכרן / לא). Both save through set_mercury_accounts, the
// app's RPC, so its rules stay in one place; the owner only, with the idempotency key and undo kind
// bank_accounts (id: the connection).
// FLOW-941 (decision 0205): the transfers between two connections Flow suggests, what Home's העברות לבדיקה
// screen does: list_transfer_matches (every pair, however old: the app shows the last 90 days), and confirm_transfer_match / dismiss_transfer_match through
// mcp_answer_transfer_match (owner or editor, the idempotency key, undo kind transfer_match, id: the
// money-out line).
import { z } from "zod";
import { envelopeOf, fail, isCalendarDate, ok, READ_REFUSED, type ToolResult, type ToolRpc, WRITE_REFUSED } from "./tools_args.ts";

const IDEMPOTENCY_KEY = z.string().min(1).max(128);
const SLOT = z.number().int().min(1).max(9);
const ACCOUNT_ID = z.string().min(1).max(128);
// "start" reads all Mercury keeps; a day reads from that day (the database refuses one after today).
const FROM = z.union([z.literal("start"), z.string().refine(isCalendarDate)]);

const setSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  slot: SLOT,
  account_ids: z.array(ACCOUNT_ID).min(1).max(200),
  from: FROM.nullable().optional(),
}).strict();
const answerSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  slot: SLOT,
  account_id: ACCOUNT_ID,
  sync: z.boolean(),
}).strict();
const transferSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  out_transaction_id: z.string().uuid(),
  in_transaction_id: z.string().uuid(),
}).strict();

/** The tools' argument allow-list, merged into ALLOWED in tools_schemas.ts. */
export const BANK_ALLOWED: Record<string, Set<string>> = {
  list_bank_connections: new Set(),
  set_bank_accounts: new Set(["idempotency_key", "slot", "account_ids", "from"]),
  answer_bank_account: new Set(["idempotency_key", "slot", "account_id", "sync"]),
  list_transfer_matches: new Set(),
  confirm_transfer_match: new Set(["idempotency_key", "out_transaction_id", "in_transaction_id"]),
  dismiss_transfer_match: new Set(["idempotency_key", "out_transaction_id", "in_transaction_id"]),
};

export const BANK_WRITES = ["set_bank_accounts", "answer_bank_account", "confirm_transfer_match", "dismiss_transfer_match"] as const;

/** The two reads: list_bank_connections (mcp_bank_connections) and list_transfer_matches. */
export async function bankRead(name: "list_bank_connections" | "list_transfer_matches", rpc: ToolRpc): Promise<ToolResult> {
  const list = name === "list_bank_connections" ? "connections" : "matches";
  // The MCP lists every pair (p_all), so an agent can work through the backlog the app's 90 days leave out.
  const result = name === "list_bank_connections"
    ? await rpc("mcp_bank_connections", {})
    : await rpc("list_transfer_matches", { p_all: true });
  const body = result.json;
  if (result.status >= 400 || body == null || typeof body !== "object" || Array.isArray(body)) return fail("refused", READ_REFUSED);
  if (!Array.isArray((body as Record<string, unknown>)[list])) return fail("refused", READ_REFUSED);
  return ok(body);
}

/** The writes, each to its mcp_* function. */
export async function bankWrite(
  name: typeof BANK_WRITES[number],
  args: Record<string, unknown>,
  rpc: ToolRpc,
): Promise<ToolResult> {
  let rpcName: string;
  let body: Record<string, unknown>;
  if (name === "set_bank_accounts") {
    const parsed = setSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_set_bank_accounts";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_slot: parsed.data.slot,
      p_account_ids: parsed.data.account_ids,
      p_from: parsed.data.from ?? null,
    };
  } else if (name === "confirm_transfer_match" || name === "dismiss_transfer_match") {
    const parsed = transferSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_answer_transfer_match";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_out_transaction_id: parsed.data.out_transaction_id,
      p_in_transaction_id: parsed.data.in_transaction_id,
      p_same: name === "confirm_transfer_match",
    };
  } else {
    const parsed = answerSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_answer_bank_account";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_slot: parsed.data.slot,
      p_account_id: parsed.data.account_id,
      p_sync: parsed.data.sync,
    };
  }
  const result = await rpc(rpcName, body);
  if (result.status >= 400) return fail("refused", WRITE_REFUSED);
  return envelopeOf(result.json);
}
