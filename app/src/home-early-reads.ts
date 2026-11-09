import type { QueryClient } from "@tanstack/react-query";
import { CASH_MONTHS } from "./cash";
import { getSupabase } from "./lib/supabase";
import { defaultPeriod } from "./period";
import { dashboardQueryOptions } from "./use-books";
import { cashMonthsQueryOptions } from "./use-cash";

/**
 * FLOW-1115: a cold start on Home sends the two reads its figures wait on (the four cash months and the
 * P&L) before React draws the first frame, instead of once Home mounts. On the FLOW-804 phone the first
 * render takes about half a second after the code arrives, and the reads waited for it. Home's queries
 * use the same keys, so they pick these reads up instead of sending their own. Only with a session (a
 * signed-out start reads nothing) and only on Home itself, not in a preview (`?preview=`).
 */
export function startHomeReads(client: QueryClient, location: { pathname: string; search: string }): void {
  if (location.pathname !== "/" || new URLSearchParams(location.search).has("preview")) return;
  const supabase = getSupabase();
  if (!supabase) return;
  void supabase.auth.getSession().then(({ data }) => {
    if (data.session == null) return;
    void client.prefetchQuery(cashMonthsQueryOptions("off", CASH_MONTHS));
    void client.prefetchQuery(dashboardQueryOptions("off", defaultPeriod()));
  }, () => undefined);
}
