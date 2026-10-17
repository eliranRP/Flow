import type { Page, Route } from "@playwright/test";
import { demoCategories, demoDashboard, demoProject, demoTransaction, demoUnpaid } from "../src/demo/model";

/**
 * FLOW-804: the perf build talks to this address (playwright.perf.config.ts). Nothing listens
 * there; every request to it is answered here from the demo books (invented names), so a timing
 * covers the app's code and render and none of it reaches a real server.
 */
export const STUB_URL = "http://127.0.0.1:43199";
export const STUB_ANON_KEY = "perf-stub-anon-key";

/** The wire form of a read: bigints go out as strings, as PostgREST sends numerics. */
function wire(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => (typeof item === "bigint" ? item.toString() : item));
}

function rpcName(url: string): string | null {
  return /\/rest\/v1\/rpc\/([^/?]+)/.exec(url)?.[1] ?? null;
}

function rpcBody(name: string, args: Record<string, unknown>): unknown {
  const from = typeof args.p_from === "string" ? args.p_from : null;
  const to = typeof args.p_to === "string" ? args.p_to : null;
  switch (name) {
    case "get_dashboard":
      return demoDashboard(from, to, "invoiced");
    case "get_project":
      return demoProject(typeof args.p_id === "string" ? args.p_id : "");
    case "project_cash_months":
      return projectCash();
    case "project_cash_years":
      return projectCashYears();
    case "projects_cash_month":
      return projectsCashMonth();
    case "list_unpaid":
      return demoUnpaid();
    case "list_review":
      return reviewCards();
    case "approve_review_item":
      return { ok: true };
    case "list_categories":
      return demoCategories();
    case "get_transaction":
      return demoTransaction(typeof args.p_id === "string" ? args.p_id : "");
    case "payment_recurring":
      return recurringState(typeof args.p_id === "string" ? args.p_id : "");
    case "sumit_status":
      return { connected: true, sumit_company_id: 1, last_sync_at: "2026-10-09T06:00:00Z", last_error: null };
    case "mcp_company_loan_currency":
      return "ILS";
    case "list_my_companies":
      return {
        active_id: COMPANY_ID,
        role: "owner",
        companies: [{ id: COMPANY_ID, name: "Example Renovations", role: "owner", is_demo: false, active: true }],
      };
    default:
      return [];
  }
}

/** FLOW-419: a project opens on its cash; four months of invented figures, the current one first. */
function projectCash() {
  const now = new Date();
  const months = [0, 1, 2, 3].map((back) => {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    return {
      month: day.toISOString().slice(0, 10),
      by_currency: [{
        currency: "ILS",
        in_minor: 1_250_000 - back * 100_000,
        out_minor: 840_000 + back * 50_000,
        net_minor: 410_000 - back * 150_000,
        profit_minor: 380_000 - back * 120_000,
        excluded_count: 0,
        excluded_in_minor: 0,
        excluded_out_minor: 0,
        not_in_profit_minor: 30_000 - back * 30_000,
        not_in_profit_categories: [],
      }],
    };
  });
  return { basis: "paid", base_currency: "ILS", months };
}

/** FLOW-445: the Projects list's month cash, one row per demo project (invented figures from the same books). */
function projectsCashMonth() {
  const now = new Date();
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  return {
    month,
    base_currency: "ILS",
    basis: "paid",
    projects: demoDashboard(null, null, "invoiced").projects.map((project) => {
      const income = Number(project.income_agorot);
      const out = Math.abs(Number(project.direct_agorot)) + Math.abs(Number(project.shared_agorot));
      const net = income - out;
      return {
        id: project.id,
        name: project.name,
        type: null,
        status: project.status,
        is_overhead: false,
        group_id: null,
        created_at: "2026-01-01T00:00:00Z",
        finished_on: null,
        budget_minor: null,
        spent_minor: out,
        cash: [{ currency: "ILS", in_minor: income, out_minor: out, net_minor: net }],
        profit_month_minor: net,
        profit_all_minor: Number(project.profit_agorot),
        first_month: null,
        pending_count: 0,
        deletable: false,
      };
    }),
    unassigned: { count: 0, cash: [] },
  };
}

/** FLOW-435: the project's history, its net since its first month and per year (invented figures). */
function projectCashYears() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const total = (net: number) => [{ currency: "ILS", in_minor: 2_000_000 + net, out_minor: 2_000_000, net_minor: net }];
  return {
    project_name: "שיפוץ הרצל 12",
    basis: "paid",
    base_currency: "ILS",
    this_month: `${now.toISOString().slice(0, 7)}-01`,
    first_month: `${String(year - 2)}-03-01`,
    by_currency: total(1_150_000),
    years: [
      { year, by_currency: total(410_000) },
      { year: year - 1, by_currency: total(620_000) },
      { year: year - 2, by_currency: total(120_000) },
    ],
  };
}

/** FLOW-830: the two review cards the tap gate approves (invented suppliers, in queue order). */
export const REVIEW_CARDS = ["ספק לבדיקה א", "ספק לבדיקה ב"] as const;

function reviewCards() {
  return REVIEW_CARDS.map((supplier, index) => ({
    id: `perf-review-${String(index + 1)}`,
    transaction_id: `perf-line-${String(index + 1)}`,
    description: `חשבונית לבדיקה ${String(index + 1)}`,
    doc_date: "2026-10-01",
    amount_net: 125_000 + index * 1000,
    currency: "ILS",
    direction: "expense",
    reason: null,
    project_id: "herzl",
    category_id: "cat-0",
    supplier_name: supplier,
    project_name: "שיפוץ הרצל 12",
    category_name: "חומרים",
    category_suggested: false,
    project_suggested: false,
  }));
}

/** FLOW-830: a payment that is not recurring yet, so both charge switches start off. */
function recurringState(transactionId: string) {
  return {
    transaction_id: transactionId,
    party: { direction: "expense", id: "perf-party", name: "ספק לדוגמה", currency: "ILS" },
    recurring: false,
    override: null,
    detected: false,
    typical_day: null,
    typical_amount_minor: null,
  };
}

/** The one company the stub user owns; the app names it on every read once list_my_companies answers. */
const COMPANY_ID = "00000000-0000-4000-8000-000000000805";

const USER = {
  id: "00000000-0000-4000-8000-000000000804",
  aud: "authenticated",
  role: "authenticated",
  email: "perf@example.com",
  app_metadata: { provider: "email" },
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};

function base64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

/** A signed-in session the client reads from storage; the stub never checks the signature. */
function session(): string {
  const exp = Math.floor(Date.now() / 1000) + 24 * 3600;
  const token = [
    base64url(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    base64url(JSON.stringify({ sub: USER.id, aud: "authenticated", role: "authenticated", exp })),
    "perf",
  ].join(".");
  return JSON.stringify({
    access_token: token,
    refresh_token: "perf-refresh",
    token_type: "bearer",
    expires_in: 24 * 3600,
    expires_at: exp,
    user: USER,
  });
}

/** The writes a session has made, so the reads after them show the change (as the server would). */
type Writes = {
  approved: Set<string>;
  paid: Map<string, boolean>;
  cash: Map<string, boolean>;
  hidden: Map<string, boolean>;
  projects: Map<string, string>;
};

function newWrites(): Writes {
  return { approved: new Set(), paid: new Map(), cash: new Map(), hidden: new Map(), projects: new Map() };
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function projectName(id: string): string | null {
  return demoDashboard(null, null, "invoiced").projects.find((project) => project.id === id)?.name ?? null;
}

/**
 * FLOW-830: records a write the tap gate makes and applies it to the reads that follow. A write
 * answers as the stub always did; a read returns what the session has written to it.
 */
function persist(name: string, args: Record<string, unknown>, writes: Writes, answer: unknown): unknown {
  const rows = (value: unknown) => (Array.isArray(value) ? value as Array<Record<string, unknown>> : null);
  switch (name) {
    case "approve_review_item":
      writes.approved.add(text(args.p_id));
      return answer;
    case "set_invoice_paid":
      writes.paid.set(text(args.p_id), args.p_paid === true);
      return [];
    case "set_transaction_cash":
      writes.cash.set(text(args.p_id), args.p_in_cash === true);
      return [];
    case "set_category_hidden":
      writes.hidden.set(text(args.p_id), args.p_hidden === true);
      return [];
    case "reassign_transaction":
      writes.projects.set(text(args.p_id), text(args.p_project_id));
      return [];
    case "list_review":
      return rows(answer)?.filter((row) => !writes.approved.has(text(row.id))) ?? answer;
    case "list_unpaid":
      return rows(answer)?.map((row) => ({ ...row, marked_paid_at: writes.paid.get(text(row.id)) === true ? "2026-10-11T08:00:00Z" : null })) ?? answer;
    case "list_categories":
      return rows(answer)?.map((row) => ({ ...row, hidden: writes.hidden.get(text(row.id)) ?? row.hidden })) ?? answer;
    case "get_transaction": {
      if (answer == null || typeof answer !== "object") return answer;
      const id = text(args.p_id);
      const cash = writes.cash.get(id);
      const project = writes.projects.get(id);
      return {
        ...answer,
        ...(cash === undefined ? {} : { in_cash_override: cash }),
        ...(project === undefined ? {} : { project_id: project, project_name: projectName(project) }),
      };
    }
    default:
      return answer;
  }
}

export interface StubBackend {
  /** RPC names read so far, in order. */
  rpcs: string[];
  /** Every REST read so far, in order: an RPC's name, or a table's as "table:<name>", with when it was asked and answered. */
  reads: { name: string; asked: number; answered: number | null }[];
  /** Requests to the stub not answered yet. */
  inflight: () => number;
}

export interface StubOptions {
  /** How long the server takes to answer an RPC, in ms: the REST floor or a spike (default 0). */
  delay?: (rpc: string) => number;
}

/** Signs the page in and answers every request to the stub address from the demo books. */
export async function stubBackend(page: Page, options: StubOptions = {}): Promise<StubBackend> {
  const rpcs: string[] = [];
  const written = newWrites();
  const reads: StubBackend["reads"] = [];
  let open = 0;
  const key = `sb-${new URL(STUB_URL).hostname.split(".")[0] ?? "local"}-auth-token`;
  await page.addInitScript(({ storageKey, value }) => {
    localStorage.setItem(storageKey, value);
  }, { storageKey: key, value: session() });
  await page.route(`${STUB_URL}/**`, async (route: Route) => {
    open += 1;
    try {
      const request = route.request();
      const url = request.url();
      const name = rpcName(url);
      const table = /\/rest\/v1\/(?!rpc\/)([^/?]+)/.exec(url)?.[1];
      const read = name ?? (table ? `table:${table}` : null);
      const entry = read == null ? null : { name: read, asked: Date.now(), answered: null as number | null };
      if (entry) reads.push(entry);
      if (name) {
        rpcs.push(name);
        const args = (request.postDataJSON() ?? {}) as Record<string, unknown>;
        const wait = options.delay?.(name) ?? 0;
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        const answer = persist(name, args, written, rpcBody(name, args));
        await route.fulfill({ status: 200, contentType: "application/json", body: wire(answer) });
        if (entry) entry.answered = Date.now();
      } else if (url.includes("/auth/v1/user")) {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(USER) });
      } else {
        await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
        if (entry) entry.answered = Date.now();
      }
    } finally {
      open -= 1;
    }
  });
  return { rpcs, reads, inflight: () => open };
}
