// MCP tools: a property's returns (FLOW-450, decision 0244), the way Real Estate by the Numbers analyses a
// rental. Two reads, get_property_returns and get_property_return_lines (the lines behind one figure), and
// two writes, set_tax_bracket (undo kind tax_bracket) and set_land_account (FLOW-461, decision 0248; undo
// kind land_account) and set_loan_closing_paid (FLOW-466; undo kind loan_closing_paid). Units and a typed
// land are set_project_investment keys.
import { z } from "zod";
import { DATE, envelopeOf, fail, ok, READ_REFUSED, type ToolResult, type ToolRpc, UUID, WRITE_REFUSED } from "./tools_args.ts";

const LINES = ["income", "opex", "debt_service", "capex", "principal", "before_rent", "not_counted", "rehab", "acquisition", "renovation", "holding", "financing", "money_in", "deal_holding", "irr_out", "irr_in"];

export const PROPERTY_READS = ["get_property_returns", "get_property_return_lines"] as const;

/** The tools' argument allow-list, merged into ALLOWED in tools_schemas.ts. */
export const PROPERTY_ALLOWED: Record<string, Set<string>> = {
  get_property_returns: new Set(["project_id", "from", "to"]),
  get_property_return_lines: new Set(["project_id", "line", "from", "to", "category_id", "limit", "offset"]),
  set_tax_bracket: new Set(["idempotency_key", "tax_bracket_percent"]),
  set_land_account: new Set(["idempotency_key", "account_id"]),
  set_loan_closing_paid: new Set(["idempotency_key", "loan_id", "closing_paid"]),
};

export const PROPERTY_WRITES = ["set_tax_bracket", "set_land_account", "set_loan_closing_paid"] as const;

// The owner's marginal tax bracket, a percent with at most two decimals (24 or 24.5); null clears it.
const taxBracketSchema = z.object({
  idempotency_key: z.string().min(1).max(128),
  tax_bracket_percent: z.number().min(0).max(100)
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6).nullable(),
}).strict();

// What a loan paid at closing, in major units with at most two decimals; null is the whole loan.
const closingPaidSchema = z.object({
  idempotency_key: z.string().min(1).max(128),
  loan_id: z.string().regex(UUID),
  closing_paid: z.union([z.number(), z.string().regex(/^\d+(\.\d{1,2})?$/).transform(Number)])
    .refine((v) => Number.isFinite(v) && v >= 0 && Math.abs(v * 100 - Math.round(v * 100)) < 1e-6).nullable(),
}).strict();

const landAccountSchema = z.object({
  idempotency_key: z.string().min(1).max(128),
  account_id: z.string().regex(UUID).nullable(),
}).strict();

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

export const PROPERTY_READ_SPECS = [
  spec("get_property_returns", "A property project's returns for a period (from and to, YYYY-MM-DD, both or neither; default the last 12 months to today), the way Real Estate by the Numbers analyses a rental (FLOW-450, FLOW-453). Amounts are minor units of the project's investment currency; lines in other currencies are left out and listed in other_currencies. Cash lines only: posted, paid lines filed to the project and its share of shared lines, as the cash view counts them (a journal entry such as depreciation is not cash). first_rent is the first rent payment: before it the owner is still investing, from it on the property earns. statement (from the first rent on): income_minor, opex_minor, noi_minor (income + opex), debt_service_minor (a loan payment's principal, interest and fees), capex_minor (categories with set_category_rehab true), cash_flow_minor (noi + debt service + capex), before_rent_minor (the period's costs before the first rent, not in the cash flow), not_counted_minor (the period's kept-out lines: purchase, closing, loan proceeds), with lines and by_category per line (income, opex, debt_service, capex, holding, renovation, acquisition, financing). Costs are negative. equity: money_in_minor, the money in the deal from the real lines = -(acquisition + renovation + holding + financing + shortfall), with money_in_parts: acquisition_minor (kept-out costs at any time: the purchase and closing), renovation_minor (rehab categories before the first rent), holding_minor (every other cost before the first rent: interest, insurance, utilities), financing_minor (kept-out income at any time: the net loan proceeds, refunds), shortfall_minor (the running cash flow since the first rent, all time, when below zero, else 0: money the owner added to cover losses, FLOW-1025), so loan costs held back at closing count and a cash-out refinance lowers it; all_cash_out is true when it is 0 or less (then the per-cent figures are null), and cash_out_cover_months is then, with a negative cash flow in the period, the whole months of that cash flow at its yearly pace the cash still out covers (else null); equity_today_minor (value - loan balance) and forced_equity_minor (ARV - purchase - rehab). The purchase is the acquisition lines plus a loan paid out at closing without passing through the bank (a Sub2 mortgage taken over, a lender who paid the title company: inputs.taken_over_minor, taken_over_loans with closing_paid_minor, draws_minor and counted_minor), counted by what it paid at closing (set_loan_closing_paid), else its principal less the draws it paid into the bank (draws_minor: loan proceeds after its start, up to its payoff and before the first rent, not another loan's proceeds, and not draws lent on top of the principal, which the payoff shows by repaying more than it; FLOW-1197), or the typed purchase_minor when there are no purchase lines (inputs.purchase_source lines or typed). Units are 1 until set (inputs.units_default). sources: cash_flow_minor, principal_minor, appreciation_minor (value at the end of the period minus the value at its start, or the first value recorded in the period when none precedes it, from the values set with set_project_investment), tax_savings_minor ((purchase + rehab - land) / 27.5 years x the tax bracket, for the days in service: from the first rent, FLOW-466), depreciation_year_minor, building_minor, total_minor (a missing source left out) and total_bp (per year, on the money in). metrics: cash_on_cash_bp and cap_rate_bp (per year), dscr_milli, cash_flow_per_unit_month_minor. When the first rent falls inside the period, cash on cash, cap rate and the cash flow per unit scale to a year over the days since it (earning_days, annualized_from; FLOW-464), not the whole period; months empty after the first rent still count, and the total return (total_bp) scales from the first rent the same way (FLOW-466). few_earning_days is true when they scale from fewer than 60 days (FLOW-473): the figures are still given, but the app shows them as too little data, so do not quote them as a year's return. The land is the typed land, else the property's postings to the land account named with set_land_account (inputs.land_source typed or books); with no account named, inputs.land_suggestion offers one. deal (FLOW-1068): selling_cost_bp (set_project_investment, 800 when not set: selling_cost_default true), selling_cost_minor (ARV x selling_cost_bp), holding_minor (the holding costs, all time, that rehab does not already count; negative), net_profit_minor (a renovation's profit at the sale: ARV - selling costs - purchase - rehab - the holding costs rehab does not count; null without an ARV, purchase or rehab), acquired_on (the first purchase line's date), held_days (from it to the period's end), life_cash_flow_minor (the cash flow since the first rent, all time), and the IRR's flows (FLOW-1069): irr_out_minor (what went in, negative), irr_in_minor (what came back), irr_terminal_minor (the last flow, at the period's end: equity today, or with no value the ARV less the selling costs and the loans) and irr_dates. More metrics, each null when an input is missing: roe_bp (the total return for a year on equity_today_minor), roi_since_purchase_bp ((cash back + equity today - money in) / money in, cash back being life_cash_flow_minor when above zero), equity_multiple_milli ((cash back + equity today) / money in, x 1000), break_even_occupancy_bp ((operating expenses + loan payments) / income), expense_ratio_bp (operating expenses / income), grm_milli (purchase / the income for a year, x 1000), ltv_bp (loan balance / value), and for a renovation flip_roi_bp (net profit / money in), flip_roi_year_bp (that x 365 / held_days), arv_margin_bp (net profit / ARV), rule_70_minor (ARV x 70% - rehab - purchase: below zero the price was over the 70% rule) and break_even_sale_minor (the sale price that leaves no profit after the selling costs); irr_bp, the IRR since the purchase (XIRR, actual/365) on every dated line of the property from the first purchase line, with irr_terminal_minor as the last flow, null without a purchase line, a value or an ARV, or a rate. missing names each missing input: purchase, value, value_history, land, tax_bracket. Nothing is guessed. get_property_return_lines lists the lines behind any figure. Another company's project is not_found.", {
    project_id: { type: "string" },
    from: { type: "string" },
    to: { type: "string" },
  }, false),
  spec("get_property_return_lines", "The lines behind one of get_property_returns' figures, newest first. For the period (from and to as in get_property_returns): income, opex, debt_service, capex, principal (the principal parts alone), before_rent (holding and renovation in the period) or not_counted (acquisition and financing in the period). For all time: acquisition, renovation, holding, financing, money_in (the four together), rehab (the building cost) deal_holding (the holding costs a renovation's net profit counts, deal.holding_minor: holding lines rehab does not count, a loan's principal left out), irr_out or irr_in (the IRR's cash from the first purchase line to today: every line below zero, or above it; deal.irr_out_minor and irr_in_minor). category_id narrows to one category. rows[] (transaction_id, description, supplier_name, category_id, category_name, date, amount_minor signed as in get_property_returns, parts, shared) with has_more, and total_minor and count for the whole figure. limit 1 to 200 (default 50), offset. Another company's project is not_found.", {
    project_id: { type: "string" },
    line: { type: "string", enum: LINES },
    from: { type: "string" },
    to: { type: "string" },
    category_id: { type: "string" },
    limit: { type: "integer", minimum: 1, maximum: 200 },
    offset: { type: "integer", minimum: 0 },
  }, false),
];

export const PROPERTY_WRITE_SPECS = [
  spec("set_tax_bracket", "Set the owner's marginal income tax bracket (owner only) as a percent, for example 24 or 24.5 (at most two decimals; null clears it). get_property_returns uses it for the tax savings of depreciation. Returns id, tax_bracket_bp (basis points: 2400 = 24%) and prior. Undo is kind tax_bracket with the company id, a conflict once the bracket was changed again.", {
    idempotency_key: { type: "string" },
    tax_bracket_percent: { type: ["number", "null"], minimum: 0, maximum: 100 },
  }, true),
  spec("set_land_account", "Name the balance-sheet account that holds each property's land (owner only; an asset account from list_accounts, null unlinks). get_property_returns then reads a property's land from its own postings to that account (inputs.land_source books) unless a land value was typed with set_project_investment (land_source typed). Until one is named, get_property_returns offers inputs.land_suggestion: an asset account whose name says land, with a balance on the property. Returns id (the company), land_account_id and prior. Undo is kind land_account with the company id, a conflict once it was changed again.", {
    idempotency_key: { type: "string" },
    account_id: { type: ["string", "null"], format: "uuid" },
  }, true),
  spec("set_loan_closing_paid", "Set what a loan paid at closing, from the settlement statement (HUD-1), in major units (owner only; 0 to the loan's principal; null is the whole loan, the default). get_property_returns counts a loan paid out at closing without passing through the bank (inputs.taken_over_loans) into the purchase price by this amount, so a hard-money loan's renovation holdback is not counted as the price (decision 0250); with no amount set, the principal less the draws the loan paid into the bank (decision 0269). Returns id, closing_paid_minor and prior. Undo is kind loan_closing_paid with the loan id, a conflict once it was changed again.", {
    idempotency_key: { type: "string" },
    loan_id: { type: "string", format: "uuid" },
    closing_paid: { type: ["number", "string", "null"] },
  }, true),
];

// FLOW-473 (decision 0253): below this many days since a first rent inside the period, the app shows
// the per-year figures as "מעט נתונים". The same number as MIN_EARNING_DAYS in
// app/src/screens/project-returns-info.ts; keep the two together.
const MIN_EARNING_DAYS = 60;

/** get_property_returns' answer with `few_earning_days`: its per-year figures scale from under MIN_EARNING_DAYS. */
function withFewDays(json: Record<string, unknown>): Record<string, unknown> {
  const days = json.earning_days;
  return { ...json, few_earning_days: json.annualized_from != null && typeof days === "number" && days < MIN_EARNING_DAYS };
}

function dateArg(value: unknown): string | null | undefined {
  if (value == null) return null;
  return typeof value === "string" && DATE.test(value) ? value : undefined;
}

export async function propertyRead(
  name: "get_property_returns" | "get_property_return_lines",
  args: Record<string, unknown>,
  rpc: ToolRpc,
): Promise<ToolResult> {
  const projectId = args.project_id;
  if (typeof projectId !== "string" || !UUID.test(projectId)) return fail("validation", "validation");
  const from = dateArg(args.from);
  const to = dateArg(args.to);
  if (from === undefined || to === undefined) return fail("validation", "validation");
  if ((from == null) !== (to == null) || (from != null && to != null && from > to)) return fail("validation", "validation");
  const body: Record<string, unknown> = { p_project_id: projectId };
  if (from != null) Object.assign(body, { p_from: from, p_to: to });
  if (name === "get_property_return_lines") {
    if (typeof args.line !== "string" || !LINES.includes(args.line)) return fail("validation", "validation");
    const category = args.category_id ?? null;
    if (category != null && (typeof category !== "string" || !UUID.test(category))) return fail("validation", "validation");
    const limit = args.limit == null ? 50 : args.limit;
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 200) return fail("validation", "validation");
    const offset = args.offset == null ? 0 : args.offset;
    if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0) return fail("validation", "validation");
    Object.assign(body, { p_line: args.line, p_category_id: category, p_limit: limit, p_offset: offset });
  }
  const result = await rpc(name, body);
  if (result.status >= 400) return fail("refused", READ_REFUSED);
  // Null for an unknown id and for another company's project.
  if (result.json == null) return fail("not_found", "not found");
  if (typeof result.json !== "object" || Array.isArray(result.json)) return fail("refused", READ_REFUSED);
  return ok(name === "get_property_returns" ? withFewDays(result.json as Record<string, unknown>) : result.json);
}

export async function propertyWrite(
  name: typeof PROPERTY_WRITES[number],
  args: Record<string, unknown>,
  rpc: ToolRpc,
): Promise<ToolResult> {
  if (name === "set_loan_closing_paid") {
    const closing = closingPaidSchema.safeParse(args);
    if (!closing.success) return fail("validation", "validation");
    const amount = closing.data.closing_paid;
    const result = await rpc("mcp_set_loan_closing_paid", {
      p_idempotency_key: closing.data.idempotency_key,
      p_loan_id: closing.data.loan_id,
      p_closing_paid_minor: amount == null ? null : Math.round(amount * 100),
    });
    if (result.status >= 400) return fail("refused", WRITE_REFUSED);
    return envelopeOf(result.json);
  }
  if (name === "set_land_account") {
    const land = landAccountSchema.safeParse(args);
    if (!land.success) return fail("validation", "validation");
    const result = await rpc("mcp_set_land_account", {
      p_idempotency_key: land.data.idempotency_key,
      p_account_id: land.data.account_id,
    });
    if (result.status >= 400) return fail("refused", WRITE_REFUSED);
    return envelopeOf(result.json);
  }
  const parsed = taxBracketSchema.safeParse(args);
  if (!parsed.success) return fail("validation", "validation");
  const percent = parsed.data.tax_bracket_percent;
  const result = await rpc("mcp_set_tax_bracket", {
    p_idempotency_key: parsed.data.idempotency_key,
    p_bp: percent == null ? null : Math.round(percent * 100),
  });
  if (result.status >= 400) return fail("refused", WRITE_REFUSED);
  return envelopeOf(result.json);
}
