import type { ProjectDetail } from "@flow/shared";
import { shownCompanyId, shownCompanyUser } from "./lib/company-header";

/**
 * FLOW-804: the last successful project reads, saved on the phone, so a project opened before
 * paints at once (a reload too) while its fresh read runs behind it. Through REST every read pays
 * a 150 to 500 ms floor plus 1 to 4 s spikes on the Micro database (accepted 2026-10-10), so a
 * repeat open must not wait for one. The saved reads belong to one user and one company: a read
 * for another company, another user or none is never shown, and sign-out drops them all (as the
 * saved role does, FLOW-603). A few projects only, and none too large to keep. The company
 * currency, which every project page reads, is saved beside them the same way.
 */
const STORAGE_KEY = "flow-project-reads";
const MAX_ENTRIES = 6;
const MAX_CHARS = 200_000;
const BIGINT = "$bigint";

type Entry = { key: string; at: number; json: string };
type Saved = { user: string; company: string; entries: Entry[]; currency?: { value: string; at: number } };
export type SavedProjectRead = { data: NonNullable<ProjectDetail>; at: number };

/** The parsed read with its bigints tagged, so JSON keeps them. */
function encode(data: NonNullable<ProjectDetail>): string {
  return JSON.stringify(data, (_key, value: unknown) => (typeof value === "bigint" ? { [BIGINT]: value.toString() } : value));
}

function decode(json: string): NonNullable<ProjectDetail> {
  return JSON.parse(json, (_key, value: unknown) => {
    if (typeof value === "object" && value != null && !Array.isArray(value)) {
      const tagged = (value as Record<string, unknown>)[BIGINT];
      if (typeof tagged === "string" && Object.keys(value).length === 1) return BigInt(tagged);
    }
    return value;
  }) as NonNullable<ProjectDetail>;
}

function isEntry(value: unknown): value is Entry {
  if (typeof value !== "object" || value == null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.key === "string" && typeof entry.at === "number" && typeof entry.json === "string";
}

function isCurrency(value: unknown): value is { value: string; at: number } {
  if (typeof value !== "object" || value == null) return false;
  const saved = value as Record<string, unknown>;
  return typeof saved.value === "string" && /^[A-Z]{3}$/.test(saved.value) && typeof saved.at === "number";
}

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed == null) return null;
    const { user, company, entries, currency } = parsed as Record<string, unknown>;
    if (typeof user !== "string" || typeof company !== "string" || !Array.isArray(entries)) return null;
    return { user, company, entries: entries.filter(isEntry), ...(isCurrency(currency) ? { currency } : {}) };
  } catch {
    return null;
  }
}

function drop(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // A private window can refuse the delete. Nothing reads another owner's reads.
  }
}

/** Who the reads may be shown to now: the signed-in user and the company the app shows. */
function owner(): { user: string; company: string } | null {
  const user = shownCompanyUser();
  const company = shownCompanyId();
  return user == null || company == null ? null : { user, company };
}

/** The saved read for this key, or null when there is none for the user and company shown. */
export function savedProjectRead(key: string): SavedProjectRead | null {
  const now = owner();
  if (now == null) return null;
  const saved = load();
  if (saved == null || saved.user !== now.user || saved.company !== now.company) return null;
  const entry = saved.entries.find((item) => item.key === key);
  if (entry == null) return null;
  try {
    return { data: decode(entry.json), at: entry.at };
  } catch {
    return null;
  }
}

/** The saved record when it is for the user and company shown now, else a fresh one for them. */
function current(now: { user: string; company: string }): Saved {
  const saved = load();
  return saved != null && saved.user === now.user && saved.company === now.company
    ? saved
    : { ...now, entries: [] };
}

function write(saved: Saved): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Storage full or refused: the page still reads the server, as before.
    drop();
  }
}

/** Saves a successful read, newest first; the oldest go once there are too many. */
export function saveProjectRead(key: string, data: NonNullable<ProjectDetail>, at = Date.now()): void {
  const now = owner();
  if (now == null) return;
  const json = encode(data);
  const saved = current(now);
  const kept = saved.entries.filter((item) => item.key !== key);
  // A project too large to keep is read each time, and its old copy is not shown either.
  const entries = json.length > MAX_CHARS ? kept : [{ key, at, json }, ...kept].slice(0, MAX_ENTRIES);
  write({ ...saved, entries });
}

/** The company currency (0147) last read for the user and company shown now, with its date. */
export function savedCompanyCurrency(): { value: string; at: number } | null {
  const now = owner();
  if (now == null) return null;
  const saved = load();
  if (saved == null || saved.user !== now.user || saved.company !== now.company) return null;
  return saved.currency ?? null;
}

/** Saves the company currency read, so the next visit's first screen does not wait for it. */
export function saveCompanyCurrency(value: string, at = Date.now()): void {
  const now = owner();
  if (now == null) return;
  write({ ...current(now), currency: { value, at } });
}

/** One session per device: a load with no user, or another one, keeps none of these reads. */
export function keepProjectReadsFor(userId: string | null): void {
  const saved = load();
  if (saved == null) return;
  if (userId == null || saved.user !== userId) drop();
}

/** Sign-out and a user switch drop every saved read. */
export function forgetProjectReads(): void {
  drop();
}
