import type { Session } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth";
import { ToastProvider } from "../ui/toast";
import { BooksProvider } from "../use-books";
import { SetupStepScreen, SetupWelcomeScreen } from "./route-screens";
import { SETUP_TOTAL, SKIP_SHEET_CONFIRM, WELCOME_LATER, WELCOME_TITLE } from "./copy";
import { myCompaniesFor } from "../team-test-support";

const userId = "user-1";
const companyId = "company-1";
const session = {
  access_token: "test",
  refresh_token: "test",
  expires_in: 3600,
  token_type: "bearer",
  user: { id: userId, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-09-27T00:00:00Z", email: "owner@example.com" },
} satisfies Session;

const gate = vi.hoisted(() => ({ owner: "user-1", company: true }));
const invoke = vi.hoisted(() => vi.fn(
  (_name: string, _options?: { body?: unknown }): Promise<{ data: unknown; error: null }> =>
    Promise.resolve({ data: null, error: null }),
));

const created = vi.hoisted(() => ({ calls: [] as unknown[] }));

const dashboard = {
  company_id: companyId,
  name: "אלפא",
  vat_registered: true,
  basis: "invoiced" as const,
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
  rpc: (name: string, args?: unknown) => {
    if (name === "list_my_companies") return Promise.resolve({ data: myCompaniesFor(userId, gate.owner), error: null });
    if (name === "create_company") {
      created.calls.push(args);
      return Promise.resolve({ data: "company-new", error: null });
    }
    if (name === "get_dashboard") return Promise.resolve({ data: gate.company ? dashboard : { ...dashboard, company_id: null, name: null }, error: null });
    if (name === "sumit_status") {
      return Promise.resolve({
        data: { connected: false, sumit_company_id: null, last_sync_at: null, last_error: null },
        error: null,
      });
    }
    return Promise.resolve({ data: [], error: null });
  },
  from: (table: string) => {
    if (table === "companies") return chain({ owner_id: gate.owner });
    if (table === "review_queue") return chain([]);
    return chain(null);
  },
  functions: {
    invoke: (name: string, options?: { body?: unknown }) => invoke(name, options),
  },
};

vi.mock("../lib/supabase", () => ({
  getSupabase: () => supabase,
}));

function renderRoute(path: string, entries: string[] = [path]) {
  const router = createMemoryRouter(
    [
      { path: "/", element: <p>home</p> },
      { path: "/setup/welcome", element: <SetupWelcomeScreen /> },
      { path: "/setup/:step", element: <SetupStepScreen /> },
      { path: "/settings", element: <p>settings</p> },
    ],
    { initialEntries: entries, initialIndex: entries.length - 1 },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AuthProvider>
          <BooksProvider>
            <RouterProvider router={router} />
          </BooksProvider>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return router;
}

describe("setup route (FLOW-514)", () => {
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    gate.owner = userId;
    gate.company = true;
    created.calls.length = 0;
    invoke.mockReset();
    window.history.replaceState(null, "");
  });

  it("shows the welcome to a user with no company", async () => {
    gate.company = false;
    renderRoute("/setup/welcome");
    expect(await screen.findByText(WELCOME_TITLE)).toBeInTheDocument();
  });

  it("sends a user with no company from a step to the welcome", async () => {
    gate.company = false;
    const router = renderRoute("/setup/3");
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/setup/welcome");
    });
  });

  it("skip all from the welcome creates the business and goes home, with the step count in the frame", async () => {
    gate.company = false;
    const router = renderRoute("/setup/welcome");
    fireEvent.click(await screen.findByText(WELCOME_LATER));
    fireEvent.click(await screen.findByRole("button", { name: SKIP_SHEET_CONFIRM }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
    expect(created.calls).toEqual([{ p_name: "העסק שלי", p_vat_registered: true }]);
    expect(SETUP_TOTAL).toBe(7);
  });

  it("sends a viewer home from a step", async () => {
    gate.owner = "other";
    const viewer = renderRoute("/setup/2");
    await waitFor(() => {
      expect(viewer.state.location.pathname).toBe("/");
    });
  });
});
