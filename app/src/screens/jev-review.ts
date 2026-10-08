import { getSupabase } from "../lib/supabase";

export type JevField = { id: string; name: string };

export type JevPrefill = {
  suggestionId: string;
  transactionId: string;
  project: JevField | null;
  category: JevField | null;
};

export type JevReviewState = {
  connectorOn: boolean;
  prefill: JevPrefill | null;
};

export const JEV_REVIEW_OFF: JevReviewState = { connectorOn: false, prefill: null };

type JevRow = {
  transaction_id: string;
  direction?: "income" | "expense" | null;
  reason?: string | null;
  pnl_role?: string | null;
  share_count?: number | null;
  project_id: string | null;
  category_id: string | null;
  project_name?: string | null;
  category_name?: string | null;
  project_suggested?: boolean;
  category_suggested?: boolean;
  /** Set when the user owns the row. Absent on today's list_review payload. */
  user_assigned?: boolean;
  category_assigned?: boolean;
  project_assigned?: boolean;
};

/** Income has a project in review (decision 0091), so Jev may suggest one (decision 0133). */
function skipsProject(row: JevRow): boolean {
  return row.pnl_role === "shared"
    || row.pnl_role === "overhead"
    || (row.share_count ?? 0) > 1
    || row.reason === "unallocated_shared";
}

function userOwns(userAssigned: boolean | undefined, fieldAssigned: boolean | undefined): boolean {
  return userAssigned === true || fieldAssigned === true;
}

function projectOpen(row: JevRow): boolean {
  if (skipsProject(row)) return false;
  if (userOwns(row.user_assigned, row.project_assigned)) return false;
  if (row.project_id == null) return true;
  // A stored supplier rule stays. Only an existing suggestion is replaced.
  return row.project_suggested === true;
}

function categoryOpen(row: JevRow): boolean {
  if (userOwns(row.user_assigned, row.category_assigned)) return false;
  // An empty category is unset. list_review still returns category_suggested false.
  if (row.category_id == null) return true;
  // A stored supplier rule stays, even when both assignment flags are false.
  return row.category_suggested !== false;
}

export type JevShown = { project: boolean; category: boolean };

const JEV_SHOWN_NONE: JevShown = { project: false, category: false };

/**
 * Which fields of the stored row show Jev's value once `withJev` has run: the
 * connector is on, this line has a Jev answer for the field, and the field is
 * open (empty or a suggestion). A supplier rule, an owned field, and off are not.
 * A field the auto job already pre-filled with the same answer still counts.
 */
export function jevShown(row: JevRow, state: JevReviewState): JevShown {
  const prefill = state.connectorOn ? state.prefill : null;
  if (!prefill || prefill.transactionId !== row.transaction_id) return JEV_SHOWN_NONE;
  return {
    project: prefill.project != null && projectOpen(row),
    category: prefill.category != null && categoryOpen(row),
  };
}

/** Fills an empty or already-suggested field from Jev. An owned field stays. Off returns the same row. */
export function withJev<T extends JevRow>(row: T, state: JevReviewState): T & {
  project_suggested?: boolean;
  category_suggested?: boolean;
} {
  const prefill = state.connectorOn ? state.prefill : null;
  if (!prefill || prefill.transactionId !== row.transaction_id) return row;
  const project = projectOpen(row) ? prefill.project : null;
  const category = categoryOpen(row) ? prefill.category : null;
  const fillProject = project != null
    && !(row.project_id === project.id && row.project_name === project.name && row.project_suggested === true);
  const fillCategory = category != null
    && !(row.category_id === category.id && row.category_name === category.name && row.category_suggested === true);
  if (!fillProject && !fillCategory) return row;
  const next = { ...row };
  if (project != null && fillProject) {
    next.project_id = project.id;
    next.project_name = project.name;
    next.project_suggested = true;
  }
  if (category != null && fillCategory) {
    next.category_id = category.id;
    next.category_name = category.name;
    next.category_suggested = true;
  }
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readChoice(value: unknown, names: ReadonlyMap<string, string>): JevField | null {
  if (!isRecord(value)) return null;
  const choice = value.choice;
  const confidence = value.confidence;
  if (typeof choice !== "string") return null;
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  const name = names.get(choice);
  if (!name) return null;
  return { id: choice, name };
}

export function parseJevSuggestion(
  answers: unknown,
  suggestionId: string,
  transactionId: string,
  projects: ReadonlyMap<string, string>,
  categories: ReadonlyMap<string, string>,
): JevPrefill | null {
  if (!isRecord(answers)) return null;
  const project = readChoice(answers.project, projects);
  const category = readChoice(answers.category, categories);
  if (!project && !category) return null;
  return { suggestionId, transactionId, project, category };
}

type NameRow = { id: string; name: string; status?: string; hidden?: boolean };

function nameMap(rows: readonly NameRow[] | null, kind: "project" | "category"): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows ?? []) {
    if (kind === "project" && row.status === "finished") continue;
    if (kind === "category" && row.hidden === true) continue;
    if (row.name.trim() === "") continue;
    map.set(row.id, row.name);
  }
  return map;
}

export type JevQueueData = {
  connectorOn: boolean;
  /** Every requested id is present. Null means the connector is on and that line has no usable suggestion. */
  byId: Record<string, JevPrefill | null>;
};

export function jevReadable(): boolean {
  const supabase = getSupabase();
  return supabase != null && typeof supabase.from === "function";
}

/** Stable id list for the queue query, so a card does not start its own read. */
export function jevQueueKey(transactionIds: readonly string[]): string {
  return [...new Set(transactionIds.filter((id) => id !== ""))].sort().join("\0");
}

export function jevQueueQueryKey(transactionIds: readonly string[]) {
  return ["jev-review-queue", jevQueueKey(transactionIds)] as const;
}

/** Separate from the suggestion read, and scoped so the next user does not reuse this one's on. */
export function jevConnectorQueryKey(scope: JevConnectorScope | null = boundJevConnectorScope()) {
  return scope == null
    ? (["jev-connector"] as const)
    : (["jev-connector", scope.userId, scope.companyId] as const);
}

export const JEV_CONNECTOR_STALE_MS = 5 * 60 * 1000;

/** Survives a reload, so the next launch still knows whether to wait on the card. */
const JEV_CONNECTOR_FLAG = "flow.jev-connector";

export type JevConnectorScope = { userId: string; companyId: string };

/** One flag per signed-in user and company. The old device-wide key is not read. */
export function jevConnectorStorageKey(scope: JevConnectorScope): string {
  return `${JEV_CONNECTOR_FLAG}:${scope.userId}:${scope.companyId}`;
}

let activeScope: JevConnectorScope | null = null;

/** `undefined` until auth has reported. Null is a reported sign-out. */
let notedAuthUser: string | null | undefined;

export type JevScopePhase = "off" | "pending" | "ready" | "miss";

let scopePhase: JevScopePhase = "off";
/** A miss reads the connector without the remembered flag. A later company row may still bind. */
let followsLive = false;
let scopeGeneration = 0;
const scopeListeners = new Set<() => void>();

function emitScope(): void {
  for (const listener of scopeListeners) listener();
}

export function jevScopePhase(): JevScopePhase {
  return scopePhase;
}

export function jevScopeFollowsLive(): boolean {
  return followsLive;
}

export function notedJevAuthUser(): string | null | undefined {
  return notedAuthUser;
}

export function subscribeJevScope(listener: () => void): () => void {
  scopeListeners.add(listener);
  return () => {
    scopeListeners.delete(listener);
  };
}

export function noteJevAuthUser(userId: string | null): void {
  notedAuthUser = userId;
}

export type JevScopeLookup = {
  generation: number;
  userAtStart: string | null | undefined;
};

/** The card subscribes. The list does not wait on this. A ready scope survives a same-user refetch. */
export function beginJevScopeLookup(): JevScopeLookup {
  scopeGeneration += 1;
  const sameUser = activeScope != null && (notedAuthUser === undefined || notedAuthUser === activeScope.userId);
  if (scopePhase === "ready" && sameUser) {
    return { generation: scopeGeneration, userAtStart: notedAuthUser };
  }
  followsLive = false;
  scopePhase = "pending";
  emitScope();
  return { generation: scopeGeneration, userAtStart: notedAuthUser };
}

/**
 * Applies a finished lookup only when it is still the current one.
 * A miss stores no scope. A stale finish does not clear a newer one.
 */
export function completeJevScopeLookup(lookup: JevScopeLookup, scope: JevConnectorScope | null): boolean {
  if (lookup.generation !== scopeGeneration) return false;
  if (lookup.userAtStart !== undefined && notedAuthUser !== lookup.userAtStart) return false;
  const signedOut = notedAuthUser === null;
  const otherUser = scope != null && typeof notedAuthUser === "string" && scope.userId !== notedAuthUser;
  if (signedOut || otherUser) {
    activeScope = null;
    followsLive = false;
    scopePhase = "off";
    emitScope();
    return false;
  }
  if (scope == null && scopePhase === "ready" && activeScope != null && (notedAuthUser === undefined || notedAuthUser === activeScope.userId)) {
    return true;
  }
  if (scope == null) {
    if (followsLive && activeScope != null) return true;
    activeScope = null;
    followsLive = true;
    scopePhase = "miss";
    emitScope();
    return true;
  }
  activeScope = scope;
  if (!followsLive) scopePhase = "ready";
  emitScope();
  return true;
}

/** Sign-out and a user switch invalidate a lookup that is still in flight. */
export function dropJevConnectorForAuthChange(): void {
  activeScope = null;
  followsLive = false;
  scopeGeneration += 1;
  scopePhase = "off";
  emitScope();
}

/** Test isolation. A later finish from the previous case does not land. */
export function resetJevScopeMemory(): void {
  activeScope = null;
  notedAuthUser = undefined;
  followsLive = false;
  scopeGeneration += 1;
  scopePhase = "off";
  emitScope();
}

export function bindJevConnectorScope(scope: JevConnectorScope | null): void {
  activeScope = scope;
}

export function boundJevConnectorScope(): JevConnectorScope | null {
  return activeScope;
}

/** The pre-scope device-wide key. It is deleted and never read as the flag. */
export function dropLegacyJevConnectorKey(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(JEV_CONNECTOR_FLAG);
  } catch {
    // A private window can refuse the delete. The scoped key is the only flag.
  }
}

function companyIdFrom(data: unknown): string | null {
  if (data == null || typeof data !== "object" || !("company_id" in data)) return null;
  const id = data.company_id;
  return typeof id === "string" && id !== "" ? id : null;
}

/** `list_review` omits this today. A payload that includes it is the company. */
export function companyIdFromReviewPayload(data: unknown): string | null {
  if (!Array.isArray(data)) return companyIdFrom(data);
  for (const row of data) {
    const id = companyIdFrom(row);
    if (id) return id;
  }
  return null;
}

/** True when any company flag for this user is on. The check is synchronous. */
export function userRememberedJevOn(userId: string): boolean {
  if (userId === "" || typeof localStorage === "undefined") return false;
  const prefix = `${JEV_CONNECTOR_FLAG}:${userId}:`;
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key != null && key.startsWith(prefix) && localStorage.getItem(key) === "1") return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** The live read when the company is not known yet. Not the unscoped connector key. */
export function jevConnectorLiveKey(userId: string | null): readonly ["jev-connector", string, "session"] {
  return ["jev-connector", userId != null && userId !== "" ? userId : "session", "session"];
}

export function readJevConnectorFlag(scope: JevConnectorScope): boolean | undefined {
  dropLegacyJevConnectorKey();
  if (typeof localStorage === "undefined") return undefined;
  try {
    const raw = localStorage.getItem(jevConnectorStorageKey(scope));
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    return undefined;
  }
  return undefined;
}

export function writeJevConnectorFlag(on: boolean, scope: JevConnectorScope | null = activeScope): void {
  if (scope == null || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(jevConnectorStorageKey(scope), on ? "1" : "0");
  } catch {
    // A private window can refuse the write. The in-memory query still updates.
  }
}

/** Sign-out drops this user's flags and the old device-wide key. */
export function clearJevConnectorFlag(userId: string | null): void {
  dropJevConnectorForAuthChange();
  if (typeof localStorage === "undefined") return;
  try {
    const prefix = userId == null ? null : `${JEV_CONNECTOR_FLAG}:${userId}:`;
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key === JEV_CONNECTOR_FLAG || (prefix != null && key != null && key.startsWith(prefix))) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    // A private window can refuse the clear. The in-memory scope is already dropped.
  }
}

/** A hung read gives the card back. Longer than this, the card keeps today's values. */
export const JEV_READ_MS = 1000;

const JEV_OFF_QUEUE: JevQueueData = { connectorOn: false, byId: {} };

function abortError(reason?: unknown): Error {
  return reason instanceof Error ? reason : new DOMException("The operation was aborted.", "AbortError");
}

function signalled<T>(query: T, signal?: AbortSignal): T {
  if (signal == null || query == null || typeof query !== "object") return query;
  const candidate = query as { abortSignal?: (next: AbortSignal) => T };
  if (typeof candidate.abortSignal !== "function") return query;
  return candidate.abortSignal(signal);
}

/**
 * One second, no retry. A stall returns `fallback`. The caller's abort still rejects
 * so React Query can drop the read when the card unmounts.
 */
export function withJevDeadline<T>(
  caller: AbortSignal | undefined,
  work: (signal: AbortSignal) => Promise<T>,
  fallback: T,
): Promise<T> {
  if (caller?.aborted) return Promise.reject(abortError(caller.reason));
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, JEV_READ_MS);
  const onCaller = () => {
    controller.abort(caller?.reason);
  };
  caller?.addEventListener("abort", onCaller, { once: true });
  const attempt = work(controller.signal).then(
    (value) => {
      if (caller?.aborted) throw abortError(caller.reason);
      return value;
    },
    (error: unknown) => {
      if (caller?.aborted) throw abortError(error);
      if (controller.signal.aborted) return fallback;
      throw error;
    },
  );
  const deadline = new Promise<T>((resolve, reject) => {
    const settle = () => {
      if (caller?.aborted) reject(abortError(caller.reason));
      else resolve(fallback);
    };
    if (controller.signal.aborted) settle();
    else controller.signal.addEventListener("abort", settle, { once: true });
  });
  return Promise.race([attempt, deadline]).finally(() => {
    clearTimeout(timer);
    caller?.removeEventListener("abort", onCaller);
  });
}

export function jevConnectorOn(stored: { enabled?: boolean | null; mode?: string | null } | null | undefined): boolean {
  return stored?.enabled === true && (stored.mode === "shadow" || stored.mode === "auto");
}

export async function loadJevConnector(signal?: AbortSignal): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase || typeof supabase.from !== "function") return false;
  const integration = await signalled(
    supabase.from("company_integrations").select("enabled,mode").eq("provider", "jev"),
    signal,
  ).maybeSingle();
  if (integration.error) throw new Error(integration.error.message);
  return jevConnectorOn(integration.data);
}

/**
 * The one-second read. A completed read stores the flag. A timeout returns off
 * and leaves the stored flag alone, so it cannot overwrite an on that settings just wrote.
 */
export async function fetchJevConnector(signal?: AbortSignal): Promise<boolean> {
  return withJevDeadline(signal, async (linked) => {
    const on = await loadJevConnector(linked);
    writeJevConnectorFlag(on);
    return on;
  }, false);
}

/**
 * Ids per tag_suggestions read. Each id is about 40 characters of the `in` filter, so a queue of
 * hundreds in one URL passes the gateway's limit and the read is refused (400).
 */
export const JEV_SUGGESTION_CHUNK = 100;

export async function loadJevSuggestions(transactionIds: readonly string[], signal?: AbortSignal): Promise<JevQueueData> {
  const supabase = getSupabase();
  const ids = [...new Set(transactionIds.filter((id) => id !== ""))];
  if (!supabase || typeof supabase.from !== "function" || ids.length === 0) return { connectorOn: true, byId: {} };
  const chunks: string[][] = [];
  for (let start = 0; start < ids.length; start += JEV_SUGGESTION_CHUNK) {
    chunks.push(ids.slice(start, start + JEV_SUGGESTION_CHUNK));
  }
  const reads = await Promise.all(chunks.map((chunk) => signalled(
    supabase.from("tag_suggestions").select("id,transaction_id,answers").in("transaction_id", chunk).order("created_at", { ascending: false }),
    signal,
  )));
  const newest = new Map<string, { id: string; transaction_id: string; answers: unknown }>();
  for (const suggestions of reads) {
    if (suggestions.error) throw new Error(suggestions.error.message);
    // A transaction's rows all come back in its own chunk, newest first.
    for (const row of suggestions.data) {
      if (!newest.has(row.transaction_id)) newest.set(row.transaction_id, row);
    }
  }
  const [projects, categories] = await Promise.all([
    signalled(supabase.from("projects").select("id,name,status"), signal),
    signalled(supabase.from("categories").select("id,name,hidden"), signal),
  ]);
  if (projects.error) throw new Error(projects.error.message);
  if (categories.error) throw new Error(categories.error.message);
  const projectNames = nameMap(projects.data, "project");
  const categoryNames = nameMap(categories.data, "category");
  const byId: Record<string, JevPrefill | null> = {};
  for (const id of ids) {
    const row = newest.get(id);
    byId[id] = row
      ? parseJevSuggestion(row.answers, row.id, row.transaction_id, projectNames, categoryNames)
      : null;
  }
  return { connectorOn: true, byId };
}

export async function loadJevQueue(transactionIds: readonly string[], signal?: AbortSignal): Promise<JevQueueData> {
  const connectorOn = await loadJevConnector(signal);
  if (!connectorOn) return JEV_OFF_QUEUE;
  return loadJevSuggestions(transactionIds, signal);
}

export async function loadJevReview(transactionId: string, signal?: AbortSignal): Promise<JevReviewState> {
  const queue = await loadJevQueue([transactionId], signal);
  return {
    connectorOn: queue.connectorOn,
    prefill: queue.byId[transactionId] ?? null,
  };
}
