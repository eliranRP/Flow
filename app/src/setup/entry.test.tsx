import type { Session } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth";
import { myCompaniesFor } from "../team-test-support";
import { ToastProvider } from "../ui/toast";
import { BooksProvider } from "../use-books";
import { SetupHomeSlot, SetupResume } from "./entry";
import { flagsMayResume, flagsOpenForSlot, gateStorageKey } from "./gate";
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
const loads = vi.hoisted(() => ({ route: 0, home: 0, toastRule: false }));
const calls = vi.hoisted(() => ({ from: [] as string[] }));
const gate = vi.hoisted(() => ({ setupRow: null as { state: unknown } | null }));

vi.mock("./on-demand", async (importOriginal) => {
  loads.route += 1;
  return importOriginal();
});
vi.mock("./home", async (importOriginal) => {
  loads.home += 1;
  return importOriginal();
});
// The completed-toast rule is off in the app until #622; the toast mechanism is what this keeps working.
vi.mock("./model", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./model")>();
  return { ...actual, shouldShowCompletedToast: () => loads.toastRule };
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
    if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
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

function renderSlot() {
  const router = createMemoryRouter([{ path: "/", element: <SetupHomeSlot emptyHome /> }], { initialEntries: ["/"] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <BooksProvider>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </BooksProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

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
    loads.toastRule = false;
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
    expect(flagsOpenForSlot({ ...openRun, completed_toast_at: at })).toBe(false);
    expect(flagsOpenForSlot({ ...openRun, finished_at: at })).toBe(false);
    expect(flagsOpenForSlot(openRun)).toBe(true);
  });

  it("Home loads neither setup module for a user who is not in setup", async () => {
    renderSlot();
    await waitFor(() => { expect(calls.from).toContain("setup_states"); });
    await settle();
    expect(loads.home).toBe(0);
    expect(loads.route).toBe(0);
  });

  it("Home loads neither setup module for a user whose run finished", async () => {
    writeSetupStore(userId, "company-1", { ...openRun, finished_at: at });
    renderSlot();
    await settle();
    expect(loads.home).toBe(0);
  });

  it("the cold-start resume does not load the setup code for a user with no run", async () => {
    const router = renderResume();
    await waitFor(() => { expect(calls.from).toContain("setup_states"); });
    await settle();
    expect(loads.route).toBe(0);
    expect(router.state.location.pathname).toBe("/");
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

  it("shows the completed toast once for an open run, and then stops loading the slot", async () => {
    loads.toastRule = true;
    writeSetupStore(userId, "company-1", openRun);
    const first = renderSlot();
    expect(await screen.findByText("ההגדרה הושלמה.")).toBeInTheDocument();
    expect(screen.getAllByText("ההגדרה הושלמה.")).toHaveLength(1);
    const stamped = JSON.parse(localStorage.getItem(setupStorageKey(userId, "company-1")) ?? "{}") as { completed_toast_at?: string };
    expect(stamped.completed_toast_at).toEqual(expect.any(String));
    first.unmount();
    renderSlot();
    await settle();
    expect(screen.queryByText("ההגדרה הושלמה.")).toBeNull();
  });
});
