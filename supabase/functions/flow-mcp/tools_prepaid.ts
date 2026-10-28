// MCP tools: prepaid amortization schedules (FLOW-155) and the books-closed date (FLOW-156).
// create_prepaid_schedule spreads a payment over months as journal entries Prepaid -> expense (no cash
// moves); list_prepaid_schedules and get_prepaid_schedule read them; attach_prepaid_refund,
// update_prepaid_schedule, end_prepaid_schedule and delete_prepaid_schedule change them;
// set_books_closed_through (owner) closes the posted months. The database does the work in
// mcp_create_prepaid_schedule and its siblings (owner or editor, idempotency key, undo).
import { z } from "zod";
import { envelopeOf, fail, isCalendarDate, READ_REFUSED, type ToolResult, type ToolRpc, UUID, WRITE_REFUSED } from "./tools_args.ts";

export const PREPAID_READS = ["list_prepaid_schedules", "get_prepaid_schedule"] as const;
export const PREPAID_WRITES = [
  "create_prepaid_schedule",
  "attach_prepaid_refund",
  "update_prepaid_schedule",
  "end_prepaid_schedule",
  "delete_prepaid_schedule",
  "set_books_closed_through",
] as const;

/** Merged into LEDGER_ALLOWED (tools_ledger.ts): the argument allow-list of each prepaid tool. */
export const PREPAID_ALLOWED: Record<string, Set<string>> = {
  list_prepaid_schedules: new Set(["status"]),
  get_prepaid_schedule: new Set(["id"]),
  create_prepaid_schedule: new Set([
    "idempotency_key",
    "transaction_id",
    "expense_category_id",
    "project_id",
    "start_month",
    "months",
    "amount_minor",
    "day_of_month",
    "prepaid_account_id",
    "description",
  ]),
  attach_prepaid_refund: new Set(["idempotency_key", "schedule_id", "transaction_id", "amount_minor"]),
  update_prepaid_schedule: new Set(["idempotency_key", "schedule_id", "months", "expense_category_id", "project_id"]),
  end_prepaid_schedule: new Set(["idempotency_key", "schedule_id", "from_month", "remaining"]),
  delete_prepaid_schedule: new Set(["idempotency_key", "schedule_id"]),
  set_books_closed_through: new Set(["idempotency_key", "date"]),
};

// Not imported from tools_schemas.ts: that file imports this one through tools_ledger.ts.
const KEY = z.string().min(1).max(128);
const ID = z.string().regex(UUID).transform((id) => id.toLowerCase());
const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const MINOR = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const MONTHS = z.number().int().min(1).max(120);

const createSchema = z.object({
  idempotency_key: KEY,
  transaction_id: ID,
  expense_category_id: ID,
  project_id: ID.nullish(),
  start_month: MONTH,
  months: MONTHS,
  amount_minor: MINOR.nullish(),
  day_of_month: z.number().int().min(1).max(28).nullish(),
  prepaid_account_id: ID.nullish(),
  description: z.string().trim().min(1).max(120).nullish(),
}).strict();

const refundSchema = z.object({
  idempotency_key: KEY,
  schedule_id: ID,
  transaction_id: ID,
  amount_minor: MINOR.nullish(),
}).strict();

// At least one change; months, category and project are the future rows only.
const updateSchema = z.object({
  idempotency_key: KEY,
  schedule_id: ID,
  months: MONTHS.optional(),
  expense_category_id: ID.optional(),
  project_id: ID.optional(),
}).strict().refine((b) => b.months !== undefined || b.expense_category_id !== undefined || b.project_id !== undefined, "nothing to change");

const endSchema = z.object({
  idempotency_key: KEY,
  schedule_id: ID,
  from_month: MONTH,
  remaining: z.enum(["expense", "keep"]),
}).strict();

const deleteSchema = z.object({ idempotency_key: KEY, schedule_id: ID }).strict();

// date: a real calendar day, or null to open the books again. The database refuses a future date.
const closedSchema = z.object({
  idempotency_key: KEY,
  date: z.string().refine(isCalendarDate).nullable(),
}).strict();

const LIST_SCHEMA = z.object({ status: z.enum(["active", "completed", "ended"]).nullish() }).strict();
const GET_SCHEMA = z.object({ id: ID }).strict();

export async function prepaidRead(
  name: typeof PREPAID_READS[number],
  args: Record<string, unknown>,
  rpc: ToolRpc,
): Promise<ToolResult> {
  let rpcName: string;
  let body: Record<string, unknown>;
  if (name === "list_prepaid_schedules") {
    const p = LIST_SCHEMA.safeParse(args);
    if (!p.success) return fail("validation", "validation");
    rpcName = "mcp_list_prepaid_schedules";
    body = { p_status: p.data.status ?? null };
  } else {
    const p = GET_SCHEMA.safeParse(args);
    if (!p.success) return fail("validation", "validation");
    rpcName = "mcp_get_prepaid_schedule";
    body = { p_schedule_id: p.data.id };
  }
  const result = await rpc(rpcName, body);
  if (result.status >= 400) return fail("refused", READ_REFUSED);
  return envelopeOf(result.json, READ_REFUSED);
}

export async function prepaidWrite(
  name: typeof PREPAID_WRITES[number],
  args: Record<string, unknown>,
  rpc: ToolRpc,
): Promise<ToolResult> {
  let rpcName: string;
  let body: Record<string, unknown>;
  if (name === "create_prepaid_schedule") {
    const p = createSchema.safeParse(args);
    if (!p.success) return fail("validation", "validation");
    rpcName = "mcp_create_prepaid_schedule";
    body = {
      p_idempotency_key: p.data.idempotency_key,
      p_transaction_id: p.data.transaction_id,
      p_expense_category_id: p.data.expense_category_id,
      p_start_month: p.data.start_month,
      p_months: p.data.months,
      p_project_id: p.data.project_id ?? null,
      p_amount_minor: p.data.amount_minor ?? null,
      p_day_of_month: p.data.day_of_month ?? null,
      p_prepaid_account_id: p.data.prepaid_account_id ?? null,
      p_description: p.data.description ?? null,
    };
  } else if (name === "attach_prepaid_refund") {
    const p = refundSchema.safeParse(args);
    if (!p.success) return fail("validation", "validation");
    rpcName = "mcp_attach_prepaid_refund";
    body = {
      p_idempotency_key: p.data.idempotency_key,
      p_schedule_id: p.data.schedule_id,
      p_transaction_id: p.data.transaction_id,
      p_amount_minor: p.data.amount_minor ?? null,
    };
  } else if (name === "update_prepaid_schedule") {
    const p = updateSchema.safeParse(args);
    if (!p.success) return fail("validation", "validation");
    rpcName = "mcp_update_prepaid_schedule";
    body = {
      p_idempotency_key: p.data.idempotency_key,
      p_schedule_id: p.data.schedule_id,
      p_months: p.data.months ?? null,
      p_expense_category_id: p.data.expense_category_id ?? null,
      p_project_id: p.data.project_id ?? null,
    };
  } else if (name === "end_prepaid_schedule") {
    const p = endSchema.safeParse(args);
    if (!p.success) return fail("validation", "validation");
    rpcName = "mcp_end_prepaid_schedule";
    body = {
      p_idempotency_key: p.data.idempotency_key,
      p_schedule_id: p.data.schedule_id,
      p_from_month: p.data.from_month,
      p_remaining: p.data.remaining,
    };
  } else if (name === "delete_prepaid_schedule") {
    const p = deleteSchema.safeParse(args);
    if (!p.success) return fail("validation", "validation");
    rpcName = "mcp_delete_prepaid_schedule";
    body = { p_idempotency_key: p.data.idempotency_key, p_schedule_id: p.data.schedule_id };
  } else {
    const p = closedSchema.safeParse(args);
    if (!p.success) return fail("validation", "validation");
    rpcName = "mcp_set_books_closed_through";
    body = { p_idempotency_key: p.data.idempotency_key, p_date: p.data.date };
  }
  const result = await rpc(rpcName, body);
  if (result.status >= 400) return fail("refused", WRITE_REFUSED);
  return envelopeOf(result.json);
}
