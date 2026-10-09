/**
 * FLOW-601 (decision 0167): the company the app shows, per user. Every PostgREST, RPC and edge
 * function call sends it as `x-flow-company`, so the server reads and writes that company (when
 * the user belongs to it) and two phones can show two companies at once. Kept in memory for the
 * fetch wrapper and in localStorage so a reload opens the same company. Only the signed-in
 * user's entry stays saved (FLOW-603: a shared device keeps none of another user's state).
 */
export const COMPANY_HEADER = "x-flow-company";

const STORAGE_KEY = "flow-shown-company";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Shown = { userId: string | null; companyId: string | null };

function readStored(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed == null) return {};
    const out: Record<string, string> = {};
    for (const [user, company] of Object.entries(parsed)) {
      if (typeof company === "string" && UUID.test(company)) out[user] = company;
    }
    return out;
  } catch {
    return {};
  }
}

function writeStored(entries: Record<string, string>): void {
  try {
    if (Object.keys(entries).length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // A private window can refuse storage. The memory copy still serves this visit.
  }
}

/** Before the session is known, the one saved entry (only the signed-in user's is kept) is the guess. */
function initialShown(): Shown {
  const entries = Object.entries(readStored());
  if (entries.length !== 1) return { userId: null, companyId: null };
  const [userId, companyId] = entries[0] ?? [null, null];
  return { userId, companyId };
}

let shown: Shown = initialShown();

/** The company id the next request names, or null for none (the server then uses the last one opened). */
export function shownCompanyId(): string | null {
  return shown.companyId;
}

/** The shown company for this user, or null when this user has none saved. */
export function shownCompanyFor(userId: string | null): string | null {
  if (userId == null) return null;
  if (shown.userId === userId) return shown.companyId;
  return readStored()[userId] ?? null;
}

/** Shows a company for this user from the next request on. Null sends no header. */
export function setShownCompany(userId: string, companyId: string | null): void {
  const valid = companyId != null && UUID.test(companyId) ? companyId : null;
  shown = { userId, companyId: valid };
  const others = Object.entries(readStored()).filter(([user]) => user !== userId);
  writeStored(Object.fromEntries(valid == null ? others : [...others, [userId, valid]]));
}

/**
 * The session changed: this user's saved company becomes the shown one, and every other
 * user's entry is dropped. Null (signed out) keeps nothing.
 */
export function noteShownCompanyUser(userId: string | null): void {
  const entries = readStored();
  const mine = userId == null ? null : (entries[userId] ?? null);
  shown = { userId, companyId: mine };
  writeStored(userId != null && mine != null ? { [userId]: mine } : {});
}

/** Only the API paths that read the company: PostgREST (tables and RPCs) and edge functions. Auth stays as it is. */
function namesCompany(url: string): boolean {
  return url.includes("/rest/v1/") || url.includes("/functions/v1/");
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** A fetch for supabase-js `global.fetch`: adds the shown company to API calls. */
export function withCompanyHeader(base?: typeof fetch): typeof fetch {
  return (input, init) => {
    const run = base ?? globalThis.fetch;
    const companyId = shownCompanyId();
    if (companyId == null || !namesCompany(urlOf(input))) return run(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set(COMPANY_HEADER, companyId);
    return run(input, { ...init, headers });
  };
}

/** Tests start from no shown company. */
export function resetShownCompanyForTests(): void {
  shown = { userId: null, companyId: null };
}
