import { getSupabase } from "../lib/supabase";
import { isJevReasonKind, type JevReasonInfo, type ReviewFlag, type ReviewFlagKind } from "../review-copy";
import { writeJevConnectorFlag } from "./jev-connector-scope";

export {
  jevConnectorQueryKey,
  JEV_CONNECTOR_STALE_MS,
  jevConnectorStorageKey,
  jevScopePhase,
  jevScopeFollowsLive,
  notedJevAuthUser,
  subscribeJevScope,
  noteJevAuthUser,
  beginJevScopeLookup,
  completeJevScopeLookup,
  dropJevConnectorForAuthChange,
  resetJevScopeMemory,
  bindJevConnectorScope,
  boundJevConnectorScope,
  dropLegacyJevConnectorKey,
  companyIdFromReviewPayload,
  userRememberedJevOn,
  jevConnectorLiveKey,
  seedJevConnectorFromLive,
  jevLiveOn,
  readJevConnectorFlag,
  writeJevConnectorFlag,
  clearJevConnectorFlag,
} from "./jev-connector-scope";
export type { JevConnectorScope, JevScopePhase, JevScopeLookup } from "./jev-connector-scope";

export type JevField = { id: string; name: string };

export type JevPrefill = {
  suggestionId: string;
  transactionId: string;
  project: JevField | null;
  category: JevField | null;
  /** Why it looks right, from rpc `jev_suggestions` (decision 0134). Absent when that read failed. */
  why?: JevReasonInfo;
  /**
   * FLOW-703: Jev answered "no project / overhead" (`no_project: true` from rpc `jev_suggestions`,
   * #177). Optional: older servers never send it. It suggests nothing to save.
   */
  noProject?: true;
  /**
   * FLOW-702: the auto job's newest fill on this line (`jev_prefills`, decision 0145). "filled"
   * still stands and can be undone; "undone" means the owner took it back, so the card shows the
   * stored row and Jev fills nothing. Absent when there was no fill or that read failed.
   */
  auto?: JevAutoFill;
};

export type JevAutoFill = { state: "filled" | "undone"; projectId: string | null; categoryId: string | null };

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

/** Income has a project in review (decision 0091), so Jev may suggest one (decision 0134). */
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
  if (!prefill || prefill.transactionId !== row.transaction_id || prefill.auto?.state === "undone") return JEV_SHOWN_NONE;
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
  if (!prefill || prefill.transactionId !== row.transaction_id || prefill.auto?.state === "undone") return row;
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

/**
 * FLOW-702: the card says "מולא ע״י Jev" with בטל when the auto job's fill still stands on the
 * stored row: a field Jev shows holds the value the job wrote. A visual-only suggestion is not a fill.
 */
export function jevFilledOnCard(row: JevRow, state: JevReviewState): boolean {
  const auto = state.prefill?.auto;
  if (auto?.state !== "filled") return false;
  if (!state.connectorOn) {
    // FLOW-706: off shows no Jev values, but a fill still standing stays undoable (decision 0145).
    if (state.prefill?.transactionId !== row.transaction_id) return false;
    return (auto.projectId != null && row.project_id === auto.projectId && projectOpen(row))
      || (auto.categoryId != null && row.category_id === auto.categoryId && categoryOpen(row));
  }
  const shown = jevShown(row, state);
  return (shown.project && auto.projectId != null && row.project_id === auto.projectId)
    || (shown.category && auto.categoryId != null && row.category_id === auto.categoryId);
}

/**
 * Newest `jev_prefills` row per line. A failed read throws, like the suggestions read, so the
 * card falls back to the stored row: a line whose fill was undone never gets Jev's values again.
 */
export async function loadJevFills(ids: readonly string[], signal?: AbortSignal): Promise<Map<string, JevAutoFill>> {
  const fills = new Map<string, JevAutoFill>();
  const supabase = getSupabase();
  if (!supabase || typeof supabase.from !== "function" || ids.length === 0) return fills;
  try {
    const chunks: string[][] = [];
    for (let start = 0; start < ids.length; start += JEV_SUGGESTION_CHUNK) chunks.push(ids.slice(start, start + JEV_SUGGESTION_CHUNK));
    const reads = await Promise.all(chunks.map((chunk) => signalled(
      supabase.from("jev_prefills").select("transaction_id,project_id,category_id,undone_at").in("transaction_id", chunk).order("created_at", { ascending: false }).order("id", { ascending: false }),
      signal,
    )));
    for (const read of reads) {
      if (read.error) throw new Error(read.error.message);
      if (!Array.isArray(read.data)) throw new Error("jev_prefills");
      for (const row of read.data as Array<{ transaction_id: string; project_id: string | null; category_id: string | null; undone_at: string | null }>) {
        // undo_jev_prefill takes back the newest fill that still stands, so a standing fill wins
        // over a newer undone one: the line still holds Jev's values and בטל can take them back.
        const held = fills.get(row.transaction_id);
        if (held != null && (held.state === "filled" || row.undone_at != null)) continue;
        fills.set(row.transaction_id, {
          state: row.undone_at == null ? "filled" : "undone",
          projectId: row.project_id,
          categoryId: row.category_id,
        });
      }
    }
  } catch (error) {
    if (signal?.aborted || error instanceof Error) throw error;
    throw new Error("jev_prefills");
  }
  return fills;
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
  // #177: Jev answers the project question with choice "none" (no project / overhead). It
  // pre-fills nothing, but the card shows it, with or without the reasons read.
  const noProject = project == null && isRecord(answers.project) && answers.project.choice === "none";
  if (!project && !category && !noProject) return null;
  return { suggestionId, transactionId, project, category, ...(noProject ? { noProject: true as const } : {}) };
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
  // The reasons read is optional: it starts now, beside the suggestions, and has its own shorter
  // deadline so a slow rpc never holds the prefill.
  const reasonsRead = loadJevReasonsWithin(ids, signal);
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
  const [projects, categories, reasons, fills] = await Promise.all([
    signalled(supabase.from("projects").select("id,name,status"), signal),
    signalled(supabase.from("categories").select("id,name,hidden"), signal),
    reasonsRead,
    loadJevFills(ids, signal),
  ]);
  if (projects.error) throw new Error(projects.error.message);
  if (categories.error) throw new Error(categories.error.message);
  const projectNames = nameMap(projects.data, "project");
  const categoryNames = nameMap(categories.data, "category");
  const byId: Record<string, JevPrefill | null> = {};
  for (const id of ids) {
    const row = newest.get(id);
    const prefill = row
      ? parseJevSuggestion(row.answers, row.id, row.transaction_id, projectNames, categoryNames)
      : null;
    const reason = reasons.get(id);
    // A "no project" answer with no category is still a suggestion to show.
    const shown = prefill ?? (row && reason?.noProject === true
      ? { suggestionId: row.id, transactionId: row.transaction_id, project: null, category: null }
      : null);
    const fill = fills.get(id);
    byId[id] = shown == null ? null : withReason(fill == null ? shown : { ...shown, auto: fill }, reason);
  }
  return { connectorOn: true, byId };
}

/** Ids per rpc call: the server takes at most 500. */
export const JEV_RPC_CHUNK = 500;

function chunked(ids: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (let start = 0; start < ids.length; start += JEV_RPC_CHUNK) chunks.push(ids.slice(start, start + JEV_RPC_CHUNK));
  return chunks;
}

type JevReasonRow = JevReasonInfo & { projectId: string | null; categoryId: string | null; noProject: boolean };

function readCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function readId(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** One `jev_suggestions` row, or null when it is not the shape decision 0134 names. */
export function parseJevReason(value: unknown): (JevReasonRow & { transactionId: string }) | null {
  if (!isRecord(value)) return null;
  const transactionId = readId(value.transaction_id);
  const partyFilings = readCount(value.party_filings);
  const matchingFilings = readCount(value.matching_filings);
  if (transactionId == null || !isJevReasonKind(value.reason) || partyFilings == null || matchingFilings == null) return null;
  return {
    transactionId,
    reason: value.reason,
    partyFilings,
    matchingFilings,
    projectId: readId(value.project_id),
    categoryId: readId(value.category_id),
    noProject: value.no_project === true,
  };
}

/**
 * rpc `jev_suggestions` for the reasons. Optional: a failed or missing read gives no reasons,
 * and the card shows no reason line. It never fails the suggestion read.
 */
export async function loadJevReasons(ids: readonly string[], signal?: AbortSignal): Promise<Map<string, JevReasonRow>> {
  const reasons = new Map<string, JevReasonRow>();
  const supabase = getSupabase();
  if (!supabase || typeof supabase.rpc !== "function" || ids.length === 0) return reasons;
  try {
    const reads = await Promise.all(chunked(ids).map((chunk) => signalled(
      supabase.rpc("jev_suggestions", { p_transaction_ids: chunk }),
      signal,
    )));
    for (const read of reads) {
      if (read.error) throw new Error(read.error.message);
      if (!Array.isArray(read.data)) throw new Error("jev_prefills");
      for (const raw of read.data) {
        const row = parseJevReason(raw);
        if (row == null) continue;
        const { transactionId, ...rest } = row;
        reasons.set(transactionId, rest);
      }
    }
  } catch (error) {
    if (signal?.aborted) throw error;
  }
  return reasons;
}

/** The reasons read's own deadline, inside the one-second suggestion read. */
export const JEV_REASONS_MS = 600;

/**
 * `loadJevReasons` with its own child abort linked to `parent`. Its own timeout gives no
 * reasons; only the parent's abort rejects.
 */
export function loadJevReasonsWithin(
  ids: readonly string[],
  parent?: AbortSignal,
  ms: number = JEV_REASONS_MS,
): Promise<Map<string, JevReasonRow>> {
  if (parent?.aborted) return Promise.reject(abortError(parent.reason));
  const child = new AbortController();
  const onParent = () => {
    child.abort(parent?.reason);
  };
  parent?.addEventListener("abort", onParent, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<Map<string, JevReasonRow>>((resolve, reject) => {
    const settle = () => {
      if (parent?.aborted) reject(abortError(parent.reason));
      else resolve(new Map());
    };
    timer = setTimeout(() => {
      child.abort();
    }, ms);
    child.signal.addEventListener("abort", settle, { once: true });
  });
  const read = loadJevReasons(ids, child.signal).catch((error: unknown) => {
    if (parent?.aborted) throw abortError(parent.reason);
    if (child.signal.aborted) return new Map<string, JevReasonRow>();
    throw error;
  });
  const settled = Promise.race([read, expired]).finally(() => {
    clearTimeout(timer);
    parent?.removeEventListener("abort", onParent);
  });
  // Started before the suggestions read is awaited: a parent abort that lands first must not
  // surface as an unhandled rejection.
  settled.catch(() => undefined);
  return settled;
}

/** The reason belongs to the suggestion on the card only when it names the same project and category. */
function withReason(prefill: JevPrefill, row: JevReasonRow | undefined): JevPrefill {
  if (row == null) return prefill;
  if (prefill.project != null && row.projectId !== prefill.project.id) return prefill;
  if (prefill.category != null && row.categoryId !== prefill.category.id) return prefill;
  return {
    ...prefill,
    why: { reason: row.reason, partyFilings: row.partyFilings, matchingFilings: row.matchingFilings },
    ...(row.noProject && prefill.project == null ? { noProject: true as const } : {}),
  };
}

const FLAG_KINDS: readonly ReviewFlagKind[] = ["duplicate", "amount_spike", "new_party_large"];

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** One `review_anomalies` row, or null when it is not one of the three kinds in decision 0131. */
export function parseReviewFlag(value: unknown): ReviewFlag | null {
  if (!isRecord(value)) return null;
  const transactionId = readId(value.transaction_id);
  const kind = FLAG_KINDS.find((item) => item === value.kind);
  if (transactionId == null || kind == null) return null;
  const score = readNumber(value.jev_score);
  return {
    transaction_id: transactionId,
    kind,
    jev_score: score != null && score >= 0 && score <= 1 ? score : null,
    other_doc_date: typeof value.other_doc_date === "string" ? value.other_doc_date : null,
    typical_amount_minor: readNumber(value.typical_amount_minor),
    ratio: readNumber(value.ratio),
  };
}

export type ReviewFlagsData = Record<string, ReviewFlag[]>;

/** rpc `review_anomalies` for the lines in the queue. A failed read throws; the card then shows no flag. */
export async function loadReviewFlags(transactionIds: readonly string[], signal?: AbortSignal): Promise<ReviewFlagsData> {
  const supabase = getSupabase();
  const ids = [...new Set(transactionIds.filter((id) => id !== ""))];
  const byId: ReviewFlagsData = {};
  if (!supabase || typeof supabase.rpc !== "function" || ids.length === 0) return byId;
  const reads = await Promise.all(chunked(ids).map((chunk) => signalled(
    supabase.rpc("review_anomalies", { p_transaction_ids: chunk }),
    signal,
  )));
  for (const read of reads) {
    if (read.error) throw new Error(read.error.message);
    if (!Array.isArray(read.data)) continue;
    for (const raw of read.data) {
      const flag = parseReviewFlag(raw);
      if (flag == null) continue;
      (byId[flag.transaction_id] ??= []).push(flag);
    }
  }
  return byId;
}

export function reviewFlagsQueryKey(transactionIds: readonly string[]) {
  return ["review-anomalies", jevQueueKey(transactionIds)] as const;
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
