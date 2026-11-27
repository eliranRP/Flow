import type { Session } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth";
import { myCompaniesFor } from "../team-test-support";
import { BooksProvider } from "../use-books";
import { SetupResume } from "./entry";
import { flagsMayResume, gateStorageKey } from "./gate";
import { resetSetupLandingForTests } from "./landing";
import { runMayResume } from "./model";
import { emptySetupStore, parseSetupStore, setupStorageKey, writeSetupStore, type SetupStore } from "./storage";

const userId = "user-1";
const session = {
  access_token: "test",
  refresh_token: "test",
  expires_in: 3600,
  token_type: "bearer",
  user: { id: userId, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-09-27T00:00:00Z", email: "owner@example.com" },
} satisfies Session;

const dashboard = {
  company_id: "company-1", name: "אלפא", vat_registered: true, basis: "invoiced", from: "2026-10-01", to: "2026-10-04",
  income_agorot: 0, direct_agorot: 0, shared_agorot: 0, overhead_agorot: 0, expense_agorot: 0, net_profit_agorot: 0,
  prev_income_agorot: null, prev_expense_agorot: null, prev_net_agorot: null, active_projects: 0, review_count: 0, projects: [],
};

/** How many times each setup module was imported: the chunk is loaded when its module's factory ran. */
const loads = vi.hoisted(() => ({ route: 0, failRoute: 0, noCompany: false }));
const calls = vi.hoisted(() => ({ from: [] as string[] }));
const gate = vi.hoisted(() => ({ setupRow: null as { state: unknown } | null }));

vi.mock("./on-demand", async (importOriginal) => {
  if (loads.failRoute > 0) {
    loads.failRoute -= 1;
    throw new Error("chunk load failed");
  }
  loads.route += 1;
  return importOriginal();
});
function chain(data: unknown) {
  const result = { data, error: null };
  const next = {
    select: () => next, eq: () => next, in: () => next, limit: () => next,
    maybeSingle: () => Promise.resolve(result),
    then: (onFulfilled: (value: typeof result) => unknown, onRejected?: (reason: unknown) => unknown) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return next;
}

const supabase = {
  auth: {
    onAuthStateChange: (callback: (event: string, next: Session | null) => void) => {
      callback("INITIAL_SESSION", session);
      return { data: { subscription: { unsubscribe: () => undefined } } };
    },
  },
  rpc: (name: string) => {
    if (name === "list_my_companies") return Promise.resolve({ data: myCompaniesFor(userId, userId), error: null });
    if (name === "get_dashboard") return Promise.resolve({ data: loads.noCompany ? { ...dashboard, company_id: null } : dashboard, error: null });
    return Promise.resolve({ data: null, error: null });
  },
  from: (table: string) => {
    calls.from.push(table);
    if (table === "companies") return chain({ owner_id: userId });
    if (table === "setup_states") return chain(gate.setupRow);
    return chain(null);
  },
};
vi.mock("../lib/supabase", () => ({ getSupabase: () => supabase }));

const at = "2026-10-04T00:00:00.000Z";
const openRun: SetupStore = { ...emptySetupStore(), flow_at: at, run_started_at: at };

function renderResume() {
  const router = createMemoryRouter([{ path: "/", element: <SetupResume /> }, { path: "/setup/:step", element: <p>step</p> }], { initialEntries: ["/"] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <BooksProvider>
          <RouterProvider router={router} />
        </BooksProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return router;
}

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });

// The no-load cases come first: a module, once loaded, stays loaded for the rest of the file.
describe("setup code loads when needed (FLOW-1342)", () => {
  afterEach(async () => {
    if (loads.route > 0) (await import("./route")).resetSetupResumeForTests();
    resetSetupLandingForTests();
    loads.noCompany = false;
    loads.failRoute = 0;
    gate.setupRow = null;
    calls.from.length = 0;
    localStorage.clear();
    sessionStorage.clear();
  });

  it("the gate's flag reads match the setup model and the storage key", () => {
    expect(gateStorageKey("u", "c")).toBe(setupStorageKey("u", "c"));
    const variants: SetupStore[] = [
      emptySetupStore(), openRun, { ...openRun, run_started_at: null },
      { ...openRun, flow_at: null }, { ...openRun, run_resumed_at: at }, { ...openRun, skipped_all_at: at }, { ...openRun, finished_at: at },
    ];
    for (const store of variants) {
      expect(flagsMayResume(JSON.parse(JSON.stringify(store)))).toBe(runMayResume(parseSetupStore(JSON.stringify(store)), false));
    }
    expect(flagsMayResume(null)).toBe(false);
  });

  /** A phone's saved copy, without the upload writeSetupStore queues (that reads the row). */
  const saveLocal = (store: SetupStore) => { localStorage.setItem(setupStorageKey(userId, "company-1"), JSON.stringify(store)); };
  const reads = (table: string) => calls.from.filter((name) => name === table).length;
  const stepReads = () => ["company_integrations", "review_queue", "loans"].flatMap((table) => calls.from.filter((name) => name === table));

  it("a mid-setup owner already resumed: no setup code, no setup_states read, no step reads", async () => {
    saveLocal({ ...openRun, run_resumed_at: at });
    const router = renderResume();
    await settle();
    expect(loads.route).toBe(0);
    expect(reads("setup_states")).toBe(0);
    expect(stepReads()).toEqual([]);
    expect(router.state.location.pathname).toBe("/");
  });

  it("an owner who finished or skipped, with a local copy: no setup_states read", async () => {
    for (const done of [{ finished_at: at }, { skipped_all_at: at }]) {
      saveLocal({ ...openRun, ...done });
      const router = renderResume();
      await settle();
      expect(router.state.location.pathname).toBe("/");
      calls.from.length = 0;
      localStorage.clear();
    }
    expect(loads.route).toBe(0);
    expect(reads("setup_states")).toBe(0);
  });

  it("the cold-start resume does not load the setup code for a user with no run", async () => {
    const router = renderResume();
    await waitFor(() => { expect(calls.from).toContain("setup_states"); });
    await settle();
    expect(loads.route).toBe(0);
    expect(router.state.location.pathname).toBe("/");
  });

  it("a failed chunk load is retried, and the owner with no company reaches the welcome screen", async () => {
    loads.noCompany = true;
    loads.failRoute = 1;
    const router = renderResume();
    await waitFor(() => { expect(router.state.location.pathname).toBe("/setup/welcome"); }, { timeout: 4000 });
    expect(loads.failRoute).toBe(0);
    expect(loads.route).toBe(1);
  });

  it("the cold-start resume loads the setup code after the first paint, then redirects", async () => {
    writeSetupStore(userId, "company-1", openRun);
    const router = renderResume();
    // Nothing else is drawn meanwhile: the page is the route's own, blank.
    expect(router.state.location.pathname).toBe("/");
    await waitFor(() => { expect(router.state.location.pathname).toMatch(/^\/setup\//); });
    expect(loads.route).toBe(1);
  });

  it("a run another phone started is found on the server, and resumes", async () => {
    gate.setupRow = { state: openRun };
    const router = renderResume();
    await waitFor(() => { expect(router.state.location.pathname).toMatch(/^\/setup\//); });
  });

  it("a new phone with an open run resumes after one setup_states read, the chunk reusing the gate's row", async () => {
    gate.setupRow = { state: openRun };
    const router = renderResume();
    await waitFor(() => { expect(router.state.location.pathname).toMatch(/^\/setup\//); });
    await settle();
    expect(loads.route).toBe(1);
    expect(reads("setup_states")).toBe(1);
  });
});
