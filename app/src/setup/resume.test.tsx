import type { Session } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth";
import { BooksProvider } from "../use-books";
import { SetupResume } from "./route";

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
    if (table === "companies") return chain({ owner_id: userId });
    if (table === "review_queue") return chain([]);
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

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <BooksProvider>
            <SetupResume />
            <Where />
          </BooksProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("setup resume", () => {
  afterEach(() => {
    calls.rpc.length = 0;
    calls.from.length = 0;
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
    renderAt("/");
    await waitFor(() => {
      expect(screen.getByText("/setup/1")).toBeInTheDocument();
    });
    expect(calls.rpc).toContain("get_dashboard");
  });
});
