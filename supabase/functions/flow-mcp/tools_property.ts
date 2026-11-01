// MCP tools: a property's returns (FLOW-450, decision 0244), the way Real Estate by the Numbers analyses a
// rental. Two reads, get_property_returns and get_property_return_lines (the lines behind one figure), and
// one write, set_tax_bracket (undo kind tax_bracket). Units and land are set_project_investment keys.
import { z } from "zod";
import { DATE, envelopeOf, fail, ok, READ_REFUSED, type ToolResult, type ToolRpc, UUID, WRITE_REFUSED } from "./tools_args.ts";

const LINES = ["income", "opex", "debt_service", "capex", "principal", "before_rent", "not_counted", "rehab", "acquisition", "renovation", "holding", "financing", "money_in"];

export const PROPERTY_READS = ["get_property_returns", "get_property_return_lines"] as const;

/** The tools' argument allow-list, merged into ALLOWED in tools_schemas.ts. */
export const PROPERTY_ALLOWED: Record<string, Set<string>> = {
  get_property_returns: new Set(["project_id", "from", "to"]),
  get_property_return_lines: new Set(["project_id", "line", "from", "to", "category_id", "limit", "offset"]),
  set_tax_bracket: new Set(["idempotency_key", "tax_bracket_percent"]),
};

// The owner's marginal tax bracket, a percent with at most two decimals (24 or 24.5); null clears it.
const taxBracketSchema = z.object({
  idempotency_key: z.string().min(1).max(128),
  tax_bracket_percent: z.number().min(0).max(100)
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6).nullable(),
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
  spec("get_property_returns", "A property project's returns for a period (from and to, YYYY-MM-DD, both or neither; default the last 12 months to today), the way Real Estate by the Numbers analyses a rental (FLOW-450, FLOW-453). Amounts are minor units of the project's investment currency; lines in other currencies are left out and listed in other_currencies. Cash lines only: posted, paid lines filed to the project and its share of shared lines, as the cash view counts them (a journal entry such as depreciation is not cash). first_rent is the first rent payment: before it the owner is still investing, from it on the property earns. statement (from the first rent on): income_minor, opex_minor, noi_minor (income + opex), debt_service_minor (a loan payment's principal, interest and fees), capex_minor (categories with set_category_rehab true), cash_flow_minor (noi + debt service + capex), before_rent_minor (the period's costs before the first rent, not in the cash flow), not_counted_minor (the period's kept-out lines: purchase, closing, loan proceeds), with lines and by_category per line (income, opex, debt_service, capex, holding, renovation, acquisition, financing). Costs are negative. equity: money_in_minor, the money in the deal from the real lines = -(acquisition + renovation + holding + financing), with money_in_parts: acquisition_minor (kept-out costs at any time: the purchase and closing), renovation_minor (rehab categories before the first rent), holding_minor (every other cost before the first rent: interest, insurance, utilities), financing_minor (kept-out income at any time: the net loan proceeds, refunds), so loan costs held back at closing count and a cash-out refinance lowers it; all_cash_out is true when it is 0 or less (then the per-cent figures are null); equity_today_minor (value - loan balance) and forced_equity_minor (ARV - purchase - rehab). The purchase is the acquisition lines, or the typed purchase_minor when there are none (inputs.purchase_source lines or typed). sources: cash_flow_minor, principal_minor, appreciation_minor (value at the end of the period minus the value at its start, from the values set with set_project_investment), tax_savings_minor ((purchase + rehab - land) / 27.5 years x the tax bracket, for the days of the period), depreciation_year_minor, building_minor, total_minor (a missing source left out) and total_bp (per year, on the money in). metrics: cash_on_cash_bp and cap_rate_bp (per year), dscr_milli, cash_flow_per_unit_month_minor. missing names each missing input: purchase, value, value_history, land, tax_bracket, units. Nothing is guessed. get_property_return_lines lists the lines behind any figure. Another company's project is not_found.", {
    project_id: { type: "string" },
    from: { type: "string" },
    to: { type: "string" },
  }, false),
  spec("get_property_return_lines", "The lines behind one of get_property_returns' figures, newest first. For the period (from and to as in get_property_returns): income, opex, debt_service, capex, principal (the principal parts alone), before_rent (holding and renovation in the period) or not_counted (acquisition and financing in the period). For all time: acquisition, renovation, holding, financing, money_in (the four together) or rehab (the building cost). category_id narrows to one category. rows[] (transaction_id, description, supplier_name, category_id, category_name, date, amount_minor signed as in get_property_returns, parts, shared) with has_more, and total_minor and count for the whole figure. limit 1 to 200 (default 50), offset. Another company's project is not_found.", {
    project_id: { type: "string" },
    line: { type: "string", enum: ["income", "opex", "debt_service", "capex", "principal", "before_rent", "not_counted", "rehab", "acquisition", "renovation", "holding", "financing", "money_in"] },
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
];

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
  return ok(result.json);
}

export async function propertyWrite(args: Record<string, unknown>, rpc: ToolRpc): Promise<ToolResult> {
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
