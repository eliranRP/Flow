import type { ForecastBuild, ForecastItem, ForecastOverrideRow } from "@flow/shared";
import { useQuery } from "@tanstack/react-query";
import { useHomePreview } from "./preview";
import { readyClient } from "./ready-client";
import { israelToday } from "./ui/date-math";

/**
 * FLOW-141: the month-end forecast's data. FLOW-1008: Home's forecast row and the תזרים צפוי screen read this same
 * query, so they show one number. It sits apart from the screen's writes (forecast-month.ts). FLOW-1019: Home starts
 * it only once it has drawn its figures.
 *
 * FLOW-1314 (plan FLOW-1275, slice 4): one read, `month_forecast` (FLOW-1313), in place of the five the app made and
 * built from (expected months, open invoices, the month's overrides, the projects' edits, the company's currency). The
 * database builds the forecast; this file turns its answer back into what `buildMonthForecast` returns, so the
 * screens, the kept data and the rest of the app see the same value as before.
 */

export type MonthForecast = {
  month: string;
  /** The company's currency (0147): the forecast counts its items and its cash. */
  base: string;
  build: ForecastBuild;
  overrides: ForecastOverrideRow[];
};

type Row = Record<string, unknown>;

const isRow = (value: unknown): value is Row => typeof value === "object" && value !== null && !Array.isArray(value);

function shapeError(what: string): Error {
  return new Error(`month_forecast: ${what}`);
}

/** An amount as a JSON number in minor units (a digit string too), as the app's other reads take it; to the app's bigint. */
function minorOf(value: unknown, what: string): bigint {
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  throw shapeError(`${what} is not a whole amount`);
}

/** A text field; a field the database left out (absent = null) is null. */
function textOf(row: Row, field: string): string | null {
  const value = row[field];
  return typeof value === "string" ? value : null;
}

/** The comparator of buildMonthForecast (packages/shared): amount, largest first, then the name in Hebrew order. The database's order of a name is not ICU's for every Hebrew pair, so the app sorts. */
function byAmountThenName(a: ForecastItem, b: ForecastItem): number {
  if (a.minor !== b.minor) return a.minor > b.minor ? -1 : 1;
  return a.name.localeCompare(b.name, "he");
}

/** One item as the database leaves it (no currency, expected_on or late_days, and no null field), restored to the builder's item. */
function itemOf(raw: unknown, base: string): ForecastItem {
  if (!isRow(raw)) throw shapeError("an item is not an object");
  const key = textOf(raw, "key");
  const { direction, kind, day } = raw;
  if (key == null || (direction !== "income" && direction !== "expense") || (kind !== "recurring" && kind !== "invoice" && kind !== "added")) throw shapeError("an item has no key, direction or kind");
  return {
    key,
    direction,
    kind,
    name: textOf(raw, "name") ?? "",
    // Items are of the company's currency only: the database leaves it out.
    currency: base,
    usual: minorOf(raw.usual, "an item's usual"),
    minor: minorOf(raw.minor, "an item's minor"),
    day: typeof day === "number" ? day : null,
    description: textOf(raw, "description"),
    due_on: textOf(raw, "due_on"),
    moved_out: raw.moved_out === true,
    overridden: raw.overridden === true,
    // The app has no payment terms (sample data only), so nothing is expected on a day or late.
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
 * month_forecast's answer as the screens read it: what `buildMonthForecast` returns for the same reads. The four lists
 * hold item keys; each is rebuilt from `items`, in its order, and sorted here (stable, as the builder's own sort).
 */
export function monthForecastOf(answer: unknown): MonthForecast {
  if (!isRow(answer) || typeof answer.month !== "string" || typeof answer.base !== "string" || !isRow(answer.build) || !Array.isArray(answer.overrides)) throw shapeError("the answer has no month, base, build or overrides");
  const { build, base } = answer;
  if (!Array.isArray(build.items)) throw shapeError("the build has no items");
  const items = build.items.map((raw) => itemOf(raw, base));
  const list = (field: string): ForecastItem[] => {
    const keys = build[field];
    if (!Array.isArray(keys) || !keys.every((key) => typeof key === "string")) throw shapeError(`the build's ${field} is not a list of keys`);
    const held = new Set<unknown>(keys);
    return items.filter((item) => held.has(item.key)).sort(byAmountThenName);
  };
  const { changed } = build;
  if (typeof changed !== "number" || !Number.isInteger(changed)) throw shapeError("the build's changed is not a count");
  return {
    month: answer.month,
    base,
    overrides: answer.overrides as ForecastOverrideRow[],
    build: {
      items,
      income: list("income"),
      expense: list("expense"),
      moved: list("moved"),
      small: list("small"),
      incomeTotal: minorOf(build.incomeTotal, "the income total"),
      expenseTotal: minorOf(build.expenseTotal, "the expense total"),
      changed,
    },
  };
}

export function useMonthForecastQuery(month: string, active = true) {
  const preview = useHomePreview();
  return useQuery({
    // Under "month-forecast", so the forecast's writes refresh it. The preview part comes first after the name, as in the other keys.
    queryKey: ["month-forecast", preview, "answer", month],
    enabled: active && preview === "off",
    queryFn: async (): Promise<MonthForecast> => {
      const supabase = await readyClient();
      // A failed read fails the forecast, as before: the screens show their failed state with its retry.
      const { data, error } = await supabase.rpc("month_forecast", { p_month: month, p_today: israelToday() });
      if (error) throw error;
      return monthForecastOf(data);
    },
  });
}
