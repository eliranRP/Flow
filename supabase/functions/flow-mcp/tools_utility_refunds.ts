// MCP tools: utility bills the tenant never paid back (FLOW-1134, decision 0265). Three reads,
// list_utility_refunds, count_utility_refunds and list_utility_payers, and four writes through their mcp_*
// functions with the idempotency key, the write rate limit and undo (id: the write): set_utility_payer
// (kind utility_payer), answer_utility_refund (utility_refund), mark_utility_refunds_seen
// (utility_refunds_seen) and refile_utility_refund (utility_refile).
import { z } from "zod";
import { DATE, envelopeOf, fail, ok, READ_REFUSED, type ToolResult, type ToolRpc, UUID, WRITE_REFUSED } from "./tools_args.ts";

const ID = z.string().regex(UUID);
const AS_OF = z.string().regex(DATE);
const KEY = z.string().min(1).max(128);

export const UTILITY_READS = ["list_utility_refunds", "count_utility_refunds", "list_utility_payers"] as const;
export const UTILITY_WRITES = [
  "set_utility_payer",
  "answer_utility_refund",
  "mark_utility_refunds_seen",
  "refile_utility_refund",
] as const;
export const UTILITY_UNDO_KINDS = ["utility_payer", "utility_refund", "utility_refunds_seen", "utility_refile"] as const;

/** The tools' argument allow-list, merged into ALLOWED in tools_schemas.ts. */
export const UTILITY_ALLOWED: Record<string, Set<string>> = {
  list_utility_refunds: new Set(["project_id", "as_of", "all"]),
  count_utility_refunds: new Set(["as_of"]),
  list_utility_payers: new Set(["project_id"]),
  set_utility_payer: new Set(["idempotency_key", "project_id", "supplier_id", "currency", "payer", "added"]),
  answer_utility_refund: new Set(["idempotency_key", "bill_transaction_id", "state", "payment_transaction_id", "as_of", "keep_category"]),
  mark_utility_refunds_seen: new Set(["idempotency_key", "project_id", "as_of"]),
  refile_utility_refund: new Set(["idempotency_key", "bill_transaction_id", "payment_transaction_id"]),
};

const listSchema = z.object({ project_id: ID.optional(), as_of: AS_OF.optional(), all: z.boolean().optional() }).strict();
const countSchema = z.object({ as_of: AS_OF.optional() }).strict();
const payersSchema = z.object({ project_id: ID }).strict();
const payerSchema = z.object({
  idempotency_key: KEY,
  project_id: ID,
  supplier_id: ID,
  currency: z.string().regex(/^[A-Z]{3}$/),
  payer: z.enum(["tenant", "company"]).nullable(),
  added: z.boolean().optional(),
}).strict();
const answerSchema = z.object({
  idempotency_key: KEY,
  bill_transaction_id: ID,
  state: z.enum(["matched", "rejected", "seen"]).nullable(),
  payment_transaction_id: ID.optional(),
  as_of: AS_OF.optional(),
  keep_category: z.boolean().optional(),
}).strict().refine((args) =>
  (args.state === "seen" ? args.payment_transaction_id === undefined
    : args.state === null || args.payment_transaction_id !== undefined) &&
  (args.keep_category === undefined || args.state === "matched")
);
const seenSchema = z.object({ idempotency_key: KEY, project_id: ID, as_of: AS_OF.optional() }).strict();
const refileSchema = z.object({ idempotency_key: KEY, bill_transaction_id: ID, payment_transaction_id: ID }).strict();

function spec(name: string, description: string, properties: Record<string, unknown>, write: boolean) {
  return {
    name,
    description,
    inputSchema: { type: "object", properties, additionalProperties: false },
    annotations: write
      ? { readOnlyHint: false, destructiveHint: true, idempotentHint: true }
      : { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  };
}

const AS_OF_TEXT = "as_of (YYYY-MM-DD, default Israel's today) is the day the match is worked out for";

export const UTILITY_READ_SPECS = [
  spec("list_utility_refunds", `Utility bills the tenant has not paid back (החזרי חשבונות, decision 0265). A utility is one supplier's bills for one property and currency: an expense filed to a property in a category named חשבונות or under it, an expense paid with a card whose name names exactly one property and says utilities (decision 0262's card-name rule), or a supplier the owner added (set_utility_payer added). Each is tenant-paid unless the owner set it company-paid, which is never checked. For every bill of a tenant-paid utility, from the first one in the books, Flow looks for an income line (not a supplier's credit note) dated from one month before the bill to as_of, filed to the property or to no property, not the refund of another bill, whose amount is within one unit of the currency (100 minor units) of the bill (rule bill), 2 or 3 of the property's bills of that month together, or the whole month (bills), or the property's usual rent (the median of its last 3 rent lines, category שכירות) plus one or more of them (rent_and_bills). Rule bill or bills with the payment filed to the category every bill of the group shares counts as refunded by itself (source auto); any other match is a suggestion (state suggested) for the user to answer with answer_utility_refund. A bill with no match 30 days after its date is not_refunded (younger: waiting). ${AS_OF_TEXT}. project_id limits it to a property (another company's is refused). By default the list is the app's: suggestions, bills not refunded, and refunds the owner matched that sit in another category (wrong_category: refile_utility_refund fixes it); all true lists every bill with its state (refunded, suggested, not_refunded, waiting, seen). Returns as_of and bills[]: bill_transaction_id, project_id, project_name, supplier_id, supplier_name, currency, category_id, category_name, amount_minor, doc_date, days (since the bill), state, source (auto, owner or null), rule (bill, bills, rent_and_bills or null), group_bill_transaction_ids (the bills one payment refunds), no_rent (the property had no rent line that month), payment (null, or transaction_id, doc_date, amount_minor, currency, description, party, project_id, category_id, category_name, split, project_name, and parts[]: the line's split parts in order, each category_id, category_name, project_id, project_name and amount_minor, [] when it is not split), wrong_category (false once the owner kept it: keep_category), keep_category and refiled. Any member reads it.`, {
    project_id: { type: "string" },
    as_of: { type: "string" },
    all: { type: "boolean" },
  }, false),
  spec("count_utility_refunds", `For Home's row: as_of, not_refunded_count, not_refunded_by_currency[] (currency, amount_minor) and suggested_count, as list_utility_refunds counts them. ${AS_OF_TEXT}. Any member reads it.`, {
    as_of: { type: "string" },
  }, false),
  spec("list_utility_payers", "A property's utilities (project_id; another company's is refused: project not found): found from its חשבונות lines or added by the owner. utilities[]: supplier_id, supplier_name, currency, payer (tenant: the tenant pays it back, the default; company: the company pays and its bills are never checked), added, found, usual_minor (the median of its last 3 bills, null with none), bill_count, last_bill_date, and category_id and category_name (the latest bill's). Any member reads it.", {
    project_id: { type: "string" },
  }, false),
];

export const UTILITY_WRITE_SPECS = [
  spec("set_utility_payer", "Who pays a property's utility (owner or editor; the property page's חשבונות section): payer tenant (השוכר מחזיר, the default) or company (החברה משלמת: none of its bills is checked again, which closes its open ones), for project_id, supplier_id and currency. added true adds a supplier by hand, so its bills count although none is filed under חשבונות. payer null removes the row (back to the default; an added supplier is no longer a utility). Refused: project not found, supplier not found, validation. Returns project_id, supplier_id, currency, payer, added, prior (null, or payer and added before), undo_kind utility_payer and id (the write): undo puts the prior back, a conflict once it was changed again.", {
    idempotency_key: { type: "string" },
    project_id: { type: "string" },
    supplier_id: { type: "string" },
    currency: { type: "string" },
    payer: { type: ["string", "null"], enum: ["tenant", "company", null] },
    added: { type: "boolean" },
  }, true),
  spec("answer_utility_refund", "Answer a utility bill from list_utility_refunds (owner or editor). state matched with payment_transaction_id: that money-in line is its refund (זה ההחזר? כן); the books stay as they are, and a payment in another category shows wrong_category for refile_utility_refund; keep_category true (only with matched) keeps that payment where it is filed (להשאיר), so the note goes, and false takes the keep back. rejected with payment_transaction_id: it is not (לא), and the pair is never suggested again. seen (no payment): closed, nothing to do (ראיתי, אין צורך בטיפול). null takes the bill's answer back (with payment_transaction_id: that pair's answer); taking back a refund Flow counted by itself (source auto) records the pair as rejected, so it is neither counted nor suggested again (state rejected in the result). Never answer without the user's word. Refused: transaction not found (another company's line), not a utility bill, not a refund payment (not money in, or another currency), undo the refile first (a refiled refund keeps its answer until undo of the refile), validation. as_of is the day an auto refund is looked up for. Returns bill_transaction_id, state, payment_transaction_id, prior_state, prior_payment_transaction_id, keep_category, undo_kind utility_refund and id (the write): undo puts the bill's answers back as they were, a conflict once they changed again.", {
    idempotency_key: { type: "string" },
    bill_transaction_id: { type: "string" },
    state: { type: ["string", "null"], enum: ["matched", "rejected", "seen", null] },
    payment_transaction_id: { type: "string" },
    as_of: { type: "string" },
    keep_category: { type: "boolean" },
  }, true),
  spec("mark_utility_refunds_seen", "Close every open not_refunded bill of a property as seen at once (owner or editor; סימון הכל כנראה), as of as_of (YYYY-MM-DD, default Israel's today). Suggestions stay open; later bills are answered one by one. Refused: project not found. Returns project_id, bill_transaction_ids (every bill it closed), undo_kind utility_refunds_seen and id (the write): undo opens every one of them again.", {
    idempotency_key: { type: "string" },
    project_id: { type: "string" },
    as_of: { type: "string" },
  }, true),
  spec("refile_utility_refund", "The one-tap fix (owner or editor; העברה ל<category> כהחזר) for a refund the owner matched (answer_utility_refund matched) that sits in another category (wrong_category): when the payment is the bills it refunds, it moves to the bill's category and property (mode move); when it is more (rent plus the bills), the bills' part is split off it into the bill's category on the property and the rest stays in its own category (mode split, part_minor). Refused: transaction not found, refund not matched, refund already in the bill's category, line has a split by category, line has an open review. Returns bill_transaction_id, payment_transaction_id, mode, category_id, part_minor, refile (what it changed), undo_kind utility_refile and id (the write): undo puts the payment back as it was, a conflict (line changed since) once the line was changed after it.", {
    idempotency_key: { type: "string" },
    bill_transaction_id: { type: "string" },
    payment_transaction_id: { type: "string" },
  }, true),
];

function readOf(result: { status: number; json: unknown }, list: string | null): ToolResult {
  const body = result.json;
  if (result.status >= 400 || body == null || typeof body !== "object" || Array.isArray(body)) return fail("refused", READ_REFUSED);
  if (list !== null && !Array.isArray((body as Record<string, unknown>)[list])) return fail("refused", READ_REFUSED);
  return ok(body);
}

export async function utilityRead(
  name: typeof UTILITY_READS[number],
  args: Record<string, unknown>,
  rpc: ToolRpc,
): Promise<ToolResult> {
  if (name === "list_utility_refunds") {
    const parsed = listSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    return readOf(await rpc("list_utility_refunds", {
      p_project_id: parsed.data.project_id ?? null,
      p_today: parsed.data.as_of ?? null,
      p_all: parsed.data.all ?? false,
    }), "bills");
  }
  if (name === "count_utility_refunds") {
    const parsed = countSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    return readOf(await rpc("count_utility_refunds", { p_today: parsed.data.as_of ?? null }), null);
  }
  const parsed = payersSchema.safeParse(args);
  if (!parsed.success) return fail("validation", "validation");
  return readOf(await rpc("list_utility_payers", { p_project_id: parsed.data.project_id }), "utilities");
}

export async function utilityWrite(
  name: typeof UTILITY_WRITES[number],
  args: Record<string, unknown>,
  rpc: ToolRpc,
): Promise<ToolResult> {
  let rpcName: string;
  let body: Record<string, unknown>;
  if (name === "set_utility_payer") {
    const parsed = payerSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_set_utility_payer";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_project_id: parsed.data.project_id,
      p_supplier_id: parsed.data.supplier_id,
      p_currency: parsed.data.currency,
      p_payer: parsed.data.payer,
      p_added: parsed.data.added ?? false,
    };
  } else if (name === "answer_utility_refund") {
    const parsed = answerSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_answer_utility_refund";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_bill_transaction_id: parsed.data.bill_transaction_id,
      p_state: parsed.data.state,
      p_payment_transaction_id: parsed.data.payment_transaction_id ?? null,
      p_today: parsed.data.as_of ?? null,
      p_keep_category: parsed.data.keep_category ?? null,
    };
  } else if (name === "mark_utility_refunds_seen") {
    const parsed = seenSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_mark_utility_refunds_seen";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_project_id: parsed.data.project_id,
      p_today: parsed.data.as_of ?? null,
    };
  } else {
    const parsed = refileSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_refile_utility_refund";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_bill_transaction_id: parsed.data.bill_transaction_id,
      p_payment_transaction_id: parsed.data.payment_transaction_id,
    };
  }
  const result = await rpc(rpcName, body);
  if (result.status >= 400) return fail("refused", WRITE_REFUSED);
  return envelopeOf(result.json);
}
