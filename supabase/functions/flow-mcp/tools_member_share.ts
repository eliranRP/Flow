// MCP tools: the member share report (FLOW-1117, decision 0263). Two reads, get_member_report (the setting
// and each property's inputs) and get_member_share (the share computed by packages/shared/src/member-share.ts,
// the app's calculation), and one write, set_member_report (undo kind member_report).
import { z } from "zod";
import {
  computeMemberShare,
  type MemberReportConfig,
  type MemberReportProperty,
} from "../../../packages/shared/src/member-share.ts";
import { envelopeOf, fail, ok, READ_REFUSED, type ToolResult, type ToolRpc, WRITE_REFUSED } from "./tools_args.ts";

export const MEMBER_SHARE_READS = ["get_member_report", "get_member_share"] as const;
export const MEMBER_SHARE_WRITES = ["set_member_report", "refresh_treasury_yields"] as const;

/** The tools' argument allow-list, merged into ALLOWED in tools_schemas.ts. */
export const MEMBER_SHARE_ALLOWED: Record<string, Set<string>> = {
  get_member_report: new Set([]),
  get_member_share: new Set(["member"]),
  set_member_report: new Set(["idempotency_key", "members", "assumptions", "rate_rule", "quotes", "yields", "quote_date"]),
  refresh_treasury_yields: new Set(["idempotency_key"]),
};

const DATE_TEXT = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const UUID_TEXT = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const PART_KEYS = ["members", "assumptions", "rate_rule", "quotes", "yields", "quote_date"] as const;

// The shapes the database checks too (private.member_report_check); a null part clears it.
const setMemberReportSchema = z.object({
  idempotency_key: z.string().min(1).max(128),
  members: z.array(z.object({ name: z.string().trim().min(1).max(60), ownership_bp: z.number().int().min(0).max(10000) }).strict())
    .max(20).nullable().optional(),
  assumptions: z.object({
    ltv_bp: z.number().int().min(0).max(10000).optional(),
    closing_bp: z.number().int().min(0).max(2000).optional(),
    term_years: z.number().int().min(1).max(40).optional(),
  }).strict().nullable().optional(),
  rate_rule: z.object({
    tenor_years: z.union([z.literal(5), z.literal(10)]).optional(),
    spread_bp: z.number().int().min(0).max(1000).optional(),
  }).strict().nullable().optional(),
  quotes: z.array(z.object({
    id: UUID_TEXT,
    lender: z.string().trim().min(1).max(80),
    rate_ppm: z.number().int().min(1).max(300000),
    points_bp: z.number().int().min(0).max(1000).optional(),
    quoted_on: DATE_TEXT,
    loan_type: z.enum(["fixed", "arm", "dscr", "other"]).optional(),
    project_id: UUID_TEXT.nullable().optional(),
  }).strict()).max(50).nullable().optional(),
  yields: z.array(z.object({
    on_date: DATE_TEXT,
    y5_ppm: z.number().int().min(0).max(200000).nullable().optional(),
    y10_ppm: z.number().int().min(0).max(200000).nullable().optional(),
    source: z.enum(["treasury", "manual"]).optional(),
  }).strict()).max(400).nullable().optional(),
  quote_date: DATE_TEXT.nullable().optional(),
}).strict().refine((v) => PART_KEYS.some((k) => v[k] !== undefined));

const MINOR = z.union([z.number(), z.string()]).transform((v) => BigInt(v));
const readSchema = z.object({
  config: z.record(z.string(), z.unknown()).nullable(),
  properties: z.array(z.object({
    project_id: z.string(),
    name: z.string(),
    currency: z.string(),
    value_minor: MINOR.nullable(),
    value_date: z.string().nullable(),
    selling_cost_bp: z.number().nullable(),
    loan_balance_minor: MINOR,
    loans_other_currency: z.boolean(),
  })),
  treasury_yields: z.array(z.object({
    on_date: z.string(),
    y5_ppm: z.number().int().nullable(),
    y10_ppm: z.number().int().nullable(),
  })).default([]),
  can_edit: z.boolean(),
});

/** JSON for an answer: bigints as numbers (minor units stay far under 2^53). */
function plain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_k, v: unknown) => (typeof v === "bigint" ? Number(v) : v)));
}

export async function memberShareRead(name: typeof MEMBER_SHARE_READS[number], args: Record<string, unknown>, rpc: ToolRpc): Promise<ToolResult> {
  const member = args.member ?? null;
  if (member != null && (typeof member !== "string" || member.trim() === "")) return fail("validation", "validation");
  const result = await rpc("get_member_report", {});
  if (result.status >= 400) return fail("refused", READ_REFUSED);
  if (name === "get_member_report") {
    if (result.json == null || typeof result.json !== "object") return fail("refused", READ_REFUSED);
    return ok(result.json);
  }
  const parsed = readSchema.safeParse(result.json);
  if (!parsed.success) return fail("refused", READ_REFUSED);
  const share = computeMemberShare(
    parsed.data.config as MemberReportConfig | null,
    parsed.data.properties as MemberReportProperty[],
    parsed.data.treasury_yields,
  );
  if (member != null) {
    const wanted = (member as string).trim().toLowerCase();
    const found = share.members.find((m) => m.name.toLowerCase() === wanted);
    if (found == null) return fail("not_found", "member not found");
    return ok(plain({ ...share, members: [found] }));
  }
  return ok(plain(share));
}

export async function memberShareWrite(args: Record<string, unknown>, rpc: ToolRpc, name = "set_member_report"): Promise<ToolResult> {
  if (name === "refresh_treasury_yields") {
    const key = args.idempotency_key;
    if (typeof key !== "string" || key.length < 1 || key.length > 128 || Object.keys(args).some((k) => k !== "idempotency_key")) {
      return fail("validation", "validation");
    }
    const result = await rpc("mcp_refresh_treasury_yields", { p_idempotency_key: key });
    if (result.status >= 400) return fail("refused", WRITE_REFUSED);
    return envelopeOf(result.json);
  }
  const parsed = setMemberReportSchema.safeParse(args);
  if (!parsed.success) return fail("validation", "validation");
  const { idempotency_key, ...patch } = parsed.data;
  const result = await rpc("mcp_set_member_report", { p_idempotency_key: idempotency_key, p_patch: patch });
  if (result.status >= 400) return fail("refused", WRITE_REFUSED);
  return envelopeOf(result.json);
}

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

export const MEMBER_SHARE_READ_SPECS = [
  spec("get_member_report", "The member share report's inputs (FLOW-1117): config, the company's setting (null before the first set_member_report): members (name, ownership_bp; they add up to 10000), assumptions (ltv_bp, closing_bp, term_years), rate_rule (tenor_years 5 or 10, spread_bp), quotes (id, lender, rate_ppm, points_bp, quoted_on, loan_type, project_id or null for all), yields (on_date, y5_ppm, y10_ppm, source treasury or manual) and quote_date; properties: each active project with a value or an open loan, not the overhead project (project_id, name, currency, value_minor, value_date, selling_cost_bp or null, loan_balance_minor of its open loans in its currency, loans_other_currency); treasury_yields, the US Treasury's daily yields fetched every four hours (FLOW-1119: on_date, y5_ppm, y10_ppm) from two weeks before the earliest quote date to today; can_edit (the owner). Rates are parts per million (6.125% is 61250).", {}, false),
  spec("get_member_share", "An LLC member's share, as the app's דוח שותף computes it (FLOW-1117). Sell everything: per property value - selling costs (selling_cost_bp, else 8%) - open loans (saleNetMinor). Refinance: a new loan at assumptions ltv (default 75%) of the value, less the open loans and the closing costs (default 2% of the new loan); cashOutMinor, and a property where it is not above zero is not refinanced (refinances false). rate: quoteDate (config quote_date, else the latest quote's date), yieldDate (that date or the closest day before with a yield), yieldSource (manual: typed in the setting, which wins for its date and tenor; treasury: fetched), yieldPpm (the 5 or 10 year Treasury, rate_rule tenor_years, default 10), expectedPpm (yield + spread_bp x 100, default 150), paymentPpm (expected, else the best quote) and each quote's diffPpm and verdict (good at or under expected, near within 2500 ppm, high). paymentMinor is a 30-year (term_years) payment of principal and interest at paymentPpm. members: name, ownershipBp, saleMinor and refinanceMinor (their ownership of the totals); member (a name, any case) keeps one, else not_found. missing lists properties left out: no value, another currency than the report's, loans in another currency. Amounts are minor units of currency. Before tax.", {
    member: { type: "string" },
  }, false),
];

export const MEMBER_SHARE_WRITE_SPECS = [
  spec("set_member_report", "Set parts of the member share report (owner only; FLOW-1117): members (name, ownership_bp; when any, they must add up to 10000, else 'ownership must add up to 100%'; names unique), assumptions (ltv_bp 0 to 10000, closing_bp 0 to 2000, term_years 1 to 40), rate_rule (tenor_years 5 or 10, spread_bp 0 to 1000), quotes (up to 50: id a new uuid, lender, rate_ppm, points_bp, quoted_on, loan_type fixed, arm, dscr or other, project_id from get_member_report or null), yields (up to 400: on_date, y5_ppm, y10_ppm, source manual or treasury) and quote_date. A part named replaces that part whole (send every quote to keep it); a part left out stays; null clears it. Name at least one. Returns id (the company), config (after) and prior. Undo is kind member_report with the company id: it puts the setting before back, a conflict once it changed since.", {
    idempotency_key: { type: "string" },
    members: { type: ["array", "null"], items: { type: "object" } },
    assumptions: { type: ["object", "null"] },
    rate_rule: { type: ["object", "null"] },
    quotes: { type: ["array", "null"], items: { type: "object" } },
    yields: { type: ["array", "null"], items: { type: "object" } },
    quote_date: { type: ["string", "null"] },
  }, true),
  spec("refresh_treasury_yields", "Ask for the US Treasury's 5 and 10 year yields now (owner or editor; FLOW-1122), instead of waiting for the job that runs every four hours. At most once every five minutes for everyone: within that, requested is false with reason recent and requested_at. reason unavailable means the server cannot reach the Treasury feed. The yields arrive within a minute; get_member_report's treasury_fetched_at says when they were last stored. The yields are public market data, so nothing to undo.", {
    idempotency_key: { type: "string" },
  }, true),
];
