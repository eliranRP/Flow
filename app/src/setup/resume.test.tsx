import type { Session } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { Outlet, RouterProvider, createMemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth";
import { BooksProvider } from "../use-books";
import { resetSetupResumeForTests, SetupLanding, SetupResume } from "./route";
import { emptySetupStore, markSessionEntered, readSetupStore, writeSetupStore } from "./storage";

const userId = "user-1";

const session = {
  access_token: "test",
  refresh_token: "test",
  expires_in: 3600,
  token_type: "bearer",
  user: {
    id: userId,
    aud: "authenticated",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-09-27T00:00:00Z",
    email: "owner@example.com",
  },
} satisfies Session;

const dashboard = {
  company_id: "company-1",
  name: "אלפא",
  vat_registered: true,
  basis: "invoiced",
  from: "2026-10-01",
  to: "2026-10-04",
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

const calls = vi.hoisted(() => ({ rpc: [] as string[], from: [] as string[] }));
const gate = vi.hoisted(() => ({ ownerId: "user-1", setupRow: null as { state: unknown } | null }));

function chain(data: unknown) {
  const result = { data, error: null };
  const next = {
    select: () => next,
    eq: () => next,
    in: () => next,
    limit: () => next,
    maybeSingle: () => Promise.resolve(result),
    then: (onFulfilled: (value: typeof result) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
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
    calls.rpc.push(name);
    if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
    if (name === "sumit_status") {
      return Promise.resolve({
        data: { connected: false, sumit_company_id: null, last_sync_at: null, last_error: null },
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  },
  from: (table: string) => {
    calls.from.push(table);
    if (table === "companies") return chain({ owner_id: gate.ownerId });
    if (table === "review_queue") return chain([]);
    if (table === "setup_states") {
      // Answers after the other reads, so a resume that does not wait for it would already have moved.
      const row = gate.setupRow;
      const slow = {
        select: () => slow,
        eq: () => slow,
        upsert: () => Promise.resolve({ data: null, error: null }),
        maybeSingle: () => new Promise((resolve) => setTimeout(() => { resolve({ data: row, error: null }); }, 150)),
      };
      return slow;
    }
    return chain(null);
  },
};

vi.mock("../lib/supabase", () => ({
  getSupabase: () => supabase,
}));

function Where() {
  const { pathname } = useLocation();
  return <p>{pathname}</p>;
}

function providers(router: ReturnType<typeof createMemoryRouter>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <BooksProvider>
          <RouterProvider router={router} />
        </BooksProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { router, unmount: view.unmount };
}

function renderAt(path: string, entries: string[] = [path]) {
  const router = createMemoryRouter(
    [
      { path: "/", element: <><SetupResume /><Where /></> },
      { path: "/review", element: <><SetupResume /><Where /></> },
      { path: "/setup/:step", element: <p>step</p> },
    ],
    { initialEntries: entries, initialIndex: entries.length - 1 },
  );
  return providers(router);
}

describe("setup resume", () => {
  afterEach(() => {
    calls.rpc.length = 0;
    calls.from.length = 0;
    gate.ownerId = userId;
    gate.setupRow = null;
    resetSetupResumeForTests();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("does not load the dashboard or leave a cold /review", async () => {
    renderAt("/review");
    await waitFor(() => {
      expect(calls.from).toContain("companies");
    });
    expect(calls.rpc).not.toContain("get_dashboard");
    expect(screen.getByText("/review")).toBeInTheDocument();
  });

  it("starts the run from Home", async () => {
    const { router } = renderAt("/");
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/setup/1");
    });
    expect(calls.rpc).toContain("get_dashboard");
  });

  it("does not resume when Home is opened after a deep link", async () => {
    writeSetupStore(userId, "company-1", { ...emptySetupStore(), run_started_at: "2026-10-04T00:00:00.000Z" });
    const { router } = renderAt("/review", ["/review"]);
    await waitFor(() => {
      expect(screen.getByText("/review")).toBeInTheDocument();
    });
    await act(async () => {
      await router.navigate("/");
    });
    await waitFor(() => {
      expect(calls.from).toContain("review_queue");
    });
    await expect(
      waitFor(() => { expect(router.state.location.pathname).not.toBe("/"); }, { timeout: 500 }),
    ).rejects.toThrow();
  });

  it("does not resume when Home is opened after a full-screen deep link", async () => {
    writeSetupStore(userId, "company-1", { ...emptySetupStore(), run_started_at: "2026-10-04T00:00:00.000Z" });
    const router = createMemoryRouter(
      [{
        element: <><SetupLanding /><Outlet /></>,
        children: [
          { path: "/", element: <><SetupResume /><Where /></> },
          { path: "/transactions/:id", element: <p>tx</p> },
          { path: "/setup/:step", element: <p>step</p> },
        ],
      }],
      { initialEntries: ["/transactions/t1"] },
    );
    providers(router);
    await act(async () => {
      await router.navigate("/");
    });
    await waitFor(() => {
      expect(calls.from).toContain("review_queue");
    });
    await expect(
      waitFor(() => { expect(router.state.location.pathname).not.toBe("/"); }, { timeout: 500 }),
    ).rejects.toThrow();
  });

  it("resumes a started run once, and neither the stamp nor the session alone opens it again", async () => {
    writeSetupStore(userId, "company-1", { ...emptySetupStore(), run_started_at: "2026-10-04T00:00:00.000Z" });
    const first = renderAt("/");
    await waitFor(() => {
      expect(first.router.state.location.pathname).toBe("/setup/1");
    });
    const stamped = readSetupStore(userId, "company-1");
    expect(stamped.run_resumed_at).not.toBeNull();
    first.unmount();
    resetSetupResumeForTests();
    sessionStorage.clear();
    const second = renderAt("/");
    await waitFor(() => {
      expect(calls.from).toContain("review_queue");
    });
    await expect(
      waitFor(() => { expect(second.router.state.location.pathname).not.toBe("/"); }, { timeout: 500 }),
    ).rejects.toThrow();
    second.unmount();
    resetSetupResumeForTests();
    markSessionEntered(userId);
    writeSetupStore(userId, "company-1", { ...stamped, run_resumed_at: null });
    const third = renderAt("/");
    await waitFor(() => {
      expect(calls.from).toContain("review_queue");
    });
    await expect(
      waitFor(() => { expect(third.router.state.location.pathname).not.toBe("/"); }, { timeout: 500 }),
    ).rejects.toThrow();
  });

  it("a new phone reads the server flags before it decides, and does not restart the run", async () => {
    gate.setupRow = {
      state: { ...emptySetupStore(), run_started_at: "2026-10-04T00:00:00.000Z", run_resumed_at: "2026-10-05T00:00:00.000Z" },
    };
    const { router } = renderAt("/");
    await waitFor(() => {
      expect(calls.from).toContain("setup_states");
    });
    await waitFor(() => {
      expect(readSetupStore(userId, "company-1").run_resumed_at).toBe("2026-10-05T00:00:00.000Z");
    });
    await expect(
      waitFor(() => { expect(router.state.location.pathname).not.toBe("/"); }, { timeout: 500 }),
    ).rejects.toThrow();
  });

  it("ignores viewers on Home", async () => {
    gate.ownerId = "other";
    const { router } = renderAt("/");
    await waitFor(() => {
      expect(calls.from).toContain("companies");
    });
    await expect(
      waitFor(() => { expect(router.state.location.pathname).not.toBe("/"); }, { timeout: 500 }),
    ).rejects.toThrow();
    expect(calls.rpc).not.toContain("get_dashboard");
  });
});
