import { useQuery, type QueryClient } from "@tanstack/react-query";
import { forecastRowsOf, forecastTotalsOf, withSkips, type CompanyForecastRows, type CompanyForecastTotals } from "./company-forecast-map";
import { futureForecastKey } from "./forecast-future-keys";
import { setCompanyForecastPatch } from "./forecast-month";
import { useForecastOverrides } from "./forecast-skip";
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
 * the rows move as withSkips moves them, and the month's totals with them. The keys the month holds are those of the rows
 * taken out (`skipped`); `change` gives the keys after the write. Returns the undo for a failed write, which puts the answers back
 * if no other change has touched them since.
 */
function patchRows(client: QueryClient, month: string, change: (keys: readonly string[]) => readonly string[]): () => void {
  const patched: Array<{ key: readonly unknown[]; before: CompanyForecastRows; after: CompanyForecastRows }> = [];
  const queries = client.getQueryCache().findAll({ queryKey: ["month-forecast"], predicate: (query) => query.queryKey[2] === "company" && query.queryKey[3] === "rows" && query.queryKey[5] === month });
  for (const query of queries) {
    const before = query.state.data as CompanyForecastRows | undefined;
    if (before == null) continue;
    const keyOf = futureForecastKey(before.forecast, before.currency);
    const now = before.forecast.skipped.flatMap(({ row, projectId }) => keyOf(row.key, projectId) ?? []);
    const forecast = withSkips(before.forecast, new Set(change(now)), before.currency);
    if (forecast === before.forecast) continue;
    const [first, ...rest] = before.months;
    if (first == null) continue;
    // The income note's counts (`income`) are not moved: they follow the read after the write.
    const month0 = { ...first, incomeMinor: forecast.incomeMinor, expenseMinor: forecast.expenseMinor, netMinor: forecast.netMinor, cashOnlyMinor: forecast.parts.reduce((sum, part) => sum + part.forecast.cashOnlyMinor, 0n), projects: forecast.parts.filter((part) => part.projectId != null).length, general: forecast.parts.some((part) => part.projectId == null) };
    const after: CompanyForecastRows = { ...before, forecast, months: [month0, ...rest] };
    client.setQueryData(query.queryKey, after);
    patched.push({ key: query.queryKey, before, after });
  }
  return () => {
    for (const { key, before, after } of patched) if (client.getQueryData(key) === after) client.setQueryData(key, before);
  };
}

setCompanyForecastPatch(patchRows);
