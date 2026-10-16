import { SEARCH_MAX_LENGTH } from "../search";

/** The last searches a device typed (FLOW-368): three at most, newest first. */
export const RECENT_SEARCH_KEY = "flow.search.recent";
export const RECENT_SEARCH_MAX = 3;

/** The saved searches. Blocked or broken storage reads as no history, never as an error. */
export function readRecentSearches(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCH_KEY);
    const list: unknown = raw == null ? [] : JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter((item): item is string => typeof item === "string").slice(0, RECENT_SEARCH_MAX);
  } catch {
    return [];
  }
}

/** Puts a submitted search first, drops its older copy, and keeps the last three. */
export function rememberRecentSearch(text: string): string[] {
  const clean = text.trim().slice(0, SEARCH_MAX_LENGTH);
  const current = readRecentSearches();
  if (clean === "") return current;
  const next = [clean, ...current.filter((item) => item !== clean)].slice(0, RECENT_SEARCH_MAX);
  try {
    window.localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify(next));
  } catch {
    // Blocked storage: the list shows for this visit only.
  }
  return next;
}
