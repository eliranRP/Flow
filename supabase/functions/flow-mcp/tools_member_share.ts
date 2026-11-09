// MCP tools: the member share report (FLOW-1117, decision 0263). Two reads, get_member_report (the setting
// and each property's inputs) and get_member_share (the share computed by packages/shared/src/member-share.ts,
// the app's calculation), and one write, set_member_report (undo kind member_report).
import { z } from "zod";
import {
  computeMemberProjection,
  type ProjectionInput,
} from "../../../packages/shared/src/member-projection.ts";
import {
  computeMemberShare,
  type MemberReportConfig,
  type MemberReportLoan,
  type MemberReportProperty,
} from "../../../packages/shared/src/member-share.ts";
import { envelopeOf, fail, ok, READ_REFUSED, type ToolResult, type ToolRpc, WRITE_REFUSED } from "./tools_args.ts";

export const MEMBER_SHARE_READS = ["get_member_report", "get_member_share", "get_member_projection"] as const;
export const MEMBER_SHARE_WRITES = ["set_member_report", "refresh_treasury_yields"] as const;

/** The tools' argument allow-list, merged into ALLOWED in tools_schemas.ts. */
export const MEMBER_SHARE_ALLOWED: Record<string, Set<string>> = {
  get_member_report: new Set([]),
  get_member_share: new Set(["member"]),
  get_member_projection: new Set(["member", "years"]),
  set_member_report: new Set(["idempotency_key", "members", "assumptions", "rate_rule", "quotes", "yields", "quote_date", "projection"]),
  refresh_treasury_yields: new Set(["idempotency_key"]),
};

const DATE_TEXT = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const UUID_TEXT = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const PART_KEYS = ["members", "assumptions", "rate_rule", "quotes", "yields", "quote_date", "projection"] as const;

// FLOW-1126: the forecast's assumptions, within FLOW-1125's bounds (private.member_projection_check checks them too).
const GROWTH_BP = z.number().int().min(-2000).max(3000);
const projectionSchema = z.object({
  years: z.number().int().min(1).max(10).optional(),
  rent_growth_bp: GROWTH_BP.optional(),
  tax_growth_bp: GROWTH_BP.optional(),
  insurance_growth_bp: GROWTH_BP.optional(),
  hoa_growth_bp: GROWTH_BP.optional(),
  other_growth_bp: GROWTH_BP.optional(),
  appreciation_bp: GROWTH_BP.optional(),
  maintenance_bp: z.number().int().min(0).max(3000).optional(),
  capex_bp: z.number().int().min(0).max(3000).optional(),
  stay_months: z.number().int().min(1).max(120).optional(),
  empty_months_tenths: z.number().int().min(0).max(120).optional(),
  turnover_cost_minor: z.number().int().min(0).max(10_000_000).optional(),
  ltv_bp: z.number().int().min(0).max(10000).optional(),
  closing_bp: z.number().int().min(0).max(2000).optional(),
  rate_ppm: z.number().int().min(0).max(300000).nullable().optional(),
  term_years: z.number().int().min(1).max(40).optional(),
  by_year: z.partialRecord(z.enum(["rent", "tax", "insurance", "hoa", "other", "appreciation"]),
    z.record(z.string().regex(/^([1-9]|10)$/), GROWTH_BP)).optional(),
  category_types: z.record(UUID_TEXT, z.enum(["tax", "insurance", "hoa", "repairs", "other"]))
    .refine((types) => Object.keys(types).length <= 200).optional(),
}).strict();

// The shapes the database checks too (private.member_report_check); a null part clears it.
const setMemberReportSchema = z.object({
  idempotency_key: z.string().min(1).max(128),
  members: z.array(z.object({
    name: z.string().trim().min(1).max(60),
    ownership_bp: z.number().int().min(0).max(10000),
    loan_ids: z.array(UUID_TEXT).max(50).optional(),
  }).strict()).max(20).nullable().optional(),
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
  projection: projectionSchema.nullable().optional(),
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
    all_in_minor: MINOR.nullable().optional(),
    purchase_minor: MINOR.nullable().optional(),
    rehab_minor: MINOR.nullable().optional(),
    holding_minor: MINOR.nullable().optional(),
  })),
  loans: z.array(z.object({
    loan_id: z.string(),
    name: z.string(),
    kind: z.string(),
    project_id: z.string().nullable(),
    currency: z.string(),
    balance_minor: MINOR,
  })).default([]),
  treasury_yields: z.array(z.object({
    on_date: z.string(),
    y5_ppm: z.number().int().nullable(),
    y10_ppm: z.number().int().nullable(),
  })).default([]),
  can_edit: z.boolean(),
});

const inputsSchema = z.object({
  as_of: z.string(),
  today: z.string().optional(),
  properties: z.array(z.object({
    project_id: z.string(),
    rent_minor: MINOR,
    rented_months: z.number().int(),
    units: z.number().int(),
    costs: z.array(z.object({ category_id: z.string().nullable(), name: z.string().nullable(), amount_minor: MINOR })),
    loans: z.array(z.object({
      loan_id: z.string(),
      kind: z.enum(["amortizing", "interest_only", "balloon", "demand"]),
      currency: z.string(),
      principal_minor: MINOR,
      annual_rate_ppm: z.number().int(),
      term_months: z.number().int().nullable(),
      start_date: z.string(),
      payment_minor: MINOR.nullable(),
      interest_only_months: z.number().int().nullable(),
      amortization_months: z.number().int().nullable(),
      balance_minor: MINOR,
      rates: z.array(z.object({ effective_date: z.string(), annual_rate_ppm: z.number().int() })),
    })),
  })),
});

/** JSON for an answer: bigints as numbers (minor units stay far under 2^53). */
function plain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_k, v: unknown) => (typeof v === "bigint" ? Number(v) : v)));
}

export async function memberShareRead(name: typeof MEMBER_SHARE_READS[number], args: Record<string, unknown>, rpc: ToolRpc): Promise<ToolResult> {
  const member = args.member ?? null;
  if (member != null && (typeof member !== "string" || member.trim() === "")) return fail("validation", "validation");
  const years = args.years ?? null;
  if (years != null && (typeof years !== "number" || !Number.isInteger(years) || years < 1 || years > 10)) return fail("validation", "validation");
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
    parsed.data.loans as MemberReportLoan[],
  );
  const wanted = member == null ? null : (member as string).trim().toLowerCase();
  if (name === "get_member_projection") {
    const inputs = await rpc("get_member_projection_inputs", {});
    if (inputs.status >= 400) return fail("refused", READ_REFUSED);
    const parsedInputs = inputsSchema.safeParse(inputs.json);
    if (!parsedInputs.success) return fail("refused", READ_REFUSED);
    const projection = computeMemberProjection({
      config: parsed.data.config as MemberReportConfig | null,
      properties: parsed.data.properties as MemberReportProperty[],
      loans: parsed.data.loans as MemberReportLoan[],
      inputs: parsedInputs.data.properties as ProjectionInput[],
      asOf: parsedInputs.data.as_of,
      today: parsedInputs.data.today,
      expectedRatePpm: share.rate.expectedPpm,
      years: years == null ? undefined : (years as number),
    });
    if (wanted == null) return ok(plain(projection));
    const one = projection.members.find((m) => m.name.toLowerCase() === wanted);
    if (one == null) return fail("not_found", "member not found");
    return ok(plain({ ...projection, members: [one] }));
  }
  if (wanted != null) {
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
  spec("get_member_report", "The member share report's inputs (FLOW-1117): config, the company's setting (null before the first set_member_report): members (name, ownership_bp; they add up to 10000; loan_ids, the company's loans that member gave it), assumptions (ltv_bp, closing_bp, term_years), rate_rule (tenor_years 5 or 10, spread_bp), quotes (id, lender, rate_ppm, points_bp, quoted_on, loan_type, project_id or null for all), yields (on_date, y5_ppm, y10_ppm, source treasury or manual) and quote_date; properties: each active project with a value or an open loan, not the overhead project (project_id, name, currency, value_minor, value_date, selling_cost_bp or null, loan_balance_minor of its open loans in its currency, loans_other_currency, and all_in_minor with purchase_minor, rehab_minor and holding_minor as its investment page counts them, null without a purchase or a renovation figure in its currency); loans: the company's open loans (loan_id, name, kind, project_id, currency, balance_minor), demand loans first; treasury_yields, the US Treasury's daily yields fetched every four hours (FLOW-1119: on_date, y5_ppm, y10_ppm) from two weeks before the earliest quote date to today; can_edit (the owner). Rates are parts per million (6.125% is 61250).", {}, false),
  spec("get_member_share", "An LLC member's share, as the app's דוח שותף computes it (FLOW-1117). Sell everything: per property value - selling costs (selling_cost_bp, else 8%) - open loans (saleNetMinor); of the loans, memberLoanMinor is the members' own and bankLoanMinor the rest. totals.equityMinor is value - selling - bank loans - every member's loan (memberLoansMinor; memberLoans lists them, projectId null for the company's own): what the members split. Profit: value - selling - allInMinor (purchase + renovation + holding, as the investment page) per property (profitMinor, null without the all-in; profitMissing names those, reason purchase or rehab), totals.profitMinor of the others. Refinance: a new loan at assumptions ltv (default 75%) of the value, less the open loans and the closing costs (default 2% of the new loan); cashOutMinor, and a property where it is not above zero is not refinanced (refinances false). rate: quoteDate (config quote_date, else the latest quote's date), yieldDate (that date or the closest day before with a yield), yieldSource (manual: typed in the setting, which wins for its date and tenor; treasury: fetched), yieldPpm (the 5 or 10 year Treasury, rate_rule tenor_years, default 10), expectedPpm (yield + spread_bp x 100, default 150), paymentPpm (expected, else the best quote) and each quote's diffPpm and verdict (good at or under expected, near within 2500 ppm, high). paymentMinor is a 30-year (term_years) payment of principal and interest at paymentPpm. members: name, ownershipBp, saleMinor (their part of equityMinor), loansMinor (their own loans repaid), saleTotalMinor (the two), profitMinor and refinanceMinor (their ownership of the totals), refiLoansMinor (their own loans on the refinanced properties, paid off to them; totals.payoffMemberLoansMinor) and refiTotalMinor (the two); member (a name, any case) keeps one, else not_found. missing lists properties left out: no value, another currency than the report's, loans in another currency. Amounts are minor units of currency. Before tax.", {
    member: { type: "string" },
  }, false),
  spec("get_member_projection", "The member report's forecast (FLOW-1126): each property year by year from the last full month (as_of) and a refinance in year N (years 1 to 10, else the setting's projection.years, else 10). Each year per property: rentMinor (the scheduled rent, the median of the last three full months, × 12, growing by the rent change from year 2), vacancyMinor (monthly rent × empty months × 12 ÷ average stay), turnoverMinor (units × cost × 12 ÷ stay), costs by type (tax, insurance, hoa, other: the last 12 months of opex by category, a partial year since the first rent scaled to 12, each growing by its own change from year 2, a by_year change for year 1 too; repairs left out, maintenance replaces them), maintenanceMinor and capexMinor (percents of rent), noiMinor, debtServiceMinor (the loans' scheduled principal and interest, no escrow), cashFlowMinor, valueMinor and balanceMinor at the year's end; totals the same for the portfolio. refi: the new loan at the LTV of year N's value less that year's balances and closing (cashOutMinor; a property where it is not above zero is not refinanced), companyLoansRepaidMinor (the company's own member loans repaid first), splitMinor, ratePpm (rateIsToday: today's expected rate), dscrMilli. members: cashShareMinor, loansBackMinor (their loans on refinanced properties and their part of the company's), totalMinor, cashFlowMinor (their part of the cash flow until then); member (a name, any case) keeps one, else not_found. missing: properties left out (value, currency, loan_currency, rent). assumptions: each as used; set them with set_member_report's projection part. Before tax.", {
  member: { type: "string" },
  years: { type: "integer", minimum: 1, maximum: 10 },
}, false),
];

export const MEMBER_SHARE_WRITE_SPECS = [
  spec("set_member_report", "Set parts of the member share report (owner only; FLOW-1117): members (name, ownership_bp; when any, they must add up to 10000, else 'ownership must add up to 100%'; names unique; loan_ids, up to 50 loan ids from get_member_report's loans that member gave the company, each loan one member's), assumptions (ltv_bp 0 to 10000, closing_bp 0 to 2000, term_years 1 to 40), rate_rule (tenor_years 5 or 10, spread_bp 0 to 1000), quotes (up to 50: id a new uuid, lender, rate_ppm, points_bp, quoted_on, loan_type fixed, arm, dscr or other, project_id from get_member_report or null), yields (up to 400: on_date, y5_ppm, y10_ppm, source manual or treasury) and quote_date; and FLOW-1126's projection: the forecast's assumptions (years 1 to 10; rent_growth_bp, tax_growth_bp, insurance_growth_bp, hoa_growth_bp, other_growth_bp, appreciation_bp each -2000 to 3000; maintenance_bp and capex_bp 0 to 3000 of rent; stay_months 1 to 120; empty_months_tenths 0 to 120; turnover_cost_minor 0 to 10000000; ltv_bp, closing_bp, rate_ppm or null for today's expected rate, term_years; by_year {rent|tax|insurance|hoa|other|appreciation: {year 1 to 10 as a string key: bp}}; category_types {category id: tax|insurance|hoa|repairs|other}). A part named replaces that part whole (send every quote to keep it); a part left out stays; null clears it. Name at least one. Returns id (the company), config (after) and prior. Undo is kind member_report with the company id: it puts the setting before back, a conflict once it changed since.", {
    idempotency_key: { type: "string" },
    members: { type: ["array", "null"], items: { type: "object" } },
    assumptions: { type: ["object", "null"] },
    rate_rule: { type: ["object", "null"] },
    quotes: { type: ["array", "null"], items: { type: "object" } },
    yields: { type: ["array", "null"], items: { type: "object" } },
    quote_date: { type: ["string", "null"] },
    projection: { type: ["object", "null"] },
  }, true),
  spec("refresh_treasury_yields", "Ask for the US Treasury's 5 and 10 year yields now (owner or editor; FLOW-1122), instead of waiting for the job that runs every four hours. At most once every five minutes for everyone: within that, requested is false with reason recent and requested_at. reason unavailable means the server cannot reach the Treasury feed. The yields arrive within a minute; get_member_report's treasury_fetched_at says when they were last stored. The yields are public market data, so nothing to undo.", {
    idempotency_key: { type: "string" },
  }, true),
];
