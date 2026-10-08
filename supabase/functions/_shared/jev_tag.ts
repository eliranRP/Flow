// Tagging job. Decisions 0084 and 0124.
// Off does not call Jev. Shadow stores a suggestion. Auto at or above the
// threshold pre-fills a project and category the user has not set, marks that
// fill as a suggestion, and leaves the line in לאישור. Nothing here approves.
// A database lease lets one run at a time, and each company's calls are reserved
// from its daily cap in SQL before Jev is called (decision 0124).

import { JEV_MODEL, JEV_TIMEOUT_MS, JevError, callJev, type FetchLike, type JevResult, type JevTimer } from "./jev.ts";
import { readJevApiKey } from "./jev_key.ts";
import { empty, json } from "./http.ts";
import {
  buildTagQuestions,
  buildTagState,
  clampTagLimit,
  type CompanyUsage,
  isObject,
  JEV_TAG_ATTEMPTS,
  JEV_TAG_BUDGET_MS,
  JEV_TAG_DEFAULT_LIMIT,
  JEV_TAG_INTERVAL_MS,
  JEV_TAG_LEASE_SECONDS,
  JEV_TAG_OUTAGE_STOP,
  JEV_TAG_RESERVE_MS,
  lineCategories,
  lineProjects,
  lineQuestions,
  planTag,
  StoreConflict,
  type TagCaller,
  type TagCompanyWork,
  type TagExpense,
  type TagJobStore,
  type TagReport,
  type TagRunOptions,
  TagStop,
  type TagStore,
  TRANSPORT_CODES,
} from "./jev_tag_plan.ts";
import { createTagJobStore, createTagStore, isUuid } from "./jev_tag_rest.ts";

// Moved to their own files (FLOW-807). Import from those files in new code.
export {
  JEV_TAG_DEFAULT_LIMIT,
  JEV_TAG_MAX_LIMIT,
  JEV_TAG_ATTEMPTS,
  JEV_TAG_BUDGET_MS,
  JEV_TAG_RESERVE_MS,
  JEV_TAG_INTERVAL_MS,
  JEV_TAG_OUTAGE_STOP,
  JEV_TAG_LEASE_SECONDS,
  type TagMode,
  type TagProject,
  JEV_NO_PROJECT,
  type TagCategory,
  type TagExpense,
  type TagDirection,
  type TagFlag,
  type TagFiling,
  JEV_HISTORY_PER_SUPPLIER,
  type TagCompanyWork,
  type SuggestionRow,
  type PrefillWrite,
  type TagPlan,
  StoreConflict,
  TagStop,
  type CompanyUsage,
  type TagStore,
  type TagJobStore,
  type TagCaller,
  type TagReport,
  type TagRunOptions,
  buildTagQuestions,
  lineQuestions,
  lineProjects,
  buildTagState,
  planTag,
  clampTagLimit,
  companyQuotas,
  capNewest,
} from "./jev_tag_plan.ts";
export {
  connectorDisabled,
  integrationsPath,
  categoriesPath,
  transactionsPath,
  createTagStore,
  createTagJobStore,
} from "./jev_tag_rest.ts";

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
    if (
      Object.keys(buildTagQuestions(company.projects, company.categories)).length === 0
      && Object.keys(buildTagQuestions(company.projects, company.incomeCategories ?? [])).length === 0
    ) {
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
      const questions = lineQuestions(expense, company);
      if (Object.keys(questions).length === 0) {
        report.skipped += 1;
        continue;
      }
      let result: JevResult;
      usage.calls += 1;
      try {
        result = await call(apiKey, {
          state: buildTagState(expense, company.projects, lineCategories(expense, company)),
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
        lineProjects(expense, company),
        lineCategories(expense, company),
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
        const wrote = await store.prefill(plan.write);
        report.tagged += 1;
        usage.tagged += 1;
        // False: the line closed or the owner set it meanwhile. The suggestion stays on the card.
        if (wrote !== false) report.prefilled += 1;
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
