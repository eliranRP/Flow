// Tagging job. Decision 0084.
// Off does not call Jev. Shadow stores a suggestion. Auto at or above the
// threshold pre-fills a project and category the user has not set, marks that
// fill as a suggestion, and leaves the line in לאישור. Nothing here approves.

import { JEV_MODEL, JevError, callJev, type FetchLike, type JevCall, type JevQuestion, type JevResult, type JevState } from "./jev.ts";
import { readJevApiKey } from "./jev_key.ts";
import { empty, json } from "./http.ts";

export const JEV_TAG_LIMIT = 20;
const CHOICE_CAP = 255;

export type TagMode = "shadow" | "auto";

export type TagProject = { id: string; name: string };
export type TagCategory = { id: string; name: string };

export type TagExpense = {
  id: string;
  companyId: string;
  description: string;
  docDate: string;
  supplierName: string | null;
  amountGross: number;
  amountNet: number;
  vatAmount: number;
  projectId: string | null;
  categoryId: string | null;
  projectAssigned: boolean;
  categoryAssigned: boolean;
  userAssigned: boolean;
  pnlRole: string | null;
  allocationCount: number;
};

export type TagCompanyWork = {
  companyId: string;
  mode: TagMode;
  threshold: number;
  projects: TagProject[];
  categories: TagCategory[];
  expenses: TagExpense[];
};

export type SuggestionRow = {
  companyId: string;
  transactionId: string;
  answers: Record<string, unknown>;
  confidence: number;
  modelVersion: string;
  responseModel: string;
};

export type PrefillWrite = {
  companyId: string;
  transactionId: string;
  projectId?: string;
  categoryId?: string;
  categorySuggested?: boolean;
  allocation: { projectId: string; amountNet: number } | null;
};

export type TagPlan = {
  confidence: number;
  answers: Record<string, unknown>;
  write: PrefillWrite | null;
};

export class StoreConflict extends Error {
  constructor() {
    super("conflict");
    this.name = "StoreConflict";
  }
}

export class TagStop extends Error {
  readonly code: "unauthorized" | "missing_key";
  constructor(code: "unauthorized" | "missing_key") {
    super(code);
    this.name = "TagStop";
    this.code = code;
  }
}

export type TagStore = {
  listWork(limit: number): Promise<TagCompanyWork[]>;
  saveSuggestion(row: SuggestionRow): Promise<void>;
  prefill(write: PrefillWrite): Promise<void>;
  deleteSuggestion(transactionId: string, modelVersion: string): Promise<void>;
};

export type TagCaller = (apiKey: string, input: JevCall) => Promise<JevResult>;

export type TagReport = {
  companies: number;
  tagged: number;
  prefilled: number;
  skipped: number;
  failed: number;
};

type JsonObject = { [key: string]: unknown };

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function choiceCriteria(rows: readonly { id: string; name: string }[]): Record<string, string> | null {
  const usable = rows.filter((row) => row.id.trim() !== "" && row.name.trim() !== "");
  if (usable.length === 0 || usable.length > CHOICE_CAP) return null;
  const criteria: Record<string, string> = {};
  for (const row of usable) criteria[row.id] = row.name;
  return criteria;
}

export function buildTagQuestions(
  projects: readonly TagProject[],
  categories: readonly TagCategory[],
): Record<string, JevQuestion> {
  const questions: Record<string, JevQuestion> = {};
  const projectCriteria = choiceCriteria(projects);
  if (projectCriteria) {
    questions.project = {
      type: "choice",
      instructions: "Choose the project id for this expense.",
      criteria: projectCriteria,
    };
  }
  const categoryCriteria = choiceCriteria(categories);
  if (categoryCriteria) {
    questions.category = {
      type: "choice",
      instructions: "Choose the expense category id for this expense.",
      criteria: categoryCriteria,
    };
  }
  return questions;
}

/** Amounts are context for the model. planTag does not write them back. */
export function buildTagState(expense: TagExpense): JevState {
  return {
    description: expense.description,
    doc_date: expense.docDate,
    direction: "expense",
    supplier: expense.supplierName,
    amount_gross: expense.amountGross,
    amount_net: expense.amountNet,
    vat_amount: expense.vatAmount,
  };
}

function readChoice(value: unknown, allowed: ReadonlySet<string>): { id: string; confidence: number } | null {
  if (!isObject(value)) return null;
  const choice = value.choice;
  const confidence = value.confidence;
  if (typeof choice !== "string" || !allowed.has(choice)) return null;
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  return { id: choice, confidence };
}

function projectBlocked(expense: TagExpense): boolean {
  return expense.userAssigned
    || expense.projectAssigned
    || expense.pnlRole === "shared"
    || expense.pnlRole === "overhead"
    || expense.allocationCount > 1;
}

export function planTag(
  expense: TagExpense,
  mode: TagMode,
  threshold: number,
  projects: readonly TagProject[],
  categories: readonly TagCategory[],
  answers: Record<string, unknown>,
): TagPlan {
  const questions = buildTagQuestions(projects, categories);
  const parts: number[] = [];
  const projectAllowed = new Set(projects.map((row) => row.id));
  const categoryAllowed = new Set(categories.map((row) => row.id));
  const project = "project" in questions ? readChoice(answers.project, projectAllowed) : undefined;
  const category = "category" in questions ? readChoice(answers.category, categoryAllowed) : undefined;
  if (project !== undefined) parts.push(project?.confidence ?? 0);
  if (category !== undefined) parts.push(category?.confidence ?? 0);
  const confidence = parts.length === 0 ? 0 : Math.min(...parts);
  const gate = mode === "auto" && parts.length > 0 && confidence >= threshold;

  const write: PrefillWrite = {
    companyId: expense.companyId,
    transactionId: expense.id,
    allocation: null,
  };
  if (gate && project && !projectBlocked(expense)) {
    write.projectId = project.id;
    if (Number.isFinite(expense.amountNet)) {
      write.allocation = { projectId: project.id, amountNet: expense.amountNet };
    }
  }
  if (gate && category && !expense.userAssigned && !expense.categoryAssigned) {
    write.categoryId = category.id;
    write.categorySuggested = true;
  }
  const hasWrite = write.projectId !== undefined || write.categoryId !== undefined;
  return { confidence, answers, write: hasWrite ? write : null };
}

export function selectUntagged(
  openIds: readonly string[],
  taggedIds: readonly string[],
  expenses: readonly TagExpense[],
  limit: number,
): TagExpense[] {
  const open = new Set(openIds);
  const tagged = new Set(taggedIds);
  return expenses
    .filter((expense) => open.has(expense.id) && !tagged.has(expense.id))
    .slice()
    .sort((left, right) => left.docDate.localeCompare(right.docDate) || left.id.localeCompare(right.id))
    .slice(0, limit);
}

export async function tagWork(
  work: readonly TagCompanyWork[],
  store: Pick<TagStore, "saveSuggestion" | "prefill" | "deleteSuggestion">,
  call: TagCaller,
  apiKey: string,
): Promise<TagReport> {
  const report: TagReport = { companies: work.length, tagged: 0, prefilled: 0, skipped: 0, failed: 0 };
  for (const company of work) {
    const questions = buildTagQuestions(company.projects, company.categories);
    if (Object.keys(questions).length === 0) {
      report.skipped += company.expenses.length;
      continue;
    }
    for (const expense of company.expenses) {
      let result: JevResult;
      try {
        result = await call(apiKey, { state: buildTagState(expense), questions });
      } catch (error) {
        if (error instanceof JevError && (error.code === "unauthorized" || error.code === "missing_key")) {
          throw new TagStop(error.code);
        }
        report.failed += 1;
        continue;
      }
      const plan = planTag(
        expense,
        company.mode,
        company.threshold,
        company.projects,
        company.categories,
        result.answers,
      );
      try {
        await store.saveSuggestion({
          companyId: expense.companyId,
          transactionId: expense.id,
          answers: plan.answers,
          confidence: plan.confidence,
          modelVersion: JEV_MODEL,
          responseModel: result.model,
        });
      } catch (error) {
        if (error instanceof StoreConflict) {
          report.skipped += 1;
          continue;
        }
        report.failed += 1;
        continue;
      }
      if (!plan.write) {
        report.tagged += 1;
        continue;
      }
      try {
        await store.prefill(plan.write);
        report.tagged += 1;
        report.prefilled += 1;
      } catch {
        try {
          await store.deleteSuggestion(expense.id, JEV_MODEL);
        } catch {
          // The row stays. The next run will see the conflict and skip it.
        }
        report.failed += 1;
      }
    }
  }
  return report;
}

export function integrationsPath(): string {
  return "/rest/v1/company_integrations?provider=eq.jev&enabled=eq.true&select=company_id,mode,threshold";
}

export function projectsPath(companyId: string): string {
  return `/rest/v1/projects?company_id=eq.${companyId}&status=eq.active&select=id,name`;
}

export function categoriesPath(companyId: string): string {
  return `/rest/v1/categories?company_id=eq.${companyId}&kind=eq.expense&hidden=eq.false&select=id,name`;
}

export function reviewQueuePath(companyId: string): string {
  return `/rest/v1/review_queue?company_id=eq.${companyId}&status=eq.open&select=transaction_id`;
}

export function suggestionsPath(companyId: string, model: string): string {
  return `/rest/v1/tag_suggestions?company_id=eq.${companyId}&model_version=eq.${model}&select=transaction_id`;
}

export function transactionsPath(companyId: string, ids: readonly string[]): string {
  return `/rest/v1/transactions?company_id=eq.${companyId}&direction=eq.expense&removed_at=is.null&id=in.(${ids.join(",")})&select=id,company_id,description,doc_date,supplier_id,amount_gross,amount_net,vat_amount,project_id,category_id,project_assigned,category_assigned,user_assigned,pnl_role&order=doc_date.asc,id.asc`;
}

type RestRow = Record<string, unknown>;

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return Number.NaN;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asBool(value: unknown): boolean {
  return value === true;
}

async function rest(
  fetch: FetchLike,
  url: string,
  serviceKey: string,
  init: { method: string; body?: unknown },
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method,
      headers: {
        authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new Error("store");
  }
  if (response.status === 409) {
    await response.body?.cancel();
    throw new StoreConflict();
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("store");
  }
  if (response.status === 204) return null;
  const text = await response.text();
  if (text.trim() === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("store");
  }
}

function rows(value: unknown): RestRow[] {
  if (!Array.isArray(value)) throw new Error("store");
  return value.filter(isObject);
}

export function createTagStore(fetch: FetchLike, supabaseUrl: string, serviceKey: string): TagStore {
  const base = supabaseUrl.replace(/\/+$/, "");
  const get = (path: string) => rest(fetch, `${base}${path}`, serviceKey, { method: "GET" });

  return {
    async listWork(limit: number): Promise<TagCompanyWork[]> {
      const integrations = rows(await get(integrationsPath()));
      const work: TagCompanyWork[] = [];
      for (const integration of integrations) {
        const companyId = asString(integration.company_id);
        const mode = integration.mode === "auto" || integration.mode === "shadow" ? integration.mode : null;
        const threshold = asNumber(integration.threshold);
        if (!companyId || !mode || !Number.isFinite(threshold)) continue;
        const projects = rows(await get(projectsPath(companyId))).flatMap((row) => {
          const id = asString(row.id);
          const name = asString(row.name);
          return id && name ? [{ id, name }] : [];
        });
        const categories = rows(await get(categoriesPath(companyId))).flatMap((row) => {
          const id = asString(row.id);
          const name = asString(row.name);
          return id && name ? [{ id, name }] : [];
        });
        const openIds = rows(await get(reviewQueuePath(companyId))).flatMap((row) => {
          const id = asString(row.transaction_id);
          return id ? [id] : [];
        });
        const taggedIds = rows(await get(suggestionsPath(companyId, JEV_MODEL))).flatMap((row) => {
          const id = asString(row.transaction_id);
          return id ? [id] : [];
        });
        const candidateIds = openIds.filter((id) => !taggedIds.includes(id));
        let loaded: TagExpense[] = [];
        if (candidateIds.length > 0) {
          const transactions = rows(await get(transactionsPath(companyId, candidateIds)));
          const ids = transactions.flatMap((row) => {
            const id = asString(row.id);
            return id ? [id] : [];
          });
          const allocationCounts = new Map<string, number>();
          if (ids.length > 0) {
            const allocations = rows(await get(
              `/rest/v1/allocations?company_id=eq.${companyId}&transaction_id=in.(${ids.join(",")})&select=transaction_id`,
            ));
            for (const row of allocations) {
              const id = asString(row.transaction_id);
              if (id) allocationCounts.set(id, (allocationCounts.get(id) ?? 0) + 1);
            }
          }
          const supplierIds = [...new Set(transactions.flatMap((row) => {
            const id = asString(row.supplier_id);
            return id ? [id] : [];
          }))];
          const supplierNames = new Map<string, string>();
          if (supplierIds.length > 0) {
            const suppliers = rows(await get(
              `/rest/v1/suppliers?company_id=eq.${companyId}&id=in.(${supplierIds.join(",")})&select=id,name`,
            ));
            for (const row of suppliers) {
              const id = asString(row.id);
              const name = asString(row.name);
              if (id && name) supplierNames.set(id, name);
            }
          }
          loaded = transactions.flatMap((row) => {
            const id = asString(row.id);
            const docDate = asString(row.doc_date);
            if (!id || !docDate) return [];
            const supplierId = asString(row.supplier_id);
            const expense: TagExpense = {
              id,
              companyId,
              description: asString(row.description) ?? "",
              docDate,
              supplierName: supplierId ? supplierNames.get(supplierId) ?? null : null,
              amountGross: asNumber(row.amount_gross),
              amountNet: asNumber(row.amount_net),
              vatAmount: asNumber(row.vat_amount),
              projectId: asString(row.project_id),
              categoryId: asString(row.category_id),
              projectAssigned: asBool(row.project_assigned),
              categoryAssigned: asBool(row.category_assigned),
              userAssigned: asBool(row.user_assigned),
              pnlRole: asString(row.pnl_role),
              allocationCount: allocationCounts.get(id) ?? 0,
            };
            return [expense];
          });
        }
        work.push({
          companyId,
          mode,
          threshold,
          projects,
          categories,
          expenses: selectUntagged(openIds, taggedIds, loaded, limit),
        });
      }
      return work;
    },

    async saveSuggestion(row: SuggestionRow): Promise<void> {
      await rest(fetch, `${base}/rest/v1/tag_suggestions`, serviceKey, {
        method: "POST",
        body: {
          company_id: row.companyId,
          transaction_id: row.transactionId,
          answers: row.answers,
          confidence: row.confidence,
          model_version: row.modelVersion,
          response_model: row.responseModel,
        },
      });
    },

    async prefill(write: PrefillWrite): Promise<void> {
      const body: JsonObject = {};
      if (write.projectId) body.project_id = write.projectId;
      if (write.categoryId) {
        body.category_id = write.categoryId;
        body.category_suggested = true;
      }
      if (Object.keys(body).length > 0) {
        await rest(
          fetch,
          `${base}/rest/v1/transactions?id=eq.${write.transactionId}&company_id=eq.${write.companyId}`,
          serviceKey,
          { method: "PATCH", body },
        );
      }
      if (write.allocation) {
        await rest(
          fetch,
          `${base}/rest/v1/allocations?transaction_id=eq.${write.transactionId}&company_id=eq.${write.companyId}`,
          serviceKey,
          { method: "DELETE" },
        );
        await rest(fetch, `${base}/rest/v1/allocations`, serviceKey, {
          method: "POST",
          body: {
            company_id: write.companyId,
            transaction_id: write.transactionId,
            project_id: write.allocation.projectId,
            share_bp: 10000,
            amount_net: write.allocation.amountNet,
          },
        });
      }
    },

    async deleteSuggestion(transactionId: string, modelVersion: string): Promise<void> {
      await rest(
        fetch,
        `${base}/rest/v1/tag_suggestions?transaction_id=eq.${transactionId}&model_version=eq.${modelVersion}`,
        serviceKey,
        { method: "DELETE" },
      );
    },
  };
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return diff === 0;
}

export type JevTagDeps = {
  fetch: FetchLike;
  env(name: string): string;
  readKey?: (source: { fetch: FetchLike; supabaseUrl: string; serviceKey: string }) => Promise<string>;
  call?: TagCaller;
};

export async function handleJevTag(req: Request, deps: JevTagDeps): Promise<Response> {
  if (req.method === "OPTIONS") return empty();
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const cronSecret = deps.env("CRON_SECRET");
  const presented = req.headers.get("x-flow-cron") ?? "";
  if (cronSecret.trim() === "" || presented.trim() === "" || !constantTimeEqual(presented, cronSecret)) {
    return json({ error: "unauthorized" }, 401);
  }
  const supabaseUrl = deps.env("SUPABASE_URL");
  const serviceKey = deps.env("SUPABASE_SERVICE_ROLE_KEY");
  if (supabaseUrl.trim() === "" || serviceKey.trim() === "") return json({ error: "missing_key" }, 500);
  const readKey = deps.readKey ?? readJevApiKey;
  const call = deps.call ?? ((apiKey, input) => callJev(apiKey, input, { fetch: deps.fetch }));
  try {
    const apiKey = await readKey({ fetch: deps.fetch, supabaseUrl, serviceKey });
    const store = createTagStore(deps.fetch, supabaseUrl, serviceKey);
    const work = await store.listWork(JEV_TAG_LIMIT);
    const report = await tagWork(work, store, call, apiKey);
    return json({ ok: true, ...report });
  } catch (error) {
    if (error instanceof TagStop) return json({ error: error.code }, 500);
    if (error instanceof JevError && error.code === "missing_key") return json({ error: "missing_key" }, 500);
    return json({ error: "tag_failed" }, 500);
  }
}
