import { assertMercuryGet } from "./guard.ts";
import {
  MERCURY_PAGE_CAP,
  MERCURY_PAGE_LIMIT,
  MERCURY_PENDING_VOID_DAYS,
} from "./capabilities.ts";
import { addCalendarDays, jerusalemDate } from "./dates.ts";
import { redactMercury } from "./redact.ts";
import { isVoidMercuryStatus } from "./rules.ts";
import type {
  AccountLabel,
  ClassifiedError,
  ConnectorErrorClass,
  ConnectorSession,
  FetchSinceInput,
  FetchSinceResult,
  ValidateResult,
} from "../types.ts";

const API_BASE = "https://api.mercury.com/api/v1";

export class MercuryRequestError extends Error {
  readonly errorClass: ConnectorErrorClass;
  readonly retryAfter: string | null;
  readonly status: number | null;
  readonly code: string;

  constructor(
    errorClass: ConnectorErrorClass,
    message: string,
    retryAfter: string | null = null,
    status: number | null = null,
    code = errorClass,
  ) {
    super(message);
    this.name = "MercuryRequestError";
    this.errorClass = errorClass;
    this.retryAfter = retryAfter;
    this.status = status;
    this.code = code;
  }
}

export class MercuryPageCapError extends Error {
  readonly code = "sync_page_cap";

  /**
   * TODO(PR2): a first sync that passes MERCURY_PAGE_CAP does not resume.
   * This error carries no start_after. The run rejects before nextCursor
   * moves, so the next run repeats the same pages and hits the cap again.
   * The engine must persist the last nextPage and continue from it.
   */
  constructor() {
    super("sync_page_cap");
    this.name = "MercuryPageCapError";
  }
}

interface SessionState {
  secret: string;
  fetch: typeof fetch;
  now: () => Date;
}

const SESSIONS = new WeakMap<object, SessionState>();

export interface MercuryDeps {
  fetch?: typeof fetch;
  now?: () => Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function openMercury(secret: string, deps: MercuryDeps = {}): ConnectorSession {
  const session = { provider: "mercury" } as ConnectorSession;
  SESSIONS.set(session, {
    secret: typeof secret === "string" ? secret : "",
    fetch: deps.fetch ?? fetch,
    now: deps.now ?? (() => new Date()),
  });
  return session;
}

function stateOf(session: ConnectorSession): SessionState {
  const state = SESSIONS.get(session);
  if (!state) throw new MercuryRequestError("rejected", "rejected", null, null, "rejected");
  return state;
}

export function classifyMercuryError(error: unknown): ClassifiedError {
  if (error instanceof MercuryPageCapError) return { class: "rejected", retry_after: null };
  if (error instanceof MercuryRequestError) {
    return { class: error.errorClass, retry_after: error.retryAfter };
  }
  if (error instanceof Error && (
    error.message === "mercury_method" ||
    error.message === "mercury_path" ||
    error.message === "mercury_lookback" ||
    error.message === "mercury_card_account_missing"
  )) {
    return { class: "rejected", retry_after: null };
  }
  return { class: "transient", retry_after: null };
}

export function mercuryFailureCode(error: unknown): string {
  if (error instanceof MercuryPageCapError) return error.code;
  if (error instanceof MercuryRequestError) return error.code;
  return classifyMercuryError(error).class;
}

/** Retry-After is either delta-seconds or an HTTP date. The result is an ISO timestamp. */
export function retryAfterToIso(header: string | null, now: Date): string | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isSafeInteger(seconds)) return null;
    return new Date(now.getTime() + seconds * 1000).toISOString();
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function classForStatus(status: number): { errorClass: ConnectorErrorClass; code: ConnectorErrorClass } {
  if (status === 401 || status === 403) return { errorClass: "auth", code: "auth" };
  if (status === 429) return { errorClass: "rate_limited", code: "rate_limited" };
  if (status >= 500 && status <= 599) return { errorClass: "transient", code: "transient" };
  return { errorClass: "rejected", code: "rejected" };
}

async function mercuryGet(
  session: ConnectorSession,
  path: string,
  query: Record<string, string | undefined>,
): Promise<unknown> {
  assertMercuryGet("GET", path);
  const state = stateOf(session);
  if (state.secret.trim() === "") {
    throw new MercuryRequestError("auth", "auth", null, 401, "auth");
  }
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value) url.searchParams.set(key, value);
  }
  let response: Response;
  try {
    response = await state.fetch(url, {
      method: "GET",
      redirect: "error",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${state.secret}`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "network";
    const redirect = /redirect/i.test(message);
    throw new MercuryRequestError(
      redirect ? "rejected" : "transient",
      String(redactMercury(message, state.secret)),
      null,
      null,
      redirect ? "rejected" : "transient",
    );
  }
  if (!response.ok) {
    const body = await response.text();
    const mapped = classForStatus(response.status);
    const retry = mapped.errorClass === "rate_limited"
      ? retryAfterToIso(response.headers.get("retry-after"), state.now())
      : null;
    throw new MercuryRequestError(
      mapped.errorClass,
      String(redactMercury(body.slice(0, 500), state.secret)),
      retry,
      response.status,
      mapped.code,
    );
  }
  try {
    return await response.json();
  } catch (error) {
    const message = error instanceof Error ? error.message : "bad json";
    throw new MercuryRequestError("rejected", String(redactMercury(message, state.secret)), null, response.status, "rejected");
  }
}

async function listCollection(
  session: ConnectorSession,
  path: string,
  collectionKey: string,
  query: Record<string, string | undefined>,
  requireArray = false,
): Promise<unknown[]> {
  const rows: unknown[] = [];
  const seen = new Set<string>();
  let startAfter: string | undefined;
  for (let page = 0; page < MERCURY_PAGE_CAP; page += 1) {
    const body = await mercuryGet(session, path, {
      ...query,
      limit: String(MERCURY_PAGE_LIMIT),
      order: "desc",
      start_after: startAfter,
    });
    if (!isRecord(body)) throw new MercuryRequestError("rejected", "rejected", null, null, "rejected");
    const list = body[collectionKey];
    if (requireArray && !Array.isArray(list)) {
      throw new MercuryRequestError("rejected", "rejected", null, null, "rejected");
    }
    const items = Array.isArray(list) ? list : [];
    rows.push(...items);
    const pageInfo = isRecord(body.page) ? body.page : {};
    const next = typeof pageInfo.nextPage === "string" && pageInfo.nextPage.length > 0 ? pageInfo.nextPage : null;
    if (!next || items.length === 0) return rows;
    if (seen.has(next)) throw new MercuryPageCapError();
    seen.add(next);
    startAfter = next;
  }
  throw new MercuryPageCapError();
}

function accountLabel(row: unknown, fallback: string): AccountLabel | null {
  if (!isRecord(row) || typeof row.id !== "string") return null;
  const id = row.id.trim();
  if (id.length === 0 || id.length > 128) return null;
  const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : fallback;
  return { id, label: String(redactMercury(name)).slice(0, 300) };
}

/**
 * Connected account ids. `/treasury` is required.
 * A failed or unreadable GET refuses validation, so a sync never starts
 * without the treasury account ids. Starting anyway would import a
 * liquidation into checking as income and a deposit into Treasury as an
 * expense. An empty `accounts` array is a successful "no treasury account".
 */
export async function validateMercury(session: ConnectorSession): Promise<ValidateResult> {
  try {
    const accounts = await listCollection(session, "/accounts", "accounts", {});
    const creditBody = await mercuryGet(session, "/credit", {});
    if (!isRecord(creditBody) || !Array.isArray(creditBody.accounts)) {
      throw new MercuryRequestError("rejected", "rejected", null, null, "rejected");
    }
    const treasury = await listCollection(session, "/treasury", "accounts", {}, true);
    const labels: AccountLabel[] = [];
    const seen = new Set<string>();
    for (const row of [...accounts, ...creditBody.accounts.map((account) => {
      if (isRecord(account) && typeof account.name !== "string") {
        return { ...account, name: "Mercury Credit" };
      }
      return account;
    }), ...treasury.map((account) => {
      if (isRecord(account) && typeof account.name !== "string") {
        return { ...account, name: "Mercury Treasury" };
      }
      return account;
    })]) {
      const label = accountLabel(row, "Mercury");
      if (!label || seen.has(label.id)) continue;
      seen.add(label.id);
      labels.push(label);
    }
    return { ok: true, accounts: labels };
  } catch (error) {
    return { ok: false, ...classifyMercuryError(error) };
  }
}

export function timestampFromCursor(cursor: string | null): string | null {
  if (!cursor) return null;
  if (!/^\d{4}-\d{2}-\d{2}(?:T|\s|$)/.test(cursor)) return null;
  const time = new Date(cursor).getTime();
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString();
}

/**
 * Start of the posted lookback. Null means מההתחלה (no start query).
 * A later sync uses lastSync minus lookbackDays, and never starts before importFrom.
 *
 * TODO(PR2): a reversal more than MERCURY_POSTED_LOOKBACK_DAYS after the
 * original post is outside this window. This fetch does not return that
 * line, so the stored row stays posted. The engine must void it from a
 * status recheck. Widening this date is not that fix.
 */
export function mercuryStartDate(input: {
  lastSyncAt: string | null;
  importFrom: string | null;
  lookbackDays: number;
}): string | null {
  if (!Number.isInteger(input.lookbackDays) || input.lookbackDays < 0) throw new Error("mercury_lookback");
  if (input.lastSyncAt == null) return input.importFrom;
  const looked = addCalendarDays(jerusalemDate(input.lastSyncAt), -input.lookbackDays);
  if (input.importFrom == null) return looked;
  return looked > input.importFrom ? looked : input.importFrom;
}

function withinImport(row: unknown, importFrom: string | null): boolean {
  if (!importFrom) return true;
  if (!isRecord(row) || typeof row.createdAt !== "string") return true;
  try {
    return jerusalemDate(row.createdAt) >= importFrom;
  } catch {
    return true;
  }
}

function dedupe(rows: unknown[]): unknown[] {
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const row of rows) {
    if (isRecord(row) && typeof row.id === "string") {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
    }
    out.push(row);
  }
  return out;
}

export async function fetchMercurySince(
  session: ConnectorSession,
  input: FetchSinceInput,
): Promise<FetchSinceResult> {
  const state = stateOf(session);
  const lastSyncAt = timestampFromCursor(input.cursor);
  const start = mercuryStartDate({
    lastSyncAt,
    importFrom: input.importFrom,
    lookbackDays: input.lookbackDays,
  });
  const windowRows = await listCollection(session, "/transactions", "transactions", {
    start: start ?? undefined,
  });
  const pendingRows = await listCollection(session, "/transactions", "transactions", {
    status: "pending",
  });
  const lines = dedupe([...windowRows, ...pendingRows]).filter((row) => withinImport(row, input.importFrom));
  const removedIds: string[] = [];
  for (const row of lines) {
    if (!isRecord(row) || typeof row.id !== "string" || typeof row.status !== "string") continue;
    if (isVoidMercuryStatus(row.status)) removedIds.push(row.id);
  }
  removedIds.sort();
  return {
    lines,
    removedIds,
    nextCursor: state.now().toISOString(),
    complete: true,
  };
}

export async function getMercuryTransaction(session: ConnectorSession, id: string): Promise<unknown | null> {
  if (id.length === 0 || id.includes("/")) {
    throw new MercuryRequestError("rejected", "rejected", null, null, "rejected");
  }
  try {
    return await mercuryGet(session, `/transaction/${id}`, {});
  } catch (error) {
    if (error instanceof MercuryRequestError && error.status === 404) return null;
    throw error;
  }
}

/** True once a missing pending line has been gone for MERCURY_PENDING_VOID_DAYS. A bad timestamp does not void. */
export function pendingAbsenceVoids(missingSince: string, now: Date): boolean {
  const missing = new Date(missingSince).getTime();
  if (Number.isNaN(missing)) return false;
  const limitMs = MERCURY_PENDING_VOID_DAYS * 24 * 60 * 60 * 1000;
  return now.getTime() - missing >= limitMs;
}

/**
 * A pending line that left the lookback is confirmed with GET /transaction/{id}.
 * 404 voids only after MERCURY_PENDING_VOID_DAYS. A returned line is an update.
 * A void status on that GET voids immediately.
 */
export async function recheckMissingPending(
  session: ConnectorSession,
  externalId: string,
  missingSince: string,
  now?: Date,
): Promise<{ action: "void" } | { action: "keep" } | { action: "update"; raw: unknown }> {
  const clock = now ?? stateOf(session).now();
  const raw = await getMercuryTransaction(session, externalId);
  if (raw == null) {
    return pendingAbsenceVoids(missingSince, clock) ? { action: "void" } : { action: "keep" };
  }
  const status = isRecord(raw) && typeof raw.status === "string" ? raw.status : "";
  if (isVoidMercuryStatus(status)) return { action: "void" };
  return { action: "update", raw };
}

/** Recorded HTTP 404. The fixture body is not a transaction. */
export function httpStatusVoids(status: number): boolean {
  return status === 404;
}
