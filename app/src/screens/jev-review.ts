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

export type JevCorrection = {
  transactionId: string;
  suggestionId: string;
  action: "confirm" | "fix";
  suggestedProjectId: string | null;
  suggestedCategoryId: string | null;
  chosenProjectId: string | null;
  chosenCategoryId: string | null;
};

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
};

function skipsProject(row: JevRow): boolean {
  return row.direction === "income"
    || row.pnl_role === "shared"
    || row.pnl_role === "overhead"
    || (row.share_count ?? 0) > 1
    || row.reason === "unallocated_shared";
}

function projectOpen(row: JevRow): boolean {
  if (skipsProject(row)) return false;
  return !(row.project_id != null && row.project_suggested !== true);
}

function categoryOpen(row: JevRow): boolean {
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

export function jevCorrectionFor(
  row: JevRow,
  state: JevReviewState,
  chosen: { projectId: string | null; categoryId: string | null },
): JevCorrection | null {
  if (!state.connectorOn || !state.prefill || state.prefill.transactionId !== row.transaction_id) return null;
  const suggestedProjectId = projectOpen(row) ? (state.prefill.project?.id ?? null) : null;
  const suggestedCategoryId = categoryOpen(row) ? (state.prefill.category?.id ?? null) : null;
  if (suggestedProjectId == null && suggestedCategoryId == null) return null;
  const projectFix = suggestedProjectId != null && chosen.projectId !== suggestedProjectId;
  const categoryFix = suggestedCategoryId != null && chosen.categoryId !== suggestedCategoryId;
  return {
    transactionId: row.transaction_id,
    suggestionId: state.prefill.suggestionId,
    action: projectFix || categoryFix ? "fix" : "confirm",
    suggestedProjectId,
    suggestedCategoryId,
    chosenProjectId: chosen.projectId,
    chosenCategoryId: chosen.categoryId,
  };
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

export async function loadJevReview(transactionId: string): Promise<JevReviewState> {
  const supabase = getSupabase();
  if (!supabase || typeof supabase.from !== "function") return JEV_REVIEW_OFF;
  const integration = await supabase
    .from("company_integrations")
    .select("enabled,mode")
    .eq("provider", "jev")
    .maybeSingle();
  if (integration.error) throw new Error(integration.error.message);
  const stored = integration.data;
  const connectorOn = stored?.enabled === true && stored.mode !== "off" && (stored.mode === "shadow" || stored.mode === "auto");
  if (!connectorOn) return JEV_REVIEW_OFF;
  const suggestion = await supabase
    .from("tag_suggestions")
    .select("id,transaction_id,answers")
    .eq("transaction_id", transactionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (suggestion.error) throw new Error(suggestion.error.message);
  const row = suggestion.data;
  if (!row) return { connectorOn: true, prefill: null };
  const projects = await supabase.from("projects").select("id,name,status");
  if (projects.error) throw new Error(projects.error.message);
  const categories = await supabase.from("categories").select("id,name,hidden");
  if (categories.error) throw new Error(categories.error.message);
  return {
    connectorOn: true,
    prefill: parseJevSuggestion(
      row.answers,
      row.id,
      row.transaction_id,
      nameMap(projects.data, "project"),
      nameMap(categories.data, "category"),
    ),
  };
}

type CorrectionCall = {
  rpc(name: string, args: Record<string, unknown>): Promise<{ error: { message: string; code?: string } | null }>;
};

function correctionCall(client: unknown): CorrectionCall | null {
  if (!isRecord(client) || typeof client.rpc !== "function") return null;
  return client as CorrectionCall;
}

/** Writes one confirm or fix. A missing record_jev_correction does not throw: that function is still pending. */
export async function saveJevCorrection(input: JevCorrection): Promise<void> {
  const call = correctionCall(getSupabase());
  if (!call) throw new Error("supabase");
  const { error } = await call.rpc("record_jev_correction", {
    p_transaction_id: input.transactionId,
    p_suggestion_id: input.suggestionId,
    p_action: input.action,
    p_suggested_project_id: input.suggestedProjectId,
    p_suggested_category_id: input.suggestedCategoryId,
    p_chosen_project_id: input.chosenProjectId,
    p_chosen_category_id: input.chosenCategoryId,
  });
  if (!error) return;
  if (error.code === "PGRST202" || error.message.includes("record_jev_correction")) return;
  throw new Error(error.message);
}
