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
  CardLabel,
  ClassifiedError,
  ConnectorErrorClass,
  ConnectorSession,
  FetchSinceInput,
  FetchSinceResult,
  ValidateResult,
} from "../types.ts";

const API_BASE = "https://api.mercury.com/api/v1";
/** A card nickname is short in Mercury; 80 characters is plenty for a row. */
export const CARD_LABEL_LIMIT = 80;

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
  /** Lines already fetched on this collection. The engine upserts them when resumeAfter is set. */
  readonly lines: unknown[];
  /**
   * Next page token. Null when nextPage repeated: that is a loop, and the
   * engine must not resume it. A cap with a token is continued on the next run.
   */
  readonly resumeAfter: string | null;

  constructor(lines: unknown[] = [], resumeAfter: string | null = null) {
    super("sync_page_cap");
    this.name = "MercuryPageCapError";
    this.lines = lines;
    this.resumeAfter = resumeAfter;
  }
}

interface SessionState {
  secret: string;
  fetch: typeof fetch;
  now: () => Date;
  /** Treasury account ids this session listed, or null before the ledger read. */
  treasuryIds: string[] | null;
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
    treasuryIds: null,
  });
  return session;
}

/** How many treasury accounts this session's sync listed, or null when it has not listed them. */
export function mercuryTreasuryAccountCount(session: ConnectorSession): number | null {
  return SESSIONS.get(session)?.treasuryIds?.length ?? null;
}

function stateOf(session: ConnectorSession): SessionState {
  const state = SESSIONS.get(session);
  if (!state) throw new MercuryRequestError("rejected", "rejected", null, null, "rejected");
  return state;
}

export function classifyMercuryError(error: unknown): ClassifiedError {
  if (error instanceof MercuryPageCapError) {
    return { class: "rejected", retry_after: null, code: "sync_page_cap" };
  }
  if (error instanceof MercuryRequestError) {
    return { class: error.errorClass, retry_after: error.retryAfter, code: error.code };
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

const RATE_LIMIT_BACKOFF_MS = 15 * 60 * 1000;
const RATE_LIMIT_BACKOFF_MAX_MS = 24 * 60 * 60 * 1000;

/**
 * When to try again after a rate limit. Mercury's Retry-After when it is later
 * than now (capped at a day), else the 15 minutes note_connector_failure uses.
 */
export function backoffUntil(retryAfter: string | null, now: Date): string {
  const fallback = now.getTime() + RATE_LIMIT_BACKOFF_MS;
  const parsed = retryAfter ? Date.parse(retryAfter) : Number.NaN;
  const until = Number.isNaN(parsed) || parsed <= now.getTime()
    ? fallback
    : Math.min(parsed, now.getTime() + RATE_LIMIT_BACKOFF_MAX_MS);
  return new Date(until).toISOString();
}

/**
 * True when a reconnect returns a different set of account ids than the stored
 * labels. The stored cursor belongs to the old accounts, so the caller clears it
 * and the next sync reads from import_from again. No stored labels is a change.
 */
export function mercuryAccountsChanged(previous: unknown, next: readonly AccountLabel[]): boolean {
  if (!Array.isArray(previous)) return true;
  const before = new Set<string>();
  for (const row of previous) {
    if (isRecord(row) && typeof row.id === "string") before.add(row.id);
  }
  const after = new Set(next.map((account) => account.id));
  if (before.size !== after.size) return true;
  for (const id of after) if (!before.has(id)) return true;
  return false;
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
  let startAfter = query.start_after;
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
    if (seen.has(next)) throw new MercuryPageCapError(rows, null);
    seen.add(next);
    startAfter = next;
  }
  throw new MercuryPageCapError(rows, startAfter ?? null);
}

function accountLabel(row: unknown, fallback: string): AccountLabel | null {
  if (!isRecord(row) || typeof row.id !== "string") return null;
  const id = row.id.trim();
  if (id.length === 0 || id.length > 128 || id.includes("/")) return null;
  const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : fallback;
  return { id, label: String(redactMercury(name)).slice(0, 300) };
}

/** A treasury row with no usable id is a rejected validation, not a silent drop. The log has no payload. */
function requireTreasuryLabel(row: unknown): AccountLabel {
  const named = isRecord(row) && typeof row.name !== "string" ? { ...row, name: "Mercury Treasury" } : row;
  const label = accountLabel(named, "Mercury Treasury");
  if (!label) {
    console.error("mercury_treasury_account_id");
    throw new MercuryRequestError("rejected", "mercury_treasury_account_id", null, null, "rejected");
  }
  return label;
}

async function listTreasuryAccounts(session: ConnectorSession): Promise<unknown[]> {
  return await listCollection(session, "/treasury", "accounts", {}, true);
}

/**
 * The nickname of each card, keyed by its last 4 (FLOW-707). A card with no nickname is left
 * out, and a last 4 shared by two cards with different nicknames is left out, since a line
 * keeps only the last 4. Null when the list can't be read: the names are extra, so the sync
 * goes on and keeps the names it stored before.
 */
export async function listMercuryCardLabels(session: ConnectorSession): Promise<CardLabel[] | null> {
  let cards: unknown[];
  try {
    cards = await listCollection(session, "/cards", "cards", {}, true);
  } catch {
    return null;
  }
  const byLast4 = new Map<string, string | null>();
  for (const card of cards) {
    if (!isRecord(card)) continue;
    const last4 = typeof card.lastFour === "string" ? card.lastFour.trim() : "";
    const nickname = typeof card.nickname === "string" ? card.nickname.trim() : "";
    if (!/^[0-9]{4}$/.test(last4) || nickname === "") continue;
    const label = String(redactMercury(nickname)).trim().slice(0, CARD_LABEL_LIMIT);
    if (label === "") continue;
    const seen = byLast4.get(last4);
    if (seen === undefined) byLast4.set(last4, label);
    else if (seen !== label) byLast4.set(last4, null);
  }
  const labels: CardLabel[] = [];
  for (const [last4, label] of byLast4) {
    if (label != null) labels.push({ last4, label });
  }
  return labels.sort((left, right) => left.last4.localeCompare(right.last4));
}

/**
 * Connected account ids. `/accounts`, `/credit`, and `/treasury` are required.
 * A 403 or 404 on treasury refuses the sync. An empty accounts array is a
 * successful "no treasury account". A row with no id still refuses.
 */
export async function validateMercury(session: ConnectorSession): Promise<ValidateResult> {
  try {
    const accounts = await listCollection(session, "/accounts", "accounts", {});
    const creditBody = await mercuryGet(session, "/credit", {});
    if (!isRecord(creditBody) || !Array.isArray(creditBody.accounts)) {
      throw new MercuryRequestError("rejected", "rejected", null, null, "rejected");
    }
    const treasury = await listTreasuryAccounts(session);
    const treasuryLabels = treasury.map((account) => requireTreasuryLabel(account));
    const labels: AccountLabel[] = [];
    const seen = new Set<string>();
    for (const row of [...accounts, ...creditBody.accounts.map((account) => {
      if (isRecord(account) && typeof account.name !== "string") {
        return { ...account, name: "Mercury Credit" };
      }
      return account;
    })]) {
      const label = accountLabel(row, "Mercury");
      if (!label || seen.has(label.id)) continue;
      seen.add(label.id);
      labels.push(label);
    }
    for (const label of treasuryLabels) {
      if (seen.has(label.id)) continue;
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

export type MercuryCursorPhase = "window" | "pending" | "treasury";

export interface MercuryCursor {
  /** ISO time of the run that opened this window. Plain cursors use this as lastSyncAt. */
  at: string | null;
  /** The start query already sent. A resume repeats it so the page token stays on the same window. */
  start: string | null;
  page: string | null;
  phase: MercuryCursorPhase;
  treasuryId: string | null;
}

/**
 * A finished sync stores an ISO timestamp. A page cap stores JSON with the
 * same start date and the next page token. A bare page token would make
 * timestampFromCursor return null and the next run would restart the window.
 */
export function decodeMercuryCursor(cursor: string | null): MercuryCursor {
  const empty: MercuryCursor = { at: null, start: null, page: null, phase: "window", treasuryId: null };
  if (!cursor) return empty;
  if (cursor.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(cursor);
      if (!isRecord(parsed)) return empty;
      const phase: MercuryCursorPhase = parsed.phase === "pending" || parsed.phase === "treasury"
        ? parsed.phase
        : "window";
      const start = typeof parsed.start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.start) ? parsed.start : null;
      const page = typeof parsed.page === "string" && parsed.page.length > 0 ? parsed.page : null;
      const treasuryId = typeof parsed.treasuryId === "string" && parsed.treasuryId.length > 0 ? parsed.treasuryId : null;
      return {
        at: typeof parsed.at === "string" ? timestampFromCursor(parsed.at) : null,
        start,
        page,
        phase,
        treasuryId,
      };
    } catch {
      return empty;
    }
  }
  return { ...empty, at: timestampFromCursor(cursor) };
}

export function encodeMercuryResume(input: {
  at: string;
  start: string | null;
  page: string;
  phase: MercuryCursorPhase;
  treasuryId?: string | null;
}): string {
  return JSON.stringify({
    at: input.at,
    start: input.start,
    page: input.page,
    phase: input.phase,
    ...(input.treasuryId ? { treasuryId: input.treasuryId } : {}),
  });
}

/**
 * Start of the posted lookback. Null means מההתחלה (no start query).
 * A later sync uses lastSync minus lookbackDays, and never starts before importFrom.
 *
 * A reversal more than MERCURY_POSTED_LOOKBACK_DAYS after the original post
 * is outside this window. This date is not widened. The engine rechecks that
 * stored line with GET /transaction/{id} and voids it from the status.
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
  if (!isRecord(row)) return true;
  if (typeof row.canonicalDay === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.canonicalDay)) {
    return row.canonicalDay >= importFrom;
  }
  if (typeof row.createdAt !== "string") return true;
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

function removedFrom(lines: unknown[]): string[] {
  const removedIds: string[] = [];
  for (const row of lines) {
    if (!isRecord(row) || typeof row.id !== "string" || typeof row.status !== "string") continue;
    if (isVoidMercuryStatus(row.status)) removedIds.push(row.id);
  }
  removedIds.sort();
  return removedIds;
}

function resumeResult(
  lines: unknown[],
  at: string,
  start: string | null,
  page: string,
  phase: MercuryCursorPhase,
  treasuryId?: string | null,
): FetchSinceResult {
  return {
    lines,
    removedIds: removedFrom(lines),
    nextCursor: encodeMercuryResume({ at, start, page, phase, treasuryId }),
    complete: false,
    windowStart: start,
  };
}

function takePageCap(error: unknown, prior: unknown[], at: string, start: string | null, phase: MercuryCursorPhase, treasuryId?: string | null): FetchSinceResult {
  if (error instanceof MercuryPageCapError && error.resumeAfter) {
    return resumeResult([...prior, ...error.lines], at, start, error.resumeAfter, phase, treasuryId);
  }
  throw error;
}

function olderThan(row: unknown, start: string): boolean {
  return isRecord(row) && typeof row.canonicalDay === "string" && row.canonicalDay.slice(0, 10) < start;
}

/**
 * The ledger comes newest first. Paging stops after the first page that reaches a day before
 * the window start less TREASURY_CANCEL_MARGIN_DAYS, so a sync reads the window, not the
 * account's whole history (FLOW-509). A cancel can carry its original's day, so the margin keeps
 * a backdated cancel of a yield that old in the read; its original is in the stored lines.
 */
export const TREASURY_CANCEL_MARGIN_DAYS = 60;

async function listTreasuryTransactions(
  session: ConnectorSession,
  treasuryId: string,
  cursor: string | undefined,
  start: string | null,
): Promise<unknown[]> {
  const path = `/treasury/${treasuryId}/transactions`;
  const rows: unknown[] = [];
  const seen = new Set<string>();
  let pageCursor = cursor;
  for (let page = 0; page < MERCURY_PAGE_CAP; page += 1) {
    const body = await mercuryGet(session, path, {
      limit: String(MERCURY_PAGE_LIMIT),
      order: "desc",
      cursor: pageCursor,
    });
    if (!isRecord(body) || !Array.isArray(body.transactions)) {
      throw new MercuryRequestError("rejected", "rejected", null, null, "rejected");
    }
    rows.push(...body.transactions);
    const next = body.cursor;
    if (typeof next !== "number" && typeof next !== "string") return rows;
    if (start && body.transactions.some((row) => olderThan(row, start))) return rows;
    const token = String(next);
    if (token.length === 0 || (pageCursor != null && token === pageCursor) || seen.has(token)) {
      throw new MercuryPageCapError(rows, null);
    }
    seen.add(token);
    pageCursor = token;
  }
  throw new MercuryPageCapError(rows, pageCursor ?? null);
}

/**
 * Yield and dividends live on the treasury ledger, not on GET /transactions.
 * Deposit and withdrawal legs stay on that ledger too; normalize skips them
 * so they are not a second copy of a checking transfer.
 */
async function fetchTreasuryLedger(
  session: ConnectorSession,
  resumeId: string | null,
  resumeCursor: string | undefined,
  start: string | null,
): Promise<{ lines: unknown[]; resume: { treasuryId: string; page: string } | null }> {
  const accounts = await listTreasuryAccounts(session);
  const ids = accounts.map((account) => requireTreasuryLabel(account).id);
  stateOf(session).treasuryIds = ids;
  const startAt = resumeId && ids.includes(resumeId) ? ids.indexOf(resumeId) : 0;
  const lines: unknown[] = [];
  for (let index = startAt; index < ids.length; index += 1) {
    const treasuryId = ids[index];
    if (!treasuryId) continue;
    const cursor = index === startAt ? resumeCursor : undefined;
    try {
      lines.push(...await listTreasuryTransactions(session, treasuryId, cursor, start));
    } catch (error) {
      if (error instanceof MercuryPageCapError && error.resumeAfter) {
        return {
          lines: [...lines, ...error.lines],
          resume: { treasuryId, page: error.resumeAfter },
        };
      }
      throw error;
    }
  }
  return { lines, resume: null };
}

export async function fetchMercurySince(
  session: ConnectorSession,
  input: FetchSinceInput,
): Promise<FetchSinceResult> {
  const result = await fetchMercuryPages(session, input);
  if (result.complete || !input.importFrom) return result;
  // FLOW-505: a run that stops at the page cap keeps the import start too.
  const lines = result.lines.filter((row) => withinImport(row, input.importFrom));
  return { ...result, lines, removedIds: removedFrom(lines) };
}

async function fetchMercuryPages(
  session: ConnectorSession,
  input: FetchSinceInput,
): Promise<FetchSinceResult> {
  const state = stateOf(session);
  const decoded = decodeMercuryCursor(input.cursor);
  const at = decoded.at ?? state.now().toISOString();
  const start = decoded.page || decoded.phase !== "window"
    ? decoded.start
    : mercuryStartDate({
      lastSyncAt: decoded.at,
      importFrom: input.importFrom,
      lookbackDays: input.lookbackDays,
    });

  let windowRows: unknown[] = [];
  if (decoded.phase === "window") {
    try {
      windowRows = await listCollection(session, "/transactions", "transactions", {
        start: start ?? undefined,
        start_after: decoded.page ?? undefined,
      });
    } catch (error) {
      return takePageCap(error, [], at, start, "window");
    }
  }

  let pendingRows: unknown[] = [];
  if (decoded.phase !== "treasury") {
    try {
      pendingRows = await listCollection(session, "/transactions", "transactions", {
        status: "pending",
        start_after: decoded.phase === "pending" ? decoded.page ?? undefined : undefined,
      });
    } catch (error) {
      return takePageCap(error, windowRows, at, start, "pending");
    }
  }

  let treasuryRows: unknown[] = [];
  try {
    const ledger = await fetchTreasuryLedger(
      session,
      decoded.phase === "treasury" ? decoded.treasuryId : null,
      decoded.phase === "treasury" ? decoded.page ?? undefined : undefined,
      start ? addCalendarDays(start.slice(0, 10), -TREASURY_CANCEL_MARGIN_DAYS) : null,
    );
    treasuryRows = ledger.lines;
    if (ledger.resume) {
      return resumeResult(
        [...windowRows, ...pendingRows, ...treasuryRows],
        at,
        start,
        ledger.resume.page,
        "treasury",
        ledger.resume.treasuryId,
      );
    }
  } catch (error) {
    return takePageCap(error, [...windowRows, ...pendingRows], at, start, "treasury");
  }

  const lines = dedupe([...windowRows, ...pendingRows, ...treasuryRows]).filter((row) => withinImport(row, input.importFrom));
  return {
    lines,
    removedIds: removedFrom(lines),
    nextCursor: state.now().toISOString(),
    complete: true,
    windowStart: start,
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
