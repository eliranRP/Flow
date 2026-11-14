import type { ForecastBuild, ForecastOverrideRow } from "@flow/shared";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { readStoredCurrency } from "./company-currency";
import { expectedMonthsQueryOptions } from "./expected-months-query";
import { overridesQuery } from "./forecast-overrides-query";
import { useHomePreview } from "./preview";
import { QUERY_STALE_MS } from "./query-client";
import { readyClient } from "./ready-client";
import { unpaidQueryOptions } from "./use-books";

/**
 * FLOW-141: the month-end forecast's data. Four reads (expected months, open invoices, the month's overrides and,
 * FLOW-1005, the projects' forecast edits of the month) go through the shared builder. FLOW-1008: Home's forecast
 * row and the תזרים צפוי screen read this same query, so they show one number. It sits apart from the screen's
 * writes (forecast-month.ts), and the builder loads with its reads, so neither is in Home's entry. FLOW-1019: the
 * open invoices come from Home's own unpaid query (one read of list_unpaid), and Home starts this query only once
 * it has drawn its figures.
 */

export type MonthForecast = {
  month: string;
  /** The company's currency (0147): the forecast counts its items and its cash. */
  base: string;
  build: ForecastBuild;
  overrides: ForecastOverrideRow[];
};

export function useMonthForecastQuery(month: string, active = true) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["month-forecast", preview, month],
    enabled: active && preview === "off",
    queryFn: async ({ client }: { client: QueryClient }): Promise<MonthForecast> => {
      const supabase = await readyClient();
      const [expected, rows, current, edits, base] = await Promise.all([
        // The company's expected months, shared with the profit page's next month (FLOW-1171): one request.
        client.query({ ...expectedMonthsQueryOptions(preview), staleTime: QUERY_STALE_MS }),
        // Home's own read when it is fresh or under way, so list_unpaid goes out once.
        client.query({ ...unpaidQueryOptions(preview), staleTime: QUERY_STALE_MS }),
        // The month's overrides, shared with the project page and the recurring screen (FLOW-1191): one request.
        client.query({ ...overridesQuery(month, preview, true), staleTime: QUERY_STALE_MS }),
        supabase.rpc("company_forecast_edits_for", { p_month: month }),
        // A failed read fails the forecast: counting a dollar company in shekels would show nothing due.
        readStoredCurrency(),
      ]);
      if (edits.error) throw edits.error;
      const { buildMonthForecast, parseMonthEdits } = await import("./month-forecast-build");
      const projectEdits = parseMonthEdits(edits.data);
      return {
        month,
        base,
        overrides: current,
        build: buildMonthForecast({
          base,
          expected,
          unpaid: rows,
          overrides: current,
          edits: projectEdits.edits,
          overheadProjectId: projectEdits.overheadProjectId,
        }),
      };
    },
  });
}
