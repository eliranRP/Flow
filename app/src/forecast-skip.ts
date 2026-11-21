import type { ForecastOverrideRow, MissingBill } from "@flow/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { priorPatch, useSetForecastItem } from "./forecast-month";
import { useCompanyCurrency } from "./company-currency";
import { useMissingBillsQuery } from "./forecast";
import { overridesQuery } from "./forecast-overrides-query";
import { useHomePreview } from "./preview";
import type { ScheduleRow } from "./recurring-schedule";
import { israelToday } from "./ui/date-math";
import { useToast } from "./ui/toast";
import { topToast } from "./ui/top-toast";

/**
 * FLOW-1079: a recurring charge taken out of one month's forecast ("לא צפוי בנובמבר"). It is the month forecast's own
 * "לא החודש" (set_forecast_item with moved_out, decision 0182's per-month override), written from the charge's page
 * and from Home's נותר לשלם, so Home's band, the צפי page and the list agree.
 */

/** The forecast item's key for a schedule row: `party:<direction>:<party>:<currency>`, with `:<project|none>` when split. */
export function forecastKeyOf(row: Pick<ScheduleRow, "direction" | "party_id" | "currency" | "project_id">, split: boolean): string {
  const base = `party:${row.direction}:${row.party_id}:${row.currency}`;
  return split ? `${base}:${row.project_id ?? "none"}` : base;
}

/**
 * A schedule row's forecast item key, as the month forecast keys it: none for a charge in another currency than the
 * forecast's (it was never counted), split by project when the party has another charge in the same currency.
 */
export function scheduleForecastKey(schedule: readonly ScheduleRow[], item: ScheduleRow, base: string | null): string | undefined {
  if (base != null && item.currency !== base) return undefined;
  const split = schedule.filter((other) => other.direction === item.direction && other.party_id === item.party_id && other.currency === item.currency).length > 1;
  return forecastKeyOf(item, split);
}

/**
 * FLOW-1248: whether a late charge (`missing_bills`) is taken out of this month's forecast, so it is quiet: not
 * counted, named or linked as late. A charge in another currency than the forecast's is never in it, so it cannot be
 * skipped. The row does not say whether its party is split by project (decision 0185: more than one charge in the
 * same currency), so it is skipped when either key the forecast could give it is: `party:<direction>:<party>:<currency>`
 * or that with `:<project|none>`. A row with no party id has no key and stays late.
 */
export function lateIsSkipped(bill: Pick<MissingBill, "direction" | "party_id" | "currency" | "project_id">, skipped: ReadonlySet<string>, base: string): boolean {
  if (bill.party_id == null || bill.currency !== base) return false;
  const row = { direction: bill.direction ?? "expense", party_id: bill.party_id, currency: bill.currency, project_id: bill.project_id ?? null };
  return skipped.has(forecastKeyOf(row, false)) || skipped.has(forecastKeyOf(row, true));
}

/** The late charges that are not taken out of this month's forecast. With no skips known, all of them. */
export function withoutSkippedLate(bills: readonly MissingBill[], skipped: ReadonlySet<string> | undefined, base: string): MissingBill[] {
  return skipped == null || skipped.size === 0 ? [...bills] : bills.filter((bill) => !lateIsSkipped(bill, skipped, base));
}

/**
 * FLOW-1248 ("skipped means quiet", the owner, 2026-11-21): `missing_bills` without the charges taken out of this
 * month's forecast (Israel's month, decision 0182). Home and the project page read late charges from it. While the
 * overrides load or fail the list is whole: an error never hides an alert.
 */
export function useLateBillsQuery(active = true, overridesActive = active) {
  const bills = useMissingBillsQuery(active);
  const overrides = useForecastOverrides(israelToday().slice(0, 7), active && overridesActive);
  const base = useCompanyCurrency();
  const skipped = overrides.data == null ? undefined : skippedKeys(overrides.data);
  const data = bills.data == null ? undefined : withoutSkippedLate(bills.data, skipped, base);
  return { ...bills, data };
}

/** The keys of the month's items taken out of the forecast. */
export function skippedKeys(overrides: readonly ForecastOverrideRow[]): Set<string> {
  return new Set(overrides.filter((row) => row.moved_out).map((row) => row.item_key));
}

/**
 * A month's overrides alone (forecast_overrides_for), for a month the month forecast's own read does not cover: a
 * month to come on Home and the charge's page. Under "month-forecast", so the skip's write refreshes it.
 */
export function useForecastOverrides(month: string, enabled: boolean) {
  const preview = useHomePreview();
  return useQuery(overridesQuery(month, preview, enabled));
}

const PEEK_SEEN_KEY = "flow.skip-swipe-peek-seen";

/** Whether this phone has seen the one-time swipe hint on נותר לשלם (the owner, 2026-11-06). */
export function skipPeekSeen(): boolean {
  try {
    return window.localStorage.getItem(PEEK_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markSkipPeekSeen(): void {
  try {
    window.localStorage.setItem(PEEK_SEEN_KEY, "1");
  } catch {
    // Storage blocked: the hint may show again on the next visit.
  }
}

export type ForecastSkip = {
  /** The keys out of the month's forecast: the server's, with this page's last answers on top. */
  skipped: ReadonlySet<string>;
  /** Takes the item out (true) or puts it back (false); the toast offers ביטול. */
  set: (key: string, out: boolean, name: string) => void;
  busy: boolean;
};

/**
 * The month's skips and their write. `overrides` is the month forecast's read (null while it loads): an answer shows
 * at once and stays until the read after the write replaces it.
 */
export function useForecastSkip(month: string, monthLabel: string, overrides: readonly ForecastOverrideRow[] | null): ForecastSkip {
  const toast = useToast();
  const write = useSetForecastItem(month);
  const [local, setLocal] = useState<{ from: readonly ForecastOverrideRow[] | null; answers: Map<string, boolean> }>({ from: overrides, answers: new Map() });
  // A new read is the server's word: the local answers were for the read before it.
  const answers = local.from === overrides ? local.answers : new Map<string, boolean>();
  const skipped = new Set(skippedKeys(overrides ?? []));
  for (const [key, out] of answers) {
    if (out) skipped.add(key);
    else skipped.delete(key);
  }
  const answer = (key: string, out: boolean) => {
    setLocal((current) => {
      const next = new Map(current.from === overrides ? current.answers : []);
      next.set(key, out);
      return { from: overrides, answers: next };
    });
  };
  const set = (key: string, out: boolean, name: string) => {
    const prior = overrides?.find((row) => row.item_key === key) ?? null;
    const before = skipped.has(key);
    answer(key, out);
    // A failed write takes the answer back (its toast says so), so the row returns to where the forecast counts it.
    write.mutate({ key, patch: { moved_out: out }, undo: false, prior }, { onError: () => { answer(key, before); } });
    toast.show(topToast({
      message: out ? `${name} הוצא מהצפי של ${monthLabel}` : `${name} חזר לצפי של ${monthLabel}`,
      action: "ביטול",
      onAction: () => {
        answer(key, before);
        write.mutate({ key, patch: priorPatch(prior), undo: true, prior }, { onError: () => { answer(key, out); } });
      },
    }));
  };
  return { skipped, set, busy: write.isPending };
}
