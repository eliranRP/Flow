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

function skipsProject(row: JevRow): boolean {
  return row.direction === "income"
    || row.pnl_role === "shared"
    || row.pnl_role === "overhead"
    || (row.share_count ?? 0) > 1
    || row.reason === "unallocated_shared";
}

function userOwns(userAssigned: boolean | undefined, fieldAssigned: boolean | undefined): boolean {
  return userAssigned === true || fieldAssigned === true;
}

/** Both flags are on the row and neither says the user set the field. */
function flagsSayUnset(userAssigned: boolean | undefined, fieldAssigned: boolean | undefined): boolean {
  return userAssigned === false && fieldAssigned === false;
}

function projectOpen(row: JevRow): boolean {
  if (skipsProject(row)) return false;
  if (userOwns(row.user_assigned, row.project_assigned)) return false;
  if (row.project_id == null) return true;
  if (flagsSayUnset(row.user_assigned, row.project_assigned)) return true;
  return row.project_suggested === true;
}

function categoryOpen(row: JevRow): boolean {
  if (userOwns(row.user_assigned, row.category_assigned)) return false;
  // An empty category is unset. list_review still returns category_suggested false.
  if (row.category_id == null) return true;
  if (flagsSayUnset(row.user_assigned, row.category_assigned)) return true;
  // No assignment columns: a stored non-suggestion stays. An omitted flag stays open.
  return row.category_suggested !== false;
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

export async function loadJevQueue(transactionIds: readonly string[]): Promise<JevQueueData> {
  const supabase = getSupabase();
  const ids = [...new Set(transactionIds.filter((id) => id !== ""))];
  if (!supabase || typeof supabase.from !== "function") return { connectorOn: false, byId: {} };
  const integration = await supabase
    .from("company_integrations")
    .select("enabled,mode")
    .eq("provider", "jev")
    .maybeSingle();
  if (integration.error) throw new Error(integration.error.message);
  const stored = integration.data;
  const connectorOn = stored?.enabled === true && stored.mode !== "off" && (stored.mode === "shadow" || stored.mode === "auto");
  if (!connectorOn || ids.length === 0) return { connectorOn, byId: {} };
  const suggestions = await supabase
    .from("tag_suggestions")
    .select("id,transaction_id,answers")
    .in("transaction_id", ids)
    .order("created_at", { ascending: false });
  if (suggestions.error) throw new Error(suggestions.error.message);
  const newest = new Map<string, { id: string; transaction_id: string; answers: unknown }>();
  for (const row of suggestions.data) {
    if (!newest.has(row.transaction_id)) newest.set(row.transaction_id, row);
  }
  const projects = await supabase.from("projects").select("id,name,status");
  if (projects.error) throw new Error(projects.error.message);
  const categories = await supabase.from("categories").select("id,name,hidden");
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

export async function loadJevReview(transactionId: string): Promise<JevReviewState> {
  const queue = await loadJevQueue([transactionId]);
  return {
    connectorOn: queue.connectorOn,
    prefill: queue.byId[transactionId] ?? null,
  };
}
