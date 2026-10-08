// Shared ids, line and filing builders, and the in-memory store for the Jev tagging tests (split out of jev_tag_test.ts, FLOW-807).
import {
  StoreConflict,
  type PrefillWrite,
  type SuggestionRow,
  type TagCompanyWork,
  type TagExpense,
  type TagFiling,
  type TagStore,
} from "./jev_tag.ts";

export const PROJECT = "11111111-1111-4111-8111-111111111111";
export const OTHER = "22222222-2222-4222-8222-222222222222";
export const CATEGORY = "33333333-3333-4333-8333-333333333333";
export const EXPENSE = "44444444-4444-4444-8444-444444444444";
export const COMPANY = "55555555-5555-4555-8555-555555555555";
export const NOW_ISO = "2026-10-08T05:00:00.000Z";

export function expense(overrides: Partial<TagExpense> = {}): TagExpense {
  return {
    id: EXPENSE,
    companyId: COMPANY,
    description: "מלט",
    docDate: "2026-04-12",
    supplierName: "מחסן",
    amountGross: -11800,
    amountNet: -10000,
    vatAmount: -1800,
    projectId: null,
    categoryId: null,
    projectAssigned: false,
    categoryAssigned: false,
    userAssigned: false,
    pnlRole: "project",
    allocationCount: 0,
    ...overrides,
  };
}

export function txnRow(overrides: Record<string, unknown> = {}) {
  return {
    id: EXPENSE,
    company_id: COMPANY,
    description: "מלט",
    doc_date: "2026-04-12",
    supplier_id: null,
    amount_gross: -11800,
    amount_net: -10000,
    vat_amount: -1800,
    project_id: null,
    category_id: null,
    project_assigned: false,
    category_assigned: false,
    user_assigned: false,
    pnl_role: "project",
    review_queue: [{ status: "open" }],
    allocations: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab" }],
    suppliers: { name: "מחסן" },
    tagged: null,
    ...overrides,
  };
}

export const projects = [
  { id: PROJECT, name: "שיפוץ" },
  { id: OTHER, name: "מחסן" },
];
export const categories = [{ id: CATEGORY, name: "חומרים" }];

export function answers(projectConfidence = 0.95, categoryConfidence = 0.95) {
  return {
    project: { type: "choice", choice: PROJECT, confidence: projectConfidence, probabilities: { [PROJECT]: projectConfidence } },
    category: {
      type: "choice",
      choice: CATEGORY,
      confidence: categoryConfidence,
      probabilities: null,
    },
    amount_gross: 1,
  };
}

export function filing(overrides: Partial<TagFiling> = {}): TagFiling {
  return {
    docDate: "2026-03-01",
    description: "מלט",
    amountNet: -9000,
    projectId: PROJECT,
    categoryId: CATEGORY,
    pnlRole: "project",
    split: false,
    direction: "expense",
    ...overrides,
  };
}

export function memoryStore(): TagStore & { suggestions: SuggestionRow[]; writes: PrefillWrite[]; failPrefill: boolean; failed: string[] } {
  const suggestions: SuggestionRow[] = [];
  const writes: PrefillWrite[] = [];
  const store = {
    suggestions,
    writes,
    failPrefill: false,
    listWork: () => Promise.resolve([]),
    saveSuggestion: (row: SuggestionRow) => {
      if (suggestions.some((saved) => saved.transactionId === row.transactionId && saved.modelVersion === row.modelVersion)) {
        return Promise.reject(new StoreConflict());
      }
      suggestions.push(row);
      return Promise.resolve();
    },
    prefill: (write: PrefillWrite) => {
      if (store.failPrefill) return Promise.reject(new Error("store"));
      writes.push(write);
      return Promise.resolve();
    },
    deleteSuggestion: (transactionId: string, modelVersion: string) => {
      const index = suggestions.findIndex((row) => row.transactionId === transactionId && row.modelVersion === modelVersion);
      if (index >= 0) suggestions.splice(index, 1);
      return Promise.resolve();
    },
    failed: [] as string[],
    markFailed: (_companyId: string, transactionId: string) => {
      store.failed.push(transactionId);
      return Promise.resolve();
    },
  };
  return store;
}

export function company(overrides: Partial<TagCompanyWork> = {}): TagCompanyWork {
  return {
    companyId: COMPANY,
    mode: "auto",
    threshold: 0.9,
    projects,
    categories,
    expenses: [expense()],
    ...overrides,
  };
}

export function tagEnv(name: string): string {
  if (name === "CRON_SECRET") return "cron-test";
  if (name === "SUPABASE_URL") return "http://db.test";
  if (name === "SUPABASE_SECRET_KEYS") return JSON.stringify({ default: "service-role-test" });
  return "";
}

/** Lets the job's lease and cap RPCs succeed: the lease is free and the cap grants every call. */
export function withJobs(fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): typeof globalThis.fetch {
  return (input, init) => {
    const url = String(input);
    if (url.endsWith("/rpc/jev_take_lease")) return Promise.resolve(Response.json(true));
    if (url.endsWith("/rpc/jev_reserve_calls")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { p_want?: number };
      return Promise.resolve(Response.json(body.p_want ?? 0));
    }
    if (/\/rpc\/jev_(release_lease|finish_usage|mark_failed)$/.test(url)) {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return fetch(input, init);
  };
}

export const INCOME_CATEGORY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const incomeCategories = [{ id: INCOME_CATEGORY, name: "הכנסות" }];

export function incomeAnswers(confidence = 0.97) {
  return {
    project: { type: "choice", choice: PROJECT, confidence },
    category: { type: "choice", choice: INCOME_CATEGORY, confidence },
  };
}
