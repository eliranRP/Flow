// MCP tools: the forecast reads from the database (FLOW-1312, plan FLOW-1275 slice 13). get_forecast reads
// public.month_forecast (FLOW-1313) in place of the four reads it built from, and get_company_forecast (new) reads
// public.company_forecast (FLOW-1307, FLOW-1318). The old tools (get_expected_months, get_company_next_month_inputs,
// get_project_forecast_edits) stay and answer as before, so an assistant's saved instructions keep working.
import { z } from "zod";
import { inForecastHorizon } from "../../../packages/shared/src/forecast-horizon.ts";
import type { ForecastBuild, ForecastItem } from "../../../packages/shared/src/month-forecast.ts";
import { DATE, fail, isCalendarDate, ok, READ_REFUSED, type ToolResult, type ToolRpc } from "./tools_args.ts";
import { forecastReadMonth, forecastReportOf, israelMonthKey } from "./tools_reports.ts";

export const FORECAST_READS = ["get_company_forecast"] as const;
export const FORECAST_READ_ALLOWED: Record<string, Set<string>> = {
  get_company_forecast: new Set(["months", "detail", "today"]),
};

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
type Row = Record<string, unknown>;
const isRow = (value: unknown): value is Row => typeof value === "object" && value !== null && !Array.isArray(value);

/** An amount as the database writes it (a JSON number, a digit string too), as a bigint; null when it is not a whole amount. */
function minorOf(value: unknown): bigint | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  return null;
}

/** A text field; one the database left out (absent = null) is null. */
const textOf = (row: Row, field: string): string | null => (typeof row[field] === "string" ? row[field] as string : null);

/** The builder's order (packages/shared month-forecast.ts): the amount, largest first, then the name in Hebrew order. */
function byAmountThenName(a: ForecastItem, b: ForecastItem): number {
  if (a.minor !== b.minor) return a.minor > b.minor ? -1 : 1;
  return a.name.localeCompare(b.name, "he");
}

/** One item as month_forecast leaves it (no currency, expected_on or late_days, no null field), as the builder's item. */
function itemOf(raw: unknown, base: string): ForecastItem | null {
  if (!isRow(raw)) return null;
  const key = textOf(raw, "key");
  const { direction, kind, day } = raw;
  const usual = minorOf(raw.usual);
  const minor = minorOf(raw.minor);
  if (key == null || usual == null || minor == null) return null;
  if ((direction !== "income" && direction !== "expense") || (kind !== "recurring" && kind !== "invoice" && kind !== "added")) return null;
  return {
    key,
    direction,
    kind,
    name: textOf(raw, "name") ?? "",
    // Items are of the company's currency only: the database leaves it out.
    currency: base,
    usual,
    minor,
    day: typeof day === "number" ? day : null,
    description: textOf(raw, "description"),
    due_on: textOf(raw, "due_on"),
    moved_out: raw.moved_out === true,
    overridden: raw.overridden === true,
    // No payment terms here (sample data only): nothing is expected on a day or late. As the app's mapper (FLOW-1314).
    expected_on: null,
    late_days: 0,
    category_id: textOf(raw, "category_id"),
    project_id: textOf(raw, "project_id"),
    project_name: textOf(raw, "project_name"),
    pace: textOf(raw, "pace"),
    line_start: textOf(raw, "line_start"),
  };
}

/**
 * month_forecast's answer as the builder's result: the four lists hold item keys; each is rebuilt from `items`, in its
 * order, and sorted as the builder sorts (the database's order of a Hebrew name is not ICU's). Null when the answer is malformed.
 */
export function buildOfAnswer(answer: unknown): { base: string; build: ForecastBuild } | null {
  if (!isRow(answer) || typeof answer.base !== "string" || !/^[A-Z]{3}$/.test(answer.base) || !isRow(answer.build)) return null;
  const { base, build } = answer as { base: string; build: Row };
  if (!Array.isArray(build.items)) return null;
  const items: ForecastItem[] = [];
  for (const raw of build.items) {
    const item = itemOf(raw, base);
    if (item == null) return null;
    items.push(item);
  }
  const lists: Record<string, ForecastItem[]> = {};
  for (const field of ["income", "expense", "moved", "small"]) {
    const keys = build[field];
    if (!Array.isArray(keys) || !keys.every((key) => typeof key === "string")) return null;
    const held = new Set<unknown>(keys);
    lists[field] = items.filter((item) => held.has(item.key)).sort(byAmountThenName);
  }
  const incomeTotal = minorOf(build.incomeTotal);
  const expenseTotal = minorOf(build.expenseTotal);
  const { changed } = build;
  if (incomeTotal == null || expenseTotal == null || typeof changed !== "number" || !Number.isInteger(changed)) return null;
  return {
    base,
    build: { items, income: lists.income!, expense: lists.expense!, moved: lists.moved!, small: lists.small!, incomeTotal, expenseTotal, changed },
  };
}

const forecastSchema = z.object({
  month: z.string().nullish(),
  today: z.string().regex(DATE).refine((value) => isCalendarDate(value)).optional(),
}).strict();

/** get_forecast (FLOW-141): month_forecast and the month's cash net, built into the same answer the four reads gave. */
export async function getForecast(args: Record<string, unknown>, rpc: ToolRpc): Promise<ToolResult> {
  const parsed = forecastSchema.safeParse(args);
  if (!parsed.success) return fail("validation", "validation");
  const { today } = parsed.data;
  const month = parsed.data.month ?? (today ? today.slice(0, 7) : israelMonthKey());
  if (!forecastReadMonth(month)) return fail("validation", "validation"); // FLOW-1066: up to the forecast's last month.
  const [forecast, cash] = await Promise.all([
    rpc("month_forecast", { p_month: month, p_today: today ?? null }),
    rpc("cash_months", { p_months: 1 }),
  ]);
  if (forecast.status >= 400 || cash.status >= 400) return fail("refused", READ_REFUSED);
  // The company's currency (0147) comes with the answer; an odd one refuses, never counting in shekels.
  const built = buildOfAnswer(forecast.json);
  if (built == null) return fail("refused", READ_REFUSED);
  return ok(forecastReportOf(month, built.build, built.base, cash.json));
}

const companySchema = z.object({
  months: z.array(z.string().regex(MONTH)).min(1).max(12),
  detail: z.enum(["totals", "rows"]).optional(),
  today: z.string().regex(DATE).refine((value) => isCalendarDate(value)).optional(),
}).strict();

/**
 * get_company_forecast (FLOW-1312): public.company_forecast as it answers. A bad month (outside next month to 12 ahead, or
 * twice), rows for more than one month, or a bad detail is refused as validation before any read; the database's own
 * refusals map the same way: 22023 validation, 42501 (no company) forbidden, anything else refused.
 */
export async function getCompanyForecast(args: Record<string, unknown>, rpc: ToolRpc): Promise<ToolResult> {
  const parsed = companySchema.safeParse(args);
  if (!parsed.success) return fail("validation", "validation");
  const { months, today } = parsed.data;
  const detail = parsed.data.detail ?? "totals";
  const horizonDay = today ?? israelMonthKey();
  if (new Set(months).size !== months.length || !months.every((month) => inForecastHorizon(month, horizonDay)) || (detail === "rows" && months.length > 1)) {
    return fail("validation", "validation");
  }
  const result = await rpc("company_forecast", { p_months: months, p_detail: detail, p_today: today ?? null });
  if (result.status >= 400) {
    const code = isRow(result.json) ? result.json.code : null;
    if (code === "22023") return fail("validation", "validation");
    if (code === "42501") return fail("forbidden", "forbidden");
    return fail("refused", READ_REFUSED);
  }
  if (!isRow(result.json) || !Array.isArray(result.json.months)) return fail("refused", READ_REFUSED);
  return ok(result.json);
}

type ReadSpec = {
  name: string;
  description: string;
  inputSchema: { type: string; properties: Record<string, unknown>; required?: string[]; additionalProperties: boolean };
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean };
};

export const FORECAST_READ_SPECS: ReadSpec[] = [
  {
    name: "get_company_forecast",
    description:
      "The company's forecast for future months (צפי החברה, FLOW-1312), as company_forecast builds it in the database for Home's future months, " +
      "the Projects tab and the company forecast pages. Input: months (one or more YYYY-MM, each once: from next month to 12 months ahead in " +
      "Israel time, so in November 2026 December 2026 to November 2027; anything else is refused: validation), detail ('totals' by default, or 'rows'; 'rows' takes ONE month only, " +
      "more than one is refused: validation) and optional today (YYYY-MM-DD, default today in Israel time; the horizon counts from it). " +
      "Output: today, currency (the company's: every amount is in it), months[] in the order asked: month, income_minor, expense_minor, net_minor " +
      "(profit terms: the parts summed), cash_only_minor (the loans' cash that no row " +
      "holds: the cash view's expense is expense_minor + cash_only_minor), projects (how many projects have a row) and general (true when the general costs have a row), " +
      "income: {rows, recurring, rent, name} (how many income rows, how many are recurring, how many of those are rent, and the name when there is one), " +
      "and income over every month asked (each stream once). With 'rows' (one month) each month also has parts[] (project_id, income_minor, " +
      "expense_minor, cash_only_minor, average_months, rows[], removed, arrived, loan_cash[]; the general costs have no project_id and are always " +
      "listed) and skipped[] (the rows a skip took out of that month alone), and the answer has split_keys (the parties split by project). A row is " +
      "{key, kind, direction, name, date, minor (signed), category_id, was_minor, pace}. A field that is null is left out. Rows come by key, then the " +
      "lines the owner added in the order they were added; sort them yourself if you list them. The edits that apply (get_project_forecast_edits) and the " +
      "owner's skips count. Figures are whole minor units. Read-only; get_company_next_month_inputs and get_expected_months still give the raw inputs.",
    inputSchema: {
      type: "object",
      properties: {
        months: { type: "array", items: { type: "string", pattern: "^\\d{4}-(0[1-9]|1[0-2])$" }, minItems: 1, maxItems: 12 },
        detail: { type: "string", enum: ["totals", "rows"] },
        today: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      },
      required: ["months"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
];
