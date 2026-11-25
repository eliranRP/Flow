import type { CategoryRow } from "@flow/shared";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { setProjectForecastPatch } from "./forecast-month";
import { useHomePreview } from "./preview";
import { projectForecastOf, type ProjectForecastRead } from "./project-forecast-map";
import { skippedKeysOf, withRowRemoved, withSkipsChanged } from "./project-forecast-patch";
import { readyClient } from "./ready-client";

/**
 * FLOW-1315 (plan FLOW-1275, slice 9): a project's forecast for one month, one read: `project_forecast` (FLOW-1309) with the day
 * (`israelToday()`) and, for a project whose figures are not in the company's currency, that currency (`null`: the company's, which
 * is what the database answers when it is not asked). It replaces
 * the six reads the project page's card, its צפי page and its edit page made and built from (the charges, the category months, the
 * edits, the overrides, the loans in get_project and the categories). The key is under "month-forecast", so a project's
 * edit and a finished sync refresh it as they refresh the month forecast; a skip patches it at the tap (below) and reads nothing (FLOW-1323).
 */

/** The query key: the project, the month, the day and the currency asked for ("company" when none is). The skip and edit writes find these by that shape. */
export function projectForecastKey(preview: string, projectId: string, month: string, today: string, currency: string | null) {
  return ["month-forecast", preview, "project", projectId, month, today, currency ?? "company"] as const;
}

export function projectForecastOptions(preview: string, projectId: string, month: string, today: string, currency: string | null) {
  return {
    queryKey: projectForecastKey(preview, projectId, month, today, currency),
    queryFn: async (): Promise<ProjectForecastRead | null> => {
      const supabase = await readyClient();
      const { data, error } = await supabase.rpc("project_forecast", { p_project: projectId, p_month: month, p_today: today, ...(currency == null ? {} : { p_currency: currency }) });
      if (error) throw error;
      return projectForecastOf(data, projectId);
    },
  };
}

export function useProjectForecast(projectId: string, month: string, today: string, currency: string | null, enabled: boolean) {
  const preview = useHomePreview();
  return useQuery({ ...projectForecastOptions(preview, projectId, month, today, currency), enabled: enabled && projectId !== "" && preview === "off" });
}

/** The project forecasts the client holds for a month (every project's, whichever is on screen), with their keys. */
function heldFor(client: QueryClient, month: string, projectId?: string) {
  return client.getQueryCache().findAll({ queryKey: ["month-forecast"], predicate: (query) => query.queryKey[2] === "project" && query.queryKey[4] === month && (projectId == null || query.queryKey[3] === projectId) });
}

/** The company's categories when the client holds them: the income note counts rent by them. */
function categoriesHeld(client: QueryClient, preview: unknown): readonly CategoryRow[] | undefined {
  return client.getQueryData<CategoryRow[]>(["categories", preview]);
}

/**
 * A skip, its undo or a reset (the month forecast's writes) moves the month's skips; each project forecast held for that month
 * follows at the tap with no read (FLOW-1214's rule for the company's inputs). Returns the undo, which takes out the keys this
 * change added and puts back the ones it took out, so a failed write leaves the forecast as the other writes left it.
 */
function patchSkips(client: QueryClient, month: string, change: (keys: readonly string[]) => readonly string[]): () => void {
  const touched: Array<{ key: readonly unknown[]; projectId: string; added: string[]; removed: string[] }> = [];
  for (const query of heldFor(client, month)) {
    const read = client.getQueryData<ProjectForecastRead | null>(query.queryKey);
    if (read == null) continue;
    const before = skippedKeysOf(read);
    const after = change(before);
    const added = after.filter((key) => !before.includes(key));
    const removed = before.filter((key) => !after.includes(key));
    if (added.length === 0 && removed.length === 0) continue;
    const projectId = String(query.queryKey[3]);
    client.setQueryData(query.queryKey, withSkipsChanged(read, projectId, { added, removed }, categoriesHeld(client, query.queryKey[1])));
    touched.push({ key: query.queryKey, projectId, added, removed });
  }
  return () => {
    for (const { key, projectId, added, removed } of touched) {
      const read = client.getQueryData<ProjectForecastRead | null>(key);
      if (read == null) continue;
      client.setQueryData(key, withSkipsChanged(read, projectId, { added: removed, removed: added }, categoriesHeld(client, key[1])));
    }
  };
}

// The project forecast's own patch joins the month forecast's writes when this module is loaded (with a project page; Home's
// entry carries only the setter). A project forecast held before it loaded (a kept one) is dropped by the skip (forecast-month.ts), so it is read fresh.
setProjectForecastPatch(patchSkips);

/**
 * The project page takes a row out of the month (remove_project_forecast_row): each forecast held for that project and month
 * loses the row at the tap (the write's `optimistic`, which puts it back if the write fails and reads again after it).
 */
export function removalUpdates(client: QueryClient, projectId: string, month: string, rowKey: string): Array<{ key: readonly unknown[]; update: (old: unknown) => unknown }> {
  return heldFor(client, month, projectId).map((query) => ({
    key: query.queryKey,
    update: (old: unknown) => (old == null ? old : withRowRemoved(old as ProjectForecastRead, rowKey, categoriesHeld(client, query.queryKey[1]))),
  }));
}

/**
 * A write of the project's edits can change any month from the one it starts in, so the forecasts of the project that no screen holds
 * are dropped (they load fresh next time and never show figures from before the write); the one on screen is read again by the write.
 */
export function dropInactiveForecasts(client: QueryClient, projectId: string): void {
  client.removeQueries({ queryKey: ["month-forecast"], type: "inactive", predicate: (query) => query.queryKey[2] === "project" && query.queryKey[3] === projectId });
}
