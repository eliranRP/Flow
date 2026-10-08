import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { defaultPeriod, periodFromSearch, periodSearch, type PeriodChoice } from "./period";
import { useOptionalBooks } from "./use-books";

/** Each history entry remembers the period it showed, so Back from a line reopens the same window. */
const remembered = new Map<string, PeriodChoice>();
const REMEMBER_MAX = 50;

/** The first entry of a page load (and every Storybook router) is "default"; it is never remembered. */
const FIRST_ENTRY = "default";

function remember(key: string, period: PeriodChoice) {
  if (key === FIRST_ENTRY) return;
  remembered.delete(key);
  remembered.set(key, period);
  while (remembered.size > REMEMBER_MAX) {
    const oldest = remembered.keys().next().value;
    if (oldest == null) break;
    remembered.delete(oldest);
  }
}

/**
 * A project's own period (profit by period, plan §3, decision 0141). A fresh visit starts from
 * the URL's period (a month opened from "לפי חודש") or else Home's period. Changing it never
 * changes Home. Back to the same entry restores what it showed.
 */
export function useProjectPeriod(): [PeriodChoice, (period: PeriodChoice) => void] {
  const location = useLocation();
  const books = useOptionalBooks();
  const [period, setPeriod] = useState<PeriodChoice>(
    () => (location.key === FIRST_ENTRY ? undefined : remembered.get(location.key))
      ?? periodFromSearch(new URLSearchParams(location.search))
      ?? books?.period
      ?? defaultPeriod(),
  );
  useEffect(() => {
    remember(location.key, period);
  }, [location.key, period]);
  return [period, setPeriod];
}

/** The search string with the period added, keeping preview and the other params. */
export function withPeriodSearch(search: string, period: PeriodChoice): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  for (const key of ["period", "at", "from", "to"]) params.delete(key);
  for (const [key, value] of Object.entries(periodSearch(period))) params.set(key, value);
  return `?${params.toString()}`;
}

