import { MERCURY_PAGE_CAP, MERCURY_PAGE_LIMIT } from "./capabilities.ts";
import { decodeMercuryCursor } from "./client.ts";
import type { MercuryRepeatedPage } from "./machines.ts";

/**
 * What mercury-sync keeps between runs in a connection's `settings` (FLOW-1162), beside
 * `own_counterparty_ids` and `pending_missing`. Pure: the function reads and writes the row.
 * Settings are per connection (slot), and a reconnect replaces them with `{}`.
 */

/** The `mercuryRepeatedPage` step, as a count of runs in a row: absent is `clear`, 3 is `stopped`. */
export const REPEATED_PAGE_KEY = "repeated_page_runs";
/**
 * The ids the partial runs of the window being resumed listed: `{ at, start, ids }`, the window's
 * `at` and `start` as its resume cursor holds them. `ids: null` marks a window whose list went over
 * the cap. Ids only: no amount, name or account number.
 */
export const RESUME_LISTED_KEY = "resume_listed";
/** One capped listing's worth: MERCURY_PAGE_CAP pages of MERCURY_PAGE_LIMIT lines (2,000 ids). */
export const RESUME_LISTED_CAP = MERCURY_PAGE_CAP * MERCURY_PAGE_LIMIT;

const STEPS: readonly MercuryRepeatedPage[] = ["clear", "once", "twice", "stopped"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function without(settings: Record<string, unknown>, key: string): Record<string, unknown> {
  const rest = { ...settings };
  delete rest[key];
  return rest;
}

/** The step the settings hold. A missing or malformed count is `clear`; past 3 is still `stopped`. */
export function repeatedPageState(settings: Record<string, unknown>): MercuryRepeatedPage {
  const runs = settings[REPEATED_PAGE_KEY];
  if (typeof runs !== "number" || !Number.isInteger(runs) || runs <= 0) return "clear";
  return STEPS[Math.min(runs, STEPS.length - 1)] ?? "stopped";
}

/**
 * How a run that ended with this failure code moves the step; null is a run that did not fail. A
 * page cap that fails the run is one that cannot resume, which is Mercury sending a page token twice
 * (a cap with a token resumes and does not fail).
 */
export function repeatedPageEvent(code: string | null): "repeated" | "other" {
  return code === "sync_page_cap" ? "repeated" : "other";
}

/**
 * Whether a run skips this connection: `stopped` stops the drain, forced or not, and an unforced
 * run. Only the owner's own forced refresh (not drained) runs it, so the sync stops retrying by
 * itself while the owner can still try.
 */
export function repeatedPageSkips(settings: Record<string, unknown>, run: { force: boolean; drained: boolean }): boolean {
  return repeatedPageState(settings) === "stopped" && !(run.force && !run.drained);
}

/** The settings holding `state`: the count, or no key once it is `clear`. */
export function withRepeatedPage(settings: Record<string, unknown>, state: MercuryRepeatedPage): Record<string, unknown> {
  const rest = without(settings, REPEATED_PAGE_KEY);
  return state === "clear" ? rest : { ...rest, [REPEATED_PAGE_KEY]: STEPS.indexOf(state) };
}

/**
 * The window a cursor is in the middle of: a resume cursor's `at` (when the window opened) and
 * `start`. Null for a finished sync's timestamp, a cleared cursor, or anything without a page token.
 */
function resumeWindow(cursor: string | null): { at: string; start: string | null } | null {
  const decoded = decodeMercuryCursor(cursor);
  if (decoded.page == null || decoded.at == null) return null;
  return { at: decoded.at, start: decoded.start };
}

/**
 * The ids earlier partial runs of the window `cursor` resumes listed. None when the cursor is not a
 * resume, or the stored list belongs to another window (the cursor was reset, re-read or finished
 * since), or the list is malformed or over the cap: then the run rechecks as it did before.
 */
export function listedEarlier(settings: Record<string, unknown>, cursor: string | null): string[] {
  const window = resumeWindow(cursor);
  if (window == null) return [];
  const stored = sameWindow(settings, window);
  return stored === "over" ? [] : stored;
}

/** The stored ids of this window; `over` when the window's list went over the cap or is malformed. */
function sameWindow(settings: Record<string, unknown>, window: { at: string; start: string | null }): string[] | "over" {
  const stored = settings[RESUME_LISTED_KEY];
  if (!isRecord(stored) || stored.at !== window.at || (stored.start ?? null) !== window.start) return [];
  if (!Array.isArray(stored.ids) || stored.ids.length > RESUME_LISTED_CAP) return "over";
  const ids = stored.ids.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 128);
  return ids.length === stored.ids.length ? ids : "over";
}

/**
 * The settings after a run that committed its lines and cursor. A complete fetch drops the list (its
 * rechecks used it). An incomplete one stores what it listed, merged with the list of the same window,
 * keyed to the window its next cursor resumes; over the cap the list is dropped, not cut, so the run
 * that finishes rechecks as it did before.
 */
export function withResumeListed(
  settings: Record<string, unknown>,
  run: { complete: boolean; nextCursor: string | null; listed: readonly string[] },
): Record<string, unknown> {
  const rest = without(settings, RESUME_LISTED_KEY);
  if (run.complete) return rest;
  const window = resumeWindow(run.nextCursor);
  if (window == null) return rest;
  const stored = sameWindow(settings, window);
  // A window whose list went over the cap stays without one: a later partial run does not start a
  // list that leaves out what the earlier ones listed.
  if (stored === "over") return { ...rest, [RESUME_LISTED_KEY]: { at: window.at, start: window.start, ids: null } };
  const ids = [...new Set([...stored, ...run.listed])].sort();
  if (ids.length > RESUME_LISTED_CAP) return { ...rest, [RESUME_LISTED_KEY]: { at: window.at, start: window.start, ids: null } };
  if (ids.length === 0) return rest;
  return { ...rest, [RESUME_LISTED_KEY]: { at: window.at, start: window.start, ids } };
}
