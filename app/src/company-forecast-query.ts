import { useQuery, type QueryClient } from "@tanstack/react-query";
import { forecastRowsOf, forecastTotalsOf, withSkips, type CompanyForecastRows, type CompanyForecastTotals, type ForecastMonthTotals } from "./company-forecast-map";
import { futureForecastKey } from "./forecast-future-keys";
import { setCompanyForecastPatch } from "./forecast-month";
import { useForecastOverrides } from "./forecast-skip";
import { incomeFactsOf, type RentCategory } from "./next-month-chart";
import { useHomePreview } from "./preview";
import { readyClient } from "./ready-client";

/**
 * FLOW-1308 (plan FLOW-1275, slice 7): the company's forecast, one read each: `company_forecast` (FLOW-1307) with
 * 'totals' for Profit's next-month card (one month) and its year view (every month left in the year), and with 'rows'
 * for one month's page (Home's month to come, the company's צפי and תזרים pages). It replaces the four reads the app made and
 * built from (expected months, the loans, the company's inputs, the categories). The keys are under "month-forecast", so a
 * skip, a project's edit or a sync refreshes them as it refreshes the month forecast. Only 'totals' is kept on the device
 * (kept-rules.ts): it is what the card draws; the rows are far bigger and not a first view.
 */

/** The query of 'totals' for these months (a month of the forecast each: next month to a year ahead), the day in its key. */
export function useCompanyForecastTotals(today: string, months: readonly string[], enabled: boolean) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["month-forecast", preview, "company", "totals", today, months.join(",")],
    enabled: enabled && preview === "off" && months.length > 0,
    queryFn: async (): Promise<CompanyForecastTotals> => {
      const supabase = await readyClient();
      const { data, error } = await supabase.rpc("company_forecast", { p_months: [...months], p_detail: "totals", p_today: today });
      if (error) throw error;
      return forecastTotalsOf(data);
    },
  });
}

/** The query of 'rows' for one month of the forecast. */
export function useCompanyForecastRows(today: string, month: string, enabled: boolean) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["month-forecast", preview, "company", "rows", today, month],
    enabled: enabled && preview === "off",
    queryFn: async (): Promise<CompanyForecastRows> => {
      const supabase = await readyClient();
      const { data, error } = await supabase.rpc("company_forecast", { p_months: [month], p_detail: "rows", p_today: today });
      if (error) throw error;
      return forecastRowsOf(data);
    },
  });
}

/**
 * A month's page: its rows in one read, and, where a row can be skipped (`withOverrides`), the month's override rows too
 * (a skip's undo puts the row back as it was: its amount and day, which the keys alone do not hold). `pending` is "nothing
 * to draw yet", `paused` a read waiting for the network, `refetch` every one of them again.
 */
export function useCompanyMonthRows(today: string, month: string, enabled: boolean, withOverrides: boolean) {
  const preview = useHomePreview();
  const live = enabled && preview === "off";
  const rows = useCompanyForecastRows(today, month, live);
  const overrides = useForecastOverrides(month, live && withOverrides);
  const reads = withOverrides ? [rows, overrides] : [rows];
  return {
    answer: rows.data ?? null,
    overrides: overrides.data ?? null,
    pending: live && reads.some((read) => read.isPending) && !reads.some((read) => read.isPaused),
    failed: live && reads.some((read) => read.isError),
    paused: live && reads.some((read) => read.isPaused),
    refetch: () => Promise.all(reads.map((read) => read.refetch())),
  };
}

/**
 * A skip, reset or undo drawn at once in every cached 'rows' answer of the month (forecast-month.ts calls this at the tap):
 * the rows move as withSkips moves them, and the month's totals and income note with them. The cached 'totals' of that month
 * (Profit's card) are written from the same month; the others (the year view's) cannot be moved and are dropped, so no pre-skip
 * figure is drawn. The keys the month holds are those of the rows taken out (`skipped`); `change` gives the keys after the
 * write. Returns the undo for a failed write: it puts an answer back if nothing else has touched it since.
 */
function patchRows(client: QueryClient, month: string, change: (keys: readonly string[]) => readonly string[]): () => void {
  const patched: Array<{ key: readonly unknown[]; before: unknown; after: unknown }> = [];
  const set = (key: readonly unknown[], before: unknown, after: unknown) => {
    client.setQueryData(key, after);
    patched.push({ key, before, after });
  };
  const months = new Map<string, ForecastMonthTotals>();
  const companyQueries = (kind: string) => client.getQueryCache().findAll({ queryKey: ["month-forecast"], predicate: (query) => query.queryKey[2] === "company" && query.queryKey[3] === kind });
  for (const query of companyQueries("rows")) {
    const before = query.state.data as CompanyForecastRows | undefined;
    const [first, ...rest] = before?.months ?? [];
    if (before == null || first == null || query.queryKey[5] !== month) continue;
    const keyOf = futureForecastKey(before.forecast, before.currency);
    const now = before.forecast.skipped.flatMap(({ row, projectId }) => keyOf(row.key, projectId) ?? []);
    const forecast = withSkips(before.forecast, new Set(change(now)), before.currency);
    if (forecast === before.forecast) {
      months.set(`${String(query.queryKey[1])}|${String(query.queryKey[4])}`, first);
      continue;
    }
    // The income note counts follow the income rows, with the categories the app has cached (the pickers' and the project page's read; none cached: they stay as they were).
    const categories = client.getQueryData<RentCategory[]>(["categories", query.queryKey[1]]);
    const income = categories == null ? first.income : incomeFactsOf(forecast.rows, categories);
    const month0: ForecastMonthTotals = { ...first, income, incomeMinor: forecast.incomeMinor, expenseMinor: forecast.expenseMinor, netMinor: forecast.netMinor, cashOnlyMinor: forecast.parts.reduce((sum, part) => sum + part.forecast.cashOnlyMinor, 0n), projects: forecast.parts.filter((part) => part.projectId != null).length, general: forecast.parts.some((part) => part.projectId == null) };
    months.set(`${String(query.queryKey[1])}|${String(query.queryKey[4])}`, month0);
    set(query.queryKey, before, { ...before, forecast, months: [month0, ...rest] });
  }
  for (const query of companyQueries("totals")) {
    const before = query.state.data as CompanyForecastTotals | undefined;
    const month0 = months.get(`${String(query.queryKey[1])}|${String(query.queryKey[4])}`);
    if (before != null && month0 != null && query.queryKey[5] === month && before.months.length === 1) set(query.queryKey, before, { ...before, months: [month0] });
    else if (String(query.queryKey[5]).split(",").includes(month)) client.removeQueries({ queryKey: query.queryKey, type: "inactive" });
  }
  return () => {
    for (const { key, before, after } of patched) if (client.getQueryData(key) === after) client.setQueryData(key, before);
  };
}

setCompanyForecastPatch(patchRows);
