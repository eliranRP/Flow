import type { CompanyNextMonth } from "./company-next-month";
import type { ScheduleRow } from "./recurring-schedule";

/**
 * FLOW-1096: the forecast item keys of the screens that load on demand (a month to come, a project's צפי page),
 * kept out of forecast-skip.ts, which Home's entry loads.
 */

/**
 * FLOW-1079: a month to come's recurring row as its forecast item, which a swipe takes out of that month only: the
 * party's key, with the part's project when the party is split (decision 0185). FLOW-1096: split as the month
 * forecast splits it (`splitKeys`, more than one charge in the currency), so this month, the months to come and a
 * project's צפי page give a charge one key; a forecast without them (an older sample) counts the month's parts.
 */
export function futureForecastKey(forecast: Pick<CompanyNextMonth, "parts" | "splitKeys">, currency: string): (rowKey: string, projectId: string | null) => string | undefined {
  const recParts = new Map<string, number>();
  if (forecast.splitKeys == null) {
    for (const part of forecast.parts) {
      for (const row of [...part.forecast.rows, ...part.forecast.removed, ...(part.forecast.skipped ?? [])]) {
        if (row.key.startsWith("rec:")) recParts.set(row.key, (recParts.get(row.key) ?? 0) + 1);
      }
    }
  }
  return (rowKey, projectId) => {
    const [kind, direction, party] = rowKey.split(":");
    if (kind !== "rec" || direction == null || party == null) return undefined;
    const base = `party:${direction}:${party}:${currency}`;
    const split = forecast.splitKeys == null ? (recParts.get(rowKey) ?? 0) > 1 : forecast.splitKeys.has(base);
    return split ? `${base}:${projectId ?? "none"}` : base;
  };
}

/**
 * FLOW-1081: a project צפי page's recurring row (`rec:<direction>:<party>`) as its forecast item: the party's key, with
 * the charge's project when the party has another charge in the same currency (the company schedule says so).
 */
export function projectRowForecastKey(rowKey: string, schedule: readonly ScheduleRow[], projectId: string, general: boolean, currency: string): string | undefined {
  const [kind, direction, party] = rowKey.split(":");
  if (kind !== "rec" || direction == null || party == null) return undefined;
  const base = `party:${direction}:${party}:${currency}`;
  const charges = schedule.filter((row) => row.direction === direction && row.party_id === party && row.currency === currency);
  if (charges.length <= 1) return base;
  if (!general) return `${base}:${projectId}`;
  const own = charges.find((row) => row.project_id == null || row.project_id === projectId);
  return `${base}:${own?.project_id ?? "none"}`;
}
