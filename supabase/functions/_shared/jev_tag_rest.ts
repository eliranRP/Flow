// Tagging job: the PostgREST store that reads work and writes suggestions.
// Split out of jev_tag.ts (FLOW-807). Decisions 0084 and 0124.

import { JEV_MODEL, type FetchLike, type JsonValue } from "./jev.ts";
import {
  capNewest,
  clampTagLimit,
  companyQuotas,
  type CompanyUsage,
  isObject,
  JEV_HISTORY_PER_SUPPLIER,
  type JsonObject,
  lineDirection,
  type PrefillWrite,
  StoreConflict,
  type SuggestionRow,
  type TagCompanyWork,
  type TagDirection,
  type TagExpense,
  type TagFiling,
  type TagFlag,
  type TagJobStore,
  type TagMode,
  type TagProject,
  type TagStore,
  UUID_RE,
} from "./jev_tag_plan.ts";

/** Either flag disables the connector. enabled false and mode off are the same outcome. */
export function connectorDisabled(enabled: unknown, mode: unknown): boolean {
  if (enabled !== true) return true;
  if (mode === "off") return true;
  return mode !== "shadow" && mode !== "auto";
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function integrationsPath(companyId?: string | null): string {
  const base = "/rest/v1/company_integrations?provider=eq.jev&select=company_id,enabled,mode,threshold";
  if (companyId && isUuid(companyId)) return `${base}&company_id=eq.${companyId}`;
  return base;
}

export function categoriesPath(companyId: string, kind: TagDirection = "expense"): string {
  return `/rest/v1/categories?company_id=eq.${companyId}&kind=eq.${kind}&hidden=eq.false&select=id,name`;
}

/**
 * Open untagged lines (expense and income), newest first, limited in SQL.
 * `tagged=is.null` with the model filter is the PostgREST anti-join: no
 * tag_suggestions row for the pin. `failed=is.null` skips a line Jev failed on
 * until its retry time (decision 0124). The URL does not list transaction ids.
 */
export function transactionsPath(companyId: string, limit: number, nowIso: string): string {
  const cap = clampTagLimit(limit);
  return [
    `/rest/v1/transactions?company_id=eq.${companyId}`,
    "removed_at=is.null",
    "review_queue.status=eq.open",
    "select=id,company_id,direction,description,doc_date,supplier_id,customer_id,amount_gross,amount_net,vat_amount,project_id,category_id,project_assigned,category_assigned,user_assigned,pnl_role,source,card_last4:provider_meta->>card_last4,account_id:provider_meta->>account_id,review_queue!inner(status),allocations(id),suppliers(name),customers(name),tagged:tag_suggestions(),failed:jev_line_failures()",
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
  const income = row.direction === "income";
  // The party is the supplier, else the customer, as SQL reads it (coalesce(supplier_id,
  // customer_id) for the history and the flags), so an income refund from a supplier keeps it.
  const supplierName = isObject(row.suppliers) ? asString(row.suppliers.name) : null;
  const customerName = isObject(row.customers) ? asString(row.customers.name) : null;
  const supplierId = asString(row.supplier_id);
  const customerId = asString(row.customer_id);
  return [{
    id,
    companyId,
    description: asString(row.description) ?? "",
    docDate,
    direction: income ? "income" : "expense",
    supplierName: supplierId ? supplierName : customerId ? customerName : supplierName ?? customerName,
    supplierId: supplierId ?? customerId,
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
    cardLast4: cardLast4Of(row.card_last4),
    source: asString(row.source),
    accountId: asString(row.account_id),
  }];
}

function cardLast4Of(value: unknown): string | null {
  const text = asString(value);
  return text && /^[0-9]{4}$/.test(text) ? text : null;
}

export function cardLabelsPath(companyId: string): string {
  return `/rest/v1/connector_connections?company_id=eq.${companyId}&select=provider,card_labels,account_labels`;
}

/** An account label as get_line_meta shows it: masked digits and long numbers dropped. */
export function tidyAccountLabel(label: string): string | null {
  const tidy = label.replace(/\s*(••|\*\*)[*0-9]*/g, "").replace(/[0-9]{5,}/g, "").trim();
  return tidy === "" ? null : tidy.slice(0, 80);
}

/**
 * The names the owner gave the paying card and the bank account (FLOW-707), signals for the
 * project and the category. One read per company, only when a line has a card or an account.
 * A failed read sends no names.
 */
async function attachBankNames(
  get: (path: string) => Promise<unknown>,
  companyId: string,
  expenses: TagExpense[],
): Promise<void> {
  if (!expenses.some((expense) => expense.cardLast4 || expense.accountId)) return;
  let connections: RestRow[];
  try {
    connections = rows(await get(cardLabelsPath(companyId)));
  } catch {
    return;
  }
  // Keyed by the connection's provider, so a name only reaches lines from that provider, as
  // get_line_meta matches them. The sync redacts each name before storing it.
  const cards = new Map<string, string>();
  const accounts = new Map<string, string>();
  for (const connection of connections) {
    const provider = asString(connection.provider);
    if (!provider) continue;
    for (const label of embeddedRows(connection.card_labels)) {
      const last4 = cardLast4Of(label.last4);
      const name = asString(label.label)?.trim().slice(0, 80);
      const key = `${provider}:${last4}`;
      if (last4 && name && !cards.has(key)) cards.set(key, name);
    }
    for (const label of embeddedRows(connection.account_labels)) {
      const id = asString(label.id);
      const text = asString(label.label);
      const name = text ? tidyAccountLabel(text) : null;
      const key = `${provider}:${id}`;
      if (id && name && !accounts.has(key)) accounts.set(key, name);
    }
  }
  for (const expense of expenses) {
    if (!expense.source) continue;
    const card = expense.cardLast4 ? cards.get(`${expense.source}:${expense.cardLast4}`) : undefined;
    if (card) expense.cardName = card;
    const account = expense.accountId ? accounts.get(`${expense.source}:${expense.accountId}`) : undefined;
    if (account) expense.accountName = account;
  }
}

function uuidOrNull(value: unknown): string | null {
  const text = asString(value);
  return text && isUuid(text) ? text : null;
}

/** jev_projects: active projects, and finished ones that have a last line date. */
function projectFromRow(row: RestRow): TagProject[] {
  const id = asString(row.id);
  const name = asString(row.name);
  if (!id || !name) return [];
  const finished = row.status === "finished";
  const lastDocDate = asString(row.last_doc_date);
  if (finished && !lastDocDate) return [];
  const project: TagProject = { id, name };
  if (finished) {
    project.finished = true;
    project.lastDocDate = lastDocDate;
  }
  if (row.overhead === true) project.overhead = true;
  return [project];
}

function filingFromRow(row: RestRow): [string, TagFiling] | [] {
  const supplierId = asString(row.supplier_id);
  const docDate = asString(row.doc_date);
  const amountNet = asNumber(row.amount_net);
  if (!supplierId || !docDate || !Number.isFinite(amountNet)) return [];
  const projectId = asString(row.project_id);
  const categoryId = asString(row.category_id);
  const filing: TagFiling = {
    docDate,
    description: (asString(row.description) ?? "").slice(0, 120),
    amountNet,
    projectId: projectId && isUuid(projectId) ? projectId : null,
    categoryId: categoryId && isUuid(categoryId) ? categoryId : null,
    pnlRole: asString(row.pnl_role),
    split: asBool(row.split),
    direction: row.direction === "income" ? "income" : "expense",
  };
  const jevProjectId = uuidOrNull(row.jev_project_id);
  const jevCategoryId = uuidOrNull(row.jev_category_id);
  if (jevProjectId || jevCategoryId) {
    filing.jevProjectId = jevProjectId;
    filing.jevCategoryId = jevCategoryId;
    filing.jevCorrected = asBool(row.jev_corrected);
  }
  return [supplierId, filing];
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
    const direction = lineDirection(expense);
    const list = (bySupplier.get(expense.supplierId) ?? []).filter((filing) =>
      (filing.direction ?? "expense") === direction
    );
    if (list.length > 0) expense.history = list.slice(0, JEV_HISTORY_PER_SUPPLIER);
  }
}

/** One SQL call per company: the anomaly flags of the lines in the run (decision 0134). A failed read skips scores. */
async function attachFlags(
  fetch: FetchLike,
  base: string,
  serviceKey: string,
  companyId: string,
  expenses: TagExpense[],
): Promise<void> {
  const ids = expenses.map((expense) => expense.id).filter(isUuid);
  if (ids.length === 0) return;
  let flagged: RestRow[];
  try {
    flagged = rows(await rest(fetch, `${base}/rest/v1/rpc/jev_line_flags`, serviceKey, {
      method: "POST",
      body: { p_company: companyId, p_ids: ids },
    }));
  } catch {
    // Scores are extra. Without the flags the lines are still tagged, just not scored.
    return;
  }
  const byLine = new Map<string, TagFlag[]>();
  for (const row of flagged) {
    const id = asString(row.transaction_id);
    const kind = asString(row.kind);
    if (!id || !kind) continue;
    const detail: Record<string, JsonValue> = {};
    for (const [key, value] of Object.entries(row)) {
      if (key === "transaction_id" || key === "kind" || key.endsWith("transaction_id")) continue;
      if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") detail[key] = value;
    }
    const list = byLine.get(id) ?? [];
    list.push({ kind, detail });
    byLine.set(id, list);
  }
  for (const expense of expenses) {
    const list = byLine.get(expense.id);
    if (list) expense.flags = list;
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
        const projects = rows(await rest(fetch, `${base}/rest/v1/rpc/jev_projects`, serviceKey, {
          method: "POST",
          body: { p_company: company.companyId },
        })).flatMap(projectFromRow);
        const categories = rows(await get(categoriesPath(company.companyId))).flatMap((row) => {
          const id = asString(row.id);
          const name = asString(row.name);
          return id && name ? [{ id, name }] : [];
        });
        const transactions = rows(await get(transactionsPath(company.companyId, quota, new Date(now()).toISOString())));
        const loaded = transactions.flatMap((row) => expenseFromRow(row, company.companyId));
        const expenses = capNewest(loaded, quota);
        await attachHistory(fetch, base, serviceKey, company.companyId, expenses);
        await attachFlags(fetch, base, serviceKey, company.companyId, expenses);
        await attachBankNames(get, company.companyId, expenses);
        const incomeCategories = expenses.some((expense) => expense.direction === "income")
          ? rows(await get(categoriesPath(company.companyId, "income"))).flatMap((row) => {
            const id = asString(row.id);
            const name = asString(row.name);
            return id && name ? [{ id, name }] : [];
          })
          : [];
        work.push({
          companyId: company.companyId,
          mode: company.mode,
          threshold: company.threshold,
          projects,
          categories,
          incomeCategories,
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

    async prefill(write: PrefillWrite): Promise<boolean> {
      // One SQL transaction: the project, its allocation (amount from the line) and the
      // category, only while the line is open and the owner has not set them (decision 0139),
      // never on a line SQL flags unless Jev scored the flag below 0.5, with an audit row (0145).
      const result = await rest(fetch, `${base}/rest/v1/rpc/jev_prefill`, serviceKey, {
        method: "POST",
        body: {
          p_company: write.companyId,
          p_transaction: write.transactionId,
          p_project: write.projectId ?? null,
          p_category: write.categoryId ?? null,
          p_model: write.modelVersion,
          p_confidence: write.confidence,
        },
      });
      // An answer SQL did not give says nothing was written: never count it as pre-filled.
      if (!isObject(result)) return false;
      return result.project === true || result.category === true;
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
