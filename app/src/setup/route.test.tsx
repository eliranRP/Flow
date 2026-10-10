import type { Session } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth";
import { ToastProvider } from "../ui/toast";
import { BooksProvider } from "../use-books";
import { SetupStepScreen } from "./route";
import { markCompanyCreated, readSetupStore, setupStorageKey } from "./storage";
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

const gate = vi.hoisted(() => ({ owner: "user-1" }));
const invoke = vi.hoisted(() => vi.fn(
  (_name: string, _options?: { body?: unknown }): Promise<{ data: unknown; error: null }> =>
    Promise.resolve({ data: null, error: null }),
));

const starter = vi.hoisted(() => ({
  calls: [] as unknown[],
  error: null as { message: string; code?: string } | null,
}));

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
    if (name === "apply_starter_categories") {
      starter.calls.push(args);
      return Promise.resolve({ data: starter.error ? null : { set: "rentals", categories: 14 }, error: starter.error });
    }
    if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
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

describe("setup route history", () => {
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    gate.owner = userId;
    invoke.mockReset();
    window.history.replaceState(null, "");
  });

  it("pushes the next step, writes only the skip, and Android back returns one step", async () => {
    const router = renderRoute("/setup/2");
    fireEvent.click(await screen.findByRole("button", { name: "דלג" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/setup/3");
    });
    const stored = readSetupStore(userId, companyId);
    expect(stored.skipped["2"]).toEqual(expect.any(String));
    expect(stored.confirmed_lists_at).toBeNull();
    expect(stored.sample_review_at).toBeNull();
    expect(stored.run_started_at).toBeNull();
    await act(async () => {
      await router.navigate(-1);
    });
    expect(router.state.location.pathname).toBe("/setup/2");
  });

  it("closes the SUMIT sheet on back and stays on step 1", async () => {
    const router = renderRoute("/setup/1");
    window.history.replaceState({ idx: 1 }, "");
    fireEvent.click(await screen.findByRole("button", { name: "חיבור SUMIT" }));
    await screen.findByRole("dialog", { name: "חיבור SUMIT" });
    await act(async () => {
      await router.navigate(-1);
    });
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/setup/1");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("advances to step 2 after a successful connect", async () => {
    invoke.mockResolvedValue({ data: {}, error: null });
    const router = renderRoute("/setup/1");
    fireEvent.click(await screen.findByRole("button", { name: "חיבור SUMIT" }));
    const dialog = await screen.findByRole("dialog", { name: "חיבור SUMIT" });
    fireEvent.change(within(dialog).getByLabelText("מספר חברה"), { target: { value: "1001" } });
    fireEvent.change(within(dialog).getByLabelText("מפתח API"), { target: { value: "secret-key" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "חיבור" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/setup/2");
    });
  });

  it("returns home from step 1 when opened from the card", async () => {
    invoke.mockResolvedValue({ data: {}, error: null });
    window.history.replaceState({ idx: 1 }, "");
    const router = renderRoute("/setup/1?from=card", ["/", "/setup/1?from=card"]);
    fireEvent.click(await screen.findByRole("button", { name: "חיבור SUMIT" }));
    const dialog = await screen.findByRole("dialog", { name: "חיבור SUMIT" });
    fireEvent.change(within(dialog).getByLabelText("מספר חברה"), { target: { value: "1001" } });
    fireEvent.change(within(dialog).getByLabelText("מפתח API"), { target: { value: "secret-key" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "חיבור" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
  });

  it("keeps from=card when step 4 opens the review queue", async () => {
    const router = renderRoute("/setup/4?from=card");
    fireEvent.click(await screen.findByRole("button", { name: "כרטיס דוגמה" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/review");
    });
    expect(router.state.location.search).toBe("?setup=1&from=card");
  });

  it("pops back to Home when the step was opened from the card", async () => {
    window.history.replaceState({ idx: 1 }, "");
    const router = renderRoute("/setup/2?from=card", ["/", "/setup/2?from=card"]);
    fireEvent.click(await screen.findByRole("button", { name: "דלג" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
    expect(localStorage.getItem(setupStorageKey(userId, companyId))).toContain("\"2\"");
    await act(async () => {
      await router.navigate(1);
    });
    expect(router.state.location.pathname).toBe("/setup/2");
  });

  it("sends a viewer home and will not leave a company on step 0", async () => {
    gate.owner = "other";
    const viewer = renderRoute("/setup/2");
    await waitFor(() => {
      expect(viewer.state.location.pathname).toBe("/");
    });
    gate.owner = userId;
    const step = renderRoute("/setup/0");
    await waitFor(() => {
      expect(step.state.location.pathname).toBe("/setup/1");
    });
  });

  it("asks for the starter categories once the company exists, with כללי picked on arrival", async () => {
    markCompanyCreated(userId);
    starter.calls = [];
    starter.error = null;
    const router = renderRoute("/setup/0");
    expect(await screen.findByRole("heading", { name: "קטגוריות לפתיחה" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "כללי" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("button", { name: "דלג" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "השכרת נכסים" }));
    fireEvent.click(screen.getByRole("button", { name: "המשך" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/setup/1");
    });
    expect(starter.calls).toEqual([{ p_set: "rentals" }]);
    expect(readSetupStore(userId, companyId).starter_set).toBe("rentals");
  });

  it("moves on without a word when the books already have lines", async () => {
    markCompanyCreated(userId);
    starter.calls = [];
    starter.error = { message: "starter_locked", code: "55000" };
    const router = renderRoute("/setup/0");
    fireEvent.click(await screen.findByRole("button", { name: "המשך" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/setup/1");
    });
    expect(starter.calls).toEqual([{ p_set: "general" }]);
    expect(readSetupStore(userId, companyId).starter_set).toBeNull();
    expect(document.querySelector(".ui-toast")).toBeNull();
  });

  it("back from step 1 shows the set already applied and does not apply it again", async () => {
    markCompanyCreated(userId);
    starter.calls = [];
    starter.error = null;
    const router = renderRoute("/setup/0");
    fireEvent.click(await screen.findByRole("radio", { name: "השכרת נכסים" }));
    fireEvent.click(screen.getByRole("button", { name: "המשך" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/setup/1");
    });
    await act(async () => {
      await router.navigate(-1);
    });
    expect((await screen.findByRole("radio", { name: "השכרת נכסים" })).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "המשך" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/setup/1");
    });
    expect(starter.calls).toEqual([{ p_set: "rentals" }]);
  });
});
