// Tagging job. Decisions 0084 and 0124.
// Off does not call Jev. Shadow stores a suggestion. Auto at or above the
// threshold pre-fills a project and category the user has not set, marks that
// fill as a suggestion, and leaves the line in לאישור. Nothing here approves.
// A database lease lets one run at a time, and each company's calls are reserved
// from its daily cap in SQL before Jev is called (decision 0124).

import {
  JEV_MODEL,
  JEV_TIMEOUT_MS,
  JevError,
  callJev,
  type FetchLike,
  type JevCall,
  type JevQuestion,
  type JevResult,
  type JevState,
  type JsonValue,
  type JevTimer,
} from "./jev.ts";
import { readJevApiKey } from "./jev_key.ts";
import { empty, json } from "./http.ts";

export const JEV_TAG_DEFAULT_LIMIT = 50;
export const JEV_TAG_MAX_LIMIT = 100;
export const JEV_TAG_ATTEMPTS = 2;
export const JEV_TAG_BUDGET_MS = 120_000;
/** Do not start another Jev call when less than this much of the budget is left. */
export const JEV_TAG_RESERVE_MS = 20_000;
export const JEV_TAG_INTERVAL_MS = 60_000;
/** This many provider failures in a row end the run, so an outage marks few lines. */
export const JEV_TAG_OUTAGE_STOP = 3;
const TRANSPORT_CODES = new Set(["rate_limited", "overloaded", "timeout", "unavailable"]);
/** The run lease outlives the 150 second Edge limit, so a killed run frees it on its own. */
export const JEV_TAG_LEASE_SECONDS = 180;
const CHOICE_CAP = 255;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TagMode = "shadow" | "auto";

export type TagProject = { id: string; name: string };
export type TagCategory = { id: string; name: string };

export type TagExpense = {
  id: string;
  companyId: string;
  description: string;
  docDate: string;
  supplierName: string | null;
  supplierId?: string | null;
  /** How the owner filed this supplier before, newest first (decision 0127). */
  history?: TagFiling[];
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

/** A line the owner filed (approved or changed), from SQL. */
export type TagFiling = {
  docDate: string;
  description: string;
  amountNet: number;
  projectId: string | null;
  categoryId: string | null;
  pnlRole: string | null;
  split: boolean;
};

/** Filed lines per supplier that go into a request. */
export const JEV_HISTORY_PER_SUPPLIER = 5;

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

export type CompanyUsage = {
  calls: number;
  input_tokens: number;
  output_tokens: number;
  tagged: number;
  failed: number;
};

export type TagStore = {
  listWork(limit: number, companyId?: string | null): Promise<TagCompanyWork[]>;
  saveSuggestion(row: SuggestionRow): Promise<void>;
  prefill(write: PrefillWrite): Promise<void>;
  deleteSuggestion(transactionId: string, modelVersion: string): Promise<void>;
  /** A line Jev failed on. The job does not send it again until its retry time. */
  markFailed(companyId: string, transactionId: string, modelVersion: string): Promise<void>;
};

export type TagJobStore = {
  takeLease(runId: string, seconds: number): Promise<boolean>;
  releaseLease(runId: string): Promise<void>;
  /** Calls granted from today's cap, at most `want`. */
  reserveCalls(companyId: string, runId: string, want: number): Promise<number>;
  finishUsage(companyId: string, runId: string, usage: CompanyUsage): Promise<void>;
};

export type TagCaller = (apiKey: string, input: JevCall) => Promise<JevResult>;

export type TagReport = {
  companies: number;
  tagged: number;
  prefilled: number;
  skipped: number;
  failed: number;
  input_tokens: number;
  output_tokens: number;
  budget_skipped: number;
  cap_skipped: number;
};

export type TagRunOptions = {
  now?: () => number;
  budgetMs?: number;
  reserveMs?: number;
  log?: (line: string) => void;
  /** Filled per company: calls made, tokens, tagged and failed lines. */
  usage?: Map<string, CompanyUsage>;
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

/**
 * Amounts are context for the model. planTag does not write them back.
 * `past_filings` is how the owner filed the same supplier before, with the same ids the
 * questions offer; an archived project or hidden category comes through as a name of null.
 */
export function buildTagState(
  expense: TagExpense,
  projects: readonly TagProject[],
  categories: readonly TagCategory[],
): JevState {
  const state: Record<string, JsonValue> = {
    description: expense.description,
    doc_date: expense.docDate,
    direction: "expense",
    supplier: expense.supplierName,
    amount_gross: expense.amountGross,
    amount_net: expense.amountNet,
    vat_amount: expense.vatAmount,
  };
  const history = expense.history ?? [];
  if (history.length > 0) {
    const projectNames = new Map(projects.map((row) => [row.id, row.name]));
    const categoryNames = new Map(categories.map((row) => [row.id, row.name]));
    state.past_filings = history.slice(0, JEV_HISTORY_PER_SUPPLIER).map((filing) => ({
      doc_date: filing.docDate,
      description: filing.description,
      amount_net: filing.amountNet,
      project_id: filing.projectId,
      project_name: filing.projectId ? projectNames.get(filing.projectId) ?? null : null,
      category_id: filing.categoryId,
      category_name: filing.categoryId ? categoryNames.get(filing.categoryId) ?? null : null,
      pnl_role: filing.pnlRole,
      split: filing.split,
    }));
  }
  return state;
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
    || skipsProjectQuestion(expense);
}

/** Auto never writes one project on these lines, so the job does not ask for one. */
function skipsProjectQuestion(expense: TagExpense): boolean {
  return expense.pnlRole === "shared"
    || expense.pnlRole === "overhead"
    || expense.allocationCount > 1;
}

function withoutProject(answers: Record<string, unknown>): Record<string, unknown> {
  if (!("project" in answers)) return answers;
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(answers)) {
    if (key !== "project") rest[key] = value;
  }
  return rest;
}

export function planTag(
  expense: TagExpense,
  mode: TagMode,
  threshold: number,
  projects: readonly TagProject[],
  categories: readonly TagCategory[],
  answers: Record<string, unknown>,
): TagPlan {
  const askProject = !skipsProjectQuestion(expense);
  const questions = buildTagQuestions(askProject ? projects : [], categories);
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
  return { confidence, answers: askProject ? answers : withoutProject(answers), write: hasWrite ? write : null };
}

/** Non-finite, missing, and values below 1 use the default. Above the hard max clamps to it. */
export function clampTagLimit(value: unknown): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
    ? Number(value)
    : Number.NaN;
  if (!Number.isFinite(parsed)) return JEV_TAG_DEFAULT_LIMIT;
  const whole = Math.floor(parsed);
  if (whole < 1) return JEV_TAG_DEFAULT_LIMIT;
  return Math.min(JEV_TAG_MAX_LIMIT, whole);
}

/**
 * Equal shares of the cap, in the order of `companyIds`.
 * The first `cap % n` companies get one extra. The shares sum to the clamped cap.
 * The caller passes company ids in ascending order.
 */
export function companyQuotas(companyIds: readonly string[], cap: number): number[] {
  const limit = clampTagLimit(cap);
  const count = companyIds.length;
  if (count === 0) return [];
  const base = Math.floor(limit / count);
  const extra = limit % count;
  return companyIds.map((_, index) => base + (index < extra ? 1 : 0));
}

/** Newest doc_date, then id, then the clamped cap. The SQL query uses the same order and limit. */
export function capNewest(expenses: readonly TagExpense[], limit: number): TagExpense[] {
  const cap = clampTagLimit(limit);
  return expenses
    .slice()
    .sort((left, right) => right.docDate.localeCompare(left.docDate) || right.id.localeCompare(left.id))
    .slice(0, cap);
}

function emptyReport(companies = 0): TagReport {
  return {
    companies,
    tagged: 0,
    prefilled: 0,
    skipped: 0,
    failed: 0,
    input_tokens: 0,
    output_tokens: 0,
    budget_skipped: 0,
    cap_skipped: 0,
  };
}

export function emptyUsage(): CompanyUsage {
  return { calls: 0, input_tokens: 0, output_tokens: 0, tagged: 0, failed: 0 };
}

export function logTagRun(report: TagReport, log?: (line: string) => void): void {
  const line = [
    "jev-tag",
    `input_tokens=${report.input_tokens}`,
    `output_tokens=${report.output_tokens}`,
    `tagged=${report.tagged}`,
    `skipped=${report.skipped}`,
    `failed=${report.failed}`,
    `budget_skipped=${report.budget_skipped}`,
    `cap_skipped=${report.cap_skipped}`,
  ].join(" ");
  (log ?? ((message: string) => console.info(message)))(line);
}

function budgetSpent(started: number, budgetMs: number, now: number, reserveMs: number): boolean {
  if (!Number.isFinite(now) || !Number.isFinite(started) || !Number.isFinite(budgetMs) || !Number.isFinite(reserveMs)) {
    return true;
  }
  return budgetMs - (now - started) < reserveMs;
}

export async function tagWork(
  work: readonly TagCompanyWork[],
  store: Pick<TagStore, "saveSuggestion" | "prefill" | "deleteSuggestion"> & Partial<Pick<TagStore, "markFailed">>,
  call: TagCaller,
  apiKey: string,
  options: TagRunOptions = {},
): Promise<TagReport> {
  const report = emptyReport(work.length);
  const now = options.now ?? Date.now;
  const budgetMs = options.budgetMs ?? JEV_TAG_BUDGET_MS;
  const reserveMs = options.reserveMs ?? JEV_TAG_RESERVE_MS;
  const started = now();
  let stop = false;
  let outage = 0;
  const markFailed = async (expense: TagExpense) => {
    try {
      await store.markFailed?.(expense.companyId, expense.id, JEV_MODEL);
    } catch {
      // The line is sent again on the next run, within the daily cap.
    }
  };
  for (const company of work) {
    if (stop) {
      report.skipped += company.expenses.length;
      report.budget_skipped += company.expenses.length;
      continue;
    }
    if (Object.keys(buildTagQuestions(company.projects, company.categories)).length === 0) {
      report.skipped += company.expenses.length;
      continue;
    }
    const usage = options.usage
      ? options.usage.get(company.companyId) ?? emptyUsage()
      : emptyUsage();
    options.usage?.set(company.companyId, usage);
    for (const expense of company.expenses) {
      if (outage >= JEV_TAG_OUTAGE_STOP) {
        report.skipped += 1;
        stop = true;
        continue;
      }
      if (budgetSpent(started, budgetMs, now(), reserveMs)) {
        report.skipped += 1;
        report.budget_skipped += 1;
        stop = true;
        continue;
      }
      if (expense.companyId !== company.companyId) {
        report.failed += 1;
        continue;
      }
      const questions = buildTagQuestions(
        skipsProjectQuestion(expense) ? [] : company.projects,
        company.categories,
      );
      if (Object.keys(questions).length === 0) {
        report.skipped += 1;
        continue;
      }
      let result: JevResult;
      usage.calls += 1;
      try {
        result = await call(apiKey, {
          state: buildTagState(expense, company.projects, company.categories),
          questions,
        });
      } catch (error) {
        if (error instanceof JevError && (error.code === "unauthorized" || error.code === "missing_key")) {
          logTagRun(report, options.log);
          throw new TagStop(error.code);
        }
        report.failed += 1;
        usage.failed += 1;
        outage = error instanceof JevError && TRANSPORT_CODES.has(error.code) ? outage + 1 : 0;
        await markFailed(expense);
        continue;
      }
      outage = 0;
      if (result.usage) {
        report.input_tokens += result.usage.input_tokens;
        report.output_tokens += result.usage.output_tokens;
        usage.input_tokens += result.usage.input_tokens;
        usage.output_tokens += result.usage.output_tokens;
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
        usage.failed += 1;
        await markFailed(expense);
        continue;
      }
      if (!plan.write) {
        report.tagged += 1;
        usage.tagged += 1;
        continue;
      }
      try {
        await store.prefill(plan.write);
        report.tagged += 1;
        usage.tagged += 1;
        report.prefilled += 1;
      } catch {
        try {
          await store.deleteSuggestion(expense.id, JEV_MODEL);
        } catch {
          // The row stays. The next run will see the conflict and skip it.
        }
        await markFailed(expense);
        report.failed += 1;
        usage.failed += 1;
      }
    }
  }
  logTagRun(report, options.log);
  return report;
}

/** Either flag disables the connector. enabled false and mode off are the same outcome. */
export function connectorDisabled(enabled: unknown, mode: unknown): boolean {
  if (enabled !== true) return true;
  if (mode === "off") return true;
  return mode !== "shadow" && mode !== "auto";
}

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function integrationsPath(companyId?: string | null): string {
  const base = "/rest/v1/company_integrations?provider=eq.jev&select=company_id,enabled,mode,threshold";
  if (companyId && isUuid(companyId)) return `${base}&company_id=eq.${companyId}`;
  return base;
}

export function projectsPath(companyId: string): string {
  return `/rest/v1/projects?company_id=eq.${companyId}&status=eq.active&select=id,name`;
}

export function categoriesPath(companyId: string): string {
  return `/rest/v1/categories?company_id=eq.${companyId}&kind=eq.expense&hidden=eq.false&select=id,name`;
}

/**
 * Open untagged expenses, newest first, limited in SQL.
 * `tagged=is.null` with the model filter is the PostgREST anti-join: no
 * tag_suggestions row for the pin. `failed=is.null` skips a line Jev failed on
 * until its retry time (decision 0124). The URL does not list transaction ids.
 */
export function transactionsPath(companyId: string, limit: number, nowIso: string): string {
  const cap = clampTagLimit(limit);
  return [
    `/rest/v1/transactions?company_id=eq.${companyId}`,
    "direction=eq.expense",
    "removed_at=is.null",
    "review_queue.status=eq.open",
    "select=id,company_id,description,doc_date,supplier_id,amount_gross,amount_net,vat_amount,project_id,category_id,project_assigned,category_assigned,user_assigned,pnl_role,review_queue!inner(status),allocations(id),suppliers(name),tagged:tag_suggestions(),failed:jev_line_failures()",
    `tagged.model_version=eq.${JEV_MODEL}`,
    "tagged=is.null",
    `failed.model_version=eq.${JEV_MODEL}`,
    `failed.retry_after=gt.${encodeURIComponent(nowIso)}`,
    "failed=is.null",
    "order=doc_date.desc,id.desc",
    `limit=${cap}`,
  ].join("&");
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

function embeddedRows(value: unknown): RestRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isObject);
}

function expenseFromRow(row: RestRow, companyId: string): TagExpense[] {
  const queue = embeddedRows(row.review_queue);
  if (!queue.some((item) => item.status === "open")) return [];
  const tagged = row.tagged;
  if (tagged != null && (!Array.isArray(tagged) || tagged.length > 0)) return [];
  const failed = row.failed;
  if (failed != null && (!Array.isArray(failed) || failed.length > 0)) return [];
  const id = asString(row.id);
  const docDate = asString(row.doc_date);
  const rowCompany = asString(row.company_id);
  if (!id || !isUuid(id) || !docDate || rowCompany !== companyId) return [];
  const supplier = isObject(row.suppliers) ? asString(row.suppliers.name) : null;
  return [{
    id,
    companyId,
    description: asString(row.description) ?? "",
    docDate,
    supplierName: supplier,
    supplierId: asString(row.supplier_id),
    amountGross: asNumber(row.amount_gross),
    amountNet: asNumber(row.amount_net),
    vatAmount: asNumber(row.vat_amount),
    projectId: asString(row.project_id),
    categoryId: asString(row.category_id),
    projectAssigned: asBool(row.project_assigned),
    categoryAssigned: asBool(row.category_assigned),
    userAssigned: asBool(row.user_assigned),
    pnlRole: asString(row.pnl_role),
    allocationCount: embeddedRows(row.allocations).length,
  }];
}

function filingFromRow(row: RestRow): [string, TagFiling] | [] {
  const supplierId = asString(row.supplier_id);
  const docDate = asString(row.doc_date);
  const amountNet = asNumber(row.amount_net);
  if (!supplierId || !docDate || !Number.isFinite(amountNet)) return [];
  const projectId = asString(row.project_id);
  const categoryId = asString(row.category_id);
  return [supplierId, {
    docDate,
    description: (asString(row.description) ?? "").slice(0, 120),
    amountNet,
    projectId: projectId && isUuid(projectId) ? projectId : null,
    categoryId: categoryId && isUuid(categoryId) ? categoryId : null,
    pnlRole: asString(row.pnl_role),
    split: asBool(row.split),
  }];
}

/** One SQL call per company: the newest filed lines of each supplier in the run (decision 0127). */
async function attachHistory(
  fetch: FetchLike,
  base: string,
  serviceKey: string,
  companyId: string,
  expenses: TagExpense[],
): Promise<void> {
  const suppliers = [...new Set(expenses.flatMap((expense) =>
    expense.supplierId && isUuid(expense.supplierId) ? [expense.supplierId] : []
  ))].sort();
  if (suppliers.length === 0) return;
  const filed = rows(await rest(fetch, `${base}/rest/v1/rpc/jev_supplier_history`, serviceKey, {
    method: "POST",
    body: { p_company: companyId, p_suppliers: suppliers, p_per: JEV_HISTORY_PER_SUPPLIER },
  }));
  const bySupplier = new Map<string, TagFiling[]>();
  for (const row of filed) {
    const entry = filingFromRow(row);
    if (entry.length === 0) continue;
    const [supplierId, filing] = entry;
    const list = bySupplier.get(supplierId) ?? [];
    list.push(filing);
    bySupplier.set(supplierId, list);
  }
  for (const expense of expenses) {
    if (!expense.supplierId) continue;
    const list = bySupplier.get(expense.supplierId);
    if (list) expense.history = list.slice(0, JEV_HISTORY_PER_SUPPLIER);
  }
}

type EnabledCompany = { companyId: string; mode: TagMode; threshold: number };

function enabledCompanies(integrations: readonly RestRow[], onlyCompanyId?: string | null): EnabledCompany[] {
  const seen = new Set<string>();
  const enabled: EnabledCompany[] = [];
  for (const integration of integrations) {
    const companyId = asString(integration.company_id);
    const mode = integration.mode === "auto" || integration.mode === "shadow" ? integration.mode : null;
    const threshold = asNumber(integration.threshold);
    if (!companyId || !isUuid(companyId) || connectorDisabled(integration.enabled, integration.mode) || !mode || !Number.isFinite(threshold)) {
      continue;
    }
    if (onlyCompanyId && companyId !== onlyCompanyId) continue;
    if (seen.has(companyId)) continue;
    seen.add(companyId);
    enabled.push({ companyId, mode, threshold });
  }
  enabled.sort((left, right) => left.companyId.localeCompare(right.companyId));
  return enabled;
}

export function createTagStore(
  fetch: FetchLike,
  supabaseUrl: string,
  serviceKey: string,
  now: () => number = Date.now,
): TagStore {
  const base = supabaseUrl.replace(/\/+$/, "");
  const get = (path: string) => rest(fetch, `${base}${path}`, serviceKey, { method: "GET" });

  return {
    async listWork(limit: number, onlyCompanyId?: string | null): Promise<TagCompanyWork[]> {
      const integrations = rows(await get(integrationsPath(onlyCompanyId)));
      const enabled = enabledCompanies(integrations, onlyCompanyId);
      const quotas = companyQuotas(enabled.map((company) => company.companyId), limit);
      const work: TagCompanyWork[] = [];
      for (let index = 0; index < enabled.length; index += 1) {
        const quota = quotas[index] ?? 0;
        if (quota < 1) continue;
        const company = enabled[index];
        const projects = rows(await get(projectsPath(company.companyId))).flatMap((row) => {
          const id = asString(row.id);
          const name = asString(row.name);
          return id && name ? [{ id, name }] : [];
        });
        const categories = rows(await get(categoriesPath(company.companyId))).flatMap((row) => {
          const id = asString(row.id);
          const name = asString(row.name);
          return id && name ? [{ id, name }] : [];
        });
        const transactions = rows(await get(transactionsPath(company.companyId, quota, new Date(now()).toISOString())));
        const loaded = transactions.flatMap((row) => expenseFromRow(row, company.companyId));
        const expenses = capNewest(loaded, quota);
        await attachHistory(fetch, base, serviceKey, company.companyId, expenses);
        work.push({
          companyId: company.companyId,
          mode: company.mode,
          threshold: company.threshold,
          projects,
          categories,
          expenses,
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

    async markFailed(companyId: string, transactionId: string, modelVersion: string): Promise<void> {
      await rest(fetch, `${base}/rest/v1/rpc/jev_mark_failed`, serviceKey, {
        method: "POST",
        body: { p_company: companyId, p_transaction: transactionId, p_model: modelVersion },
      });
    },
  };
}

/** The lease and the daily cap live in SQL (decision 0124). */
export function createTagJobStore(fetch: FetchLike, supabaseUrl: string, serviceKey: string): TagJobStore {
  const base = supabaseUrl.replace(/\/+$/, "");
  const rpc = (name: string, body: JsonObject) =>
    rest(fetch, `${base}/rest/v1/rpc/${name}`, serviceKey, { method: "POST", body });
  return {
    async takeLease(runId: string, seconds: number): Promise<boolean> {
      return (await rpc("jev_take_lease", { p_holder: runId, p_seconds: seconds })) === true;
    },
    async releaseLease(runId: string): Promise<void> {
      await rpc("jev_release_lease", { p_holder: runId });
    },
    async reserveCalls(companyId: string, runId: string, want: number): Promise<number> {
      const granted = asNumber(await rpc("jev_reserve_calls", { p_company: companyId, p_run: runId, p_want: want }));
      if (!Number.isInteger(granted) || granted < 0) throw new Error("store");
      return Math.min(granted, want);
    },
    async finishUsage(companyId: string, runId: string, usage: CompanyUsage): Promise<void> {
      await rpc("jev_finish_usage", {
        p_company: companyId,
        p_run: runId,
        p_calls: usage.calls,
        p_input_tokens: usage.input_tokens,
        p_output_tokens: usage.output_tokens,
        p_tagged: usage.tagged,
        p_failed: usage.failed,
      });
    },
  };
}

/**
 * Reserve each company's calls from its daily cap and keep only that many lines,
 * newest first. Lines over the cap are `cap_skipped` and wait for tomorrow's cap.
 */
export async function applyDailyCap(
  work: readonly TagCompanyWork[],
  jobs: Pick<TagJobStore, "reserveCalls">,
  runId: string,
  reserved: string[] = [],
): Promise<{ work: TagCompanyWork[]; capSkipped: number; reserved: string[] }> {
  const kept: TagCompanyWork[] = [];
  let capSkipped = 0;
  for (const company of work) {
    const want = company.expenses.length;
    if (want === 0) continue;
    // Listed before the reserve, so a later throw still finishes this company's row.
    // Finishing a company with no row is a no-op.
    if (!reserved.includes(company.companyId)) reserved.push(company.companyId);
    const granted = await jobs.reserveCalls(company.companyId, runId, want);
    capSkipped += want - granted;
    if (granted < 1) continue;
    kept.push({ ...company, expenses: company.expenses.slice(0, granted) });
  }
  return { work: kept, capSkipped, reserved };
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

export type TagRateState = { lastAt: number };

export function allowTagRun(
  state: TagRateState,
  now: number,
  intervalMs = JEV_TAG_INTERVAL_MS,
): { ok: true } | { ok: false; retryAfterSeconds: number } {
  if (!Number.isFinite(now) || intervalMs < 1) {
    return { ok: false, retryAfterSeconds: 60 };
  }
  if (state.lastAt >= 0 && now - state.lastAt < intervalMs) {
    const retryAfterSeconds = Math.max(1, Math.ceil((intervalMs - (now - state.lastAt)) / 1000));
    return { ok: false, retryAfterSeconds };
  }
  state.lastAt = now;
  return { ok: true };
}

const tagRateState: TagRateState = { lastAt: -1 };

export type JevTagDeps = {
  fetch: FetchLike;
  /** Run id for the lease and the usage log. Defaults to a random UUID. */
  runId?: () => string;
  env(name: string): string;
  readKey?: (source: { fetch: FetchLike; supabaseUrl: string; serviceKey: string }) => Promise<string>;
  call?: TagCaller;
  now?: () => number;
  rateState?: TagRateState;
  intervalMs?: number;
  log?: (line: string) => void;
};

/** Hosted functions inject SUPABASE_SECRET_KEYS. The legacy service-role env var is ignored. */
export function serviceRoleKey(env: (name: string) => string): string {
  return readJsonKey(env("SUPABASE_SECRET_KEYS"), "default");
}

function readJsonKey(raw: string, field: string): string {
  if (raw.trim() === "") return "";
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const value = parsed[field];
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

export function tagJevCall(fetchImpl: FetchLike, timer?: JevTimer): TagCaller {
  return (apiKey, input) => callJev(apiKey, input, {
    fetch: fetchImpl,
    timer,
    timeoutMs: JEV_TIMEOUT_MS,
    maxAttempts: JEV_TAG_ATTEMPTS,
  });
}

type TagRequest = { limit: number; companyId: string | null; error: string | null };

export async function readTagRequest(req: Request): Promise<TagRequest> {
  const text = await req.text();
  if (text.trim() === "") return { limit: JEV_TAG_DEFAULT_LIMIT, companyId: null, error: null };
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { limit: JEV_TAG_DEFAULT_LIMIT, companyId: null, error: "invalid_request" };
  }
  if (!isObject(body)) return { limit: JEV_TAG_DEFAULT_LIMIT, companyId: null, error: "invalid_request" };
  const rawCompany = body.company_id;
  if (rawCompany !== undefined && rawCompany !== null) {
    if (typeof rawCompany !== "string" || !isUuid(rawCompany)) {
      return { limit: JEV_TAG_DEFAULT_LIMIT, companyId: null, error: "invalid_request" };
    }
  }
  const companyId = typeof rawCompany === "string" ? rawCompany : null;
  const limit = body.limit === undefined ? JEV_TAG_DEFAULT_LIMIT : clampTagLimit(body.limit);
  return { limit, companyId, error: null };
}

function bearerToken(header: string): string {
  const match = /^Bearer\s+(\S+)/i.exec(header);
  return match?.[1] ?? "";
}

/** Cron secret or the service-role key. A user or anon JWT is neither. */
export function tagCallerKind(input: {
  cronHeader: string;
  cronSecret: string;
  authorization: string;
  serviceKey: string;
}): "cron" | "service" | null {
  const cronOk = input.cronSecret.trim() !== ""
    && input.cronHeader.trim() !== ""
    && constantTimeEqual(input.cronHeader, input.cronSecret);
  if (cronOk) return "cron";
  const bearer = bearerToken(input.authorization);
  const serviceOk = input.serviceKey.trim() !== ""
    && bearer !== ""
    && constantTimeEqual(bearer, input.serviceKey);
  if (serviceOk) return "service";
  return null;
}

export async function handleJevTag(req: Request, deps: JevTagDeps): Promise<Response> {
  if (req.method === "OPTIONS") return empty();
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const cronSecret = deps.env("CRON_SECRET");
  const serviceKey = serviceRoleKey(deps.env);
  const kind = tagCallerKind({
    cronHeader: req.headers.get("x-flow-cron") ?? "",
    cronSecret,
    authorization: req.headers.get("authorization") ?? "",
    serviceKey,
  });
  if (kind === null) return json({ error: "unauthorized" }, 401);
  const supabaseUrl = deps.env("SUPABASE_URL");
  if (supabaseUrl.trim() === "" || serviceKey.trim() === "") return json({ error: "missing_key" }, 500);
  const requested = await readTagRequest(req);
  if (requested.error) return json({ error: requested.error }, 400);
  const gate = allowTagRun(deps.rateState ?? tagRateState, deps.now ? deps.now() : Date.now(), deps.intervalMs);
  if (!gate.ok) {
    const response = json({ error: "rate_limited", retry_after_seconds: gate.retryAfterSeconds }, 429);
    response.headers.set("retry-after", String(gate.retryAfterSeconds));
    return response;
  }
  const readKey = deps.readKey ?? readJevApiKey;
  const call = deps.call ?? tagJevCall(deps.fetch);
  const jobs = createTagJobStore(deps.fetch, supabaseUrl, serviceKey);
  const runId = (deps.runId ?? (() => crypto.randomUUID()))();
  try {
    if (!(await jobs.takeLease(runId, JEV_TAG_LEASE_SECONDS))) {
      return json({ error: "busy" }, 409);
    }
  } catch {
    return json({ error: "tag_failed" }, 500);
  }
  const usage = new Map<string, CompanyUsage>();
  const reserved: string[] = [];
  try {
    const store = createTagStore(deps.fetch, supabaseUrl, serviceKey, deps.now);
    const listed = await store.listWork(requested.limit, requested.companyId);
    const capped = await applyDailyCap(listed, jobs, runId, reserved);
    const pending = capped.work.reduce((sum, company) => sum + company.expenses.length, 0);
    if (pending === 0) {
      const report = emptyReport(listed.length);
      report.skipped = capped.capSkipped;
      report.cap_skipped = capped.capSkipped;
      logTagRun(report, deps.log);
      return json({ ok: true, ...report });
    }
    const apiKey = await readKey({ fetch: deps.fetch, supabaseUrl, serviceKey });
    const report = await tagWork(capped.work, store, call, apiKey, {
      now: deps.now,
      log: deps.log,
      usage,
    });
    report.companies = listed.length;
    report.skipped += capped.capSkipped;
    report.cap_skipped = capped.capSkipped;
    return json({ ok: true, ...report });
  } catch (error) {
    if (error instanceof TagStop) return json({ error: error.code }, 500);
    if (error instanceof JevError && error.code === "missing_key") return json({ error: "missing_key" }, 500);
    return json({ error: "tag_failed" }, 500);
  } finally {
    // A reservation with no finish keeps counting in full for the day, which is the safe side.
    for (const companyId of reserved) {
      try {
        await jobs.finishUsage(companyId, runId, usage.get(companyId) ?? emptyUsage());
      } catch {
        // The reservation stays counted.
      }
    }
    try {
      await jobs.releaseLease(runId);
    } catch {
      // The lease expires on its own.
    }
  }
}
