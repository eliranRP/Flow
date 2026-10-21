import type { Session } from "@supabase/supabase-js";
import { vi } from "vitest";

/**
 * The fake server behind the connection page tests (FLOW-918). A test file declares its own `vi.mock`s
 * (they hoist) and hands them these factories, so every file shares one backend:
 *   vi.mock("../lib/supabase", async () => (await import("./connection-page-test-backend")).supabaseModule());
 *   vi.mock("../edge", async () => (await import("./connection-page-test-backend")).edgeModule());
 * This file imports nothing from the app: the mocked modules would wait on it. Invented data only.
 */

type Answer = { data: unknown; error: { message: string } | null };
const ok = (data: unknown): Promise<Answer> => Promise.resolve({ data, error: null });

/** The fake server. A test sets `answer` (RPCs) / `mercuryRow` (a row or a list of rows) for what the page reads; `calls` lists every RPC. */
export const backend = {
  answer: (_name: string, _args?: unknown): Promise<Answer> => ok(null),
  mercuryRow: (): Promise<Answer> => ok(null),
  calls: [] as string[],
  args: [] as Array<[string, unknown]>,
};

/** The edge-function call every connect and refresh makes. */
export const invokeEdge = vi.fn((_name: string, _body: Record<string, unknown>) => Promise.resolve<unknown>(undefined));

export function supabaseModule() {
  return {
    getSupabase: () => ({
      auth: {
        onAuthStateChange: (callback: (event: string, session: Session | null) => void) => {
          callback("INITIAL_SESSION", null);
          return { data: { subscription: { unsubscribe: () => undefined } } };
        },
        signOut: () => ok(null),
      },
      rpc: (name: string, args?: unknown) => {
        backend.calls.push(name);
        backend.args.push([name, args]);
        return backend.answer(name, args);
      },
      functions: { invoke: () => ok(null) },
      // The Mercury status: one row per connection, by slot (FLOW-938). A test's single row is a list of one.
      from: () => ({
        select: () => ({
          eq: () => ({
            order: async () => {
              const answer = await backend.mercuryRow();
              const rows = answer.data == null ? [] : Array.isArray(answer.data) ? answer.data : [answer.data];
              return { data: answer.error ? null : rows, error: answer.error };
            },
          }),
        }),
      }),
    }),
  };
}

export function edgeModule() {
  return {
    invokeEdge: (name: string, body: Record<string, unknown>) => invokeEdge(name, body),
    edgeErrorCode: () => Promise.resolve("connect_failed"),
    isRecord: (value: unknown) => typeof value === "object" && value !== null,
    isJsonReader: () => false,
  };
}

export const DASHBOARD = {
  company_id: "company-1",
  name: "אלפא",
  vat_registered: true,
  basis: "invoiced",
  from: null,
  to: null,
  income_agorot: 0,
  direct_agorot: 0,
  shared_agorot: 0,
  overhead_agorot: 0,
  expense_agorot: 0,
  net_profit_agorot: 0,
  prev_income_agorot: null,
  prev_expense_agorot: null,
  prev_net_agorot: null,
  active_projects: 0,
  review_count: 0,
  projects: [],
};

export function sumitStatus(partial: Record<string, unknown> = {}) {
  return {
    connected: false,
    sumit_company_id: null,
    last_sync_at: null,
    last_error: null,
    next_attempt_at: null,
    syncing: false,
    ...partial,
  };
}

export function mercuryStatus(partial: Record<string, unknown> = {}) {
  return {
    company_id: "company-1",
    provider: "mercury",
    connected: false,
    last_sync_at: null,
    last_error: null,
    next_attempt_at: null,
    import_from: null,
    account_labels: null,
    skip_count: 0,
    syncing: false,
    slot: 1,
    org_label: null,
    accounts_chosen: true,
    sync_account_ids: null,
    skip_account_ids: [],
    ...partial,
  };
}

/** The reads every page makes, with the connector's status: `sumit` answers sumit_status, `mercury` the Mercury row. */
export function serve(status: { sumit?: Record<string, unknown> | null; mercury?: Record<string, unknown> | Array<Record<string, unknown>> | null }) {
  backend.answer = (name) => {
    if (name === "get_dashboard") return ok(DASHBOARD);
    if (name === "sumit_status") return ok(status.sumit ?? null);
    return ok(null);
  };
  backend.mercuryRow = () => ok(status.mercury ?? null);
}

/** Between tests: an empty backend and an edge that answers nothing. */
export function resetBackend() {
  window.history.replaceState(null, "");
  invokeEdge.mockReset();
  invokeEdge.mockResolvedValue(undefined);
  backend.answer = () => ok(null);
  backend.mercuryRow = () => ok(null);
  backend.calls = [];
  backend.args = [];
}

