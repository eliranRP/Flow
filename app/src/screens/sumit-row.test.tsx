import type { Session } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { OnboardingScreen, SettingsScreen } from "./flow-screens";

const rpc = vi.hoisted(() => ({
  impl: (_name: string, _args?: unknown): Promise<{ data: unknown; error: { message: string } | null }> =>
    Promise.resolve({ data: null, error: null }),
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    auth: {
      onAuthStateChange: (callback: (event: string, session: Session | null) => void) => {
        callback("INITIAL_SESSION", null);
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
      signOut: () => Promise.resolve({ error: null }),
    },
    rpc: (name: string, args?: unknown) => rpc.impl(name, args),
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  }),
}));

const dashboard = {
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

function sumit(partial: Record<string, unknown>) {
  return {
    connected: false,
    sumit_company_id: null,
    last_sync_at: null,
    last_error: null,
    next_attempt_at: null,
    ...partial,
  };
}

function renderSettings(ui: ReactNode = <SettingsScreen />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <BooksProvider>
          <MemoryRouter initialEntries={["/settings"]}>
            {ui}
          </MemoryRouter>
        </BooksProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { client, ...view };
}

function hintOf(row: HTMLElement): string {
  return document.getElementById(row.getAttribute("aria-describedby") ?? "")?.textContent ?? "";
}

describe("SUMIT status row", () => {
  it("shows a load error on the row and moves focus when retry succeeds", async () => {
    let fail = true;
    rpc.impl = (name) => {
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
      if (name === "list_categories") return Promise.resolve({ data: [], error: null });
      if (name === "sumit_status") {
        if (fail) return Promise.resolve({ data: null, error: { message: "down" } });
        return Promise.resolve({ data: sumit({ connected: true, sumit_company_id: 1001 }), error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    renderSettings();
    const retry = await screen.findByRole("button", { name: "ניסיון חוזר: SUMIT" });
    const group = screen.getByRole("group", { name: "SUMIT" });
    expect(group).toHaveTextContent("לא הצלחנו לטעון");
    expect(within(group).getByText("לא הצלחנו לטעון")).toHaveAttribute("role", "status");
    expect(screen.queryByRole("button", { name: "SUMIT" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("מספר חברה")).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(retry);
    await waitFor(() => { expect(screen.getByRole("button", { name: "SUMIT" })).toHaveFocus(); });
    expect(hintOf(screen.getByRole("button", { name: "SUMIT" }))).toBe("מחובר");
    expect(screen.queryByRole("button", { name: "ניסיון חוזר: SUMIT" })).not.toBeInTheDocument();
  });

  it("keeps focus on ניסיון חוזר when the retry fails again", async () => {
    const failed = Promise.resolve({ data: null, error: { message: "down" } });
    let attempt: Promise<{ data: unknown; error: { message: string } | null }> = failed;
    let release: (value: { data: unknown; error: { message: string } | null }) => void = () => undefined;
    rpc.impl = (name) => {
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
      if (name === "list_categories") return Promise.resolve({ data: [], error: null });
      if (name === "sumit_status") return attempt;
      return Promise.resolve({ data: null, error: null });
    };
    renderSettings();
    const retry = await screen.findByRole("button", { name: "ניסיון חוזר: SUMIT" });
    attempt = new Promise((resolve) => { release = resolve; });
    retry.focus();
    fireEvent.click(retry);
    expect(retry).toHaveAttribute("aria-busy", "true");
    expect(within(screen.getByRole("group", { name: "SUMIT" })).getByText("לא הצלחנו לטעון")).toHaveAttribute("role", "status");
    release({ data: null, error: { message: "down" } });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "ניסיון חוזר: SUMIT" })).toHaveFocus();
      expect(within(screen.getByRole("group", { name: "SUMIT" })).getByText("לא הצלחנו לטעון")).toHaveAttribute("role", "status");
    });
    expect(screen.queryByRole("button", { name: "SUMIT" })).not.toBeInTheDocument();
  });

  it("keeps the last state when a refetch fails and data is cached", async () => {
    let calls = 0;
    rpc.impl = (name) => {
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
      if (name === "list_categories") return Promise.resolve({ data: [], error: null });
      if (name === "sumit_status") {
        calls += 1;
        if (calls === 1) return Promise.resolve({ data: sumit({ connected: true, sumit_company_id: 1001, last_error: "sumit_rejected" }), error: null });
        return Promise.resolve({ data: null, error: { message: "down" } });
      }
      return Promise.resolve({ data: null, error: null });
    };
    const { client } = renderSettings();
    const row = await screen.findByRole("button", { name: "SUMIT" });
    expect(hintOf(row)).toBe("מחובר");
    await client.refetchQueries({ queryKey: ["sumit"] });
    await waitFor(() => { expect(calls).toBeGreaterThan(1); });
    expect(hintOf(screen.getByRole("button", { name: "SUMIT" }))).toBe("מחובר");
    expect(screen.queryByRole("button", { name: "ניסיון חוזר: SUMIT" })).not.toBeInTheDocument();
    expect(screen.queryByText("לא הצלחנו לטעון")).not.toBeInTheDocument();
  });

  it("uses the warning tone for a rejected key and keeps a sync failure connected", async () => {
    rpc.impl = (name) => {
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
      if (name === "list_categories") return Promise.resolve({ data: [], error: null });
      if (name === "sumit_status") {
        return Promise.resolve({ data: sumit({ connected: true, sumit_company_id: 1001, last_error: "sumit_auth" }), error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    const { unmount } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter>
              <SettingsScreen />
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    const warning = await screen.findByRole("button", { name: "SUMIT" });
    expect(warning).toHaveClass("ui-row-tone-warning");
    expect(hintOf(warning)).toBe("צריך לחבר מחדש");
    expect(screen.queryByText("החיבור ל־SUMIT נכשל.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ניסיון חוזר: SUMIT" })).not.toBeInTheDocument();
    unmount();

    rpc.impl = (name) => {
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
      if (name === "list_categories") return Promise.resolve({ data: [], error: null });
      if (name === "sumit_status") {
        return Promise.resolve({ data: sumit({ connected: true, sumit_company_id: 1001, last_error: "sumit_rejected" }), error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter>
              <SettingsScreen />
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    const row = await screen.findByRole("button", { name: "SUMIT" });
    expect(row).not.toHaveClass("ui-row-tone-warning");
    expect(hintOf(row)).toBe("מחובר");
    expect(row).not.toHaveTextContent("לא זמין");
    fireEvent.click(row);
    const sheet = screen.getByRole("dialog", { name: "SUMIT" });
    expect(within(sheet).getByText("SUMIT לא זמין כרגע.")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "רענון עכשיו" })).toBeEnabled();
  });

  it("shows a skeleton until the status arrives and a screen error when the dashboard fails", async () => {
    rpc.impl = (name) => {
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
      if (name === "list_categories") return Promise.resolve({ data: [], error: null });
      if (name === "sumit_status") return new Promise(() => undefined);
      return Promise.resolve({ data: null, error: null });
    };
    const { unmount } = renderSettings();
    expect(await screen.findByRole("heading", { name: "הגדרות" })).toBeInTheDocument();
    const title = await screen.findByText("SUMIT");
    expect(title.closest(".ui-row")).toHaveAttribute("aria-busy", "true");
    expect(title.closest("button")).toBeNull();
    expect(screen.getByText("טוען…")).toHaveAttribute("role", "status");
    expect(screen.queryByText("מחובר")).not.toBeInTheDocument();
    expect(title.closest(".ui-row")?.querySelector(".ui-skeleton-bar")).toHaveAttribute("aria-hidden", "true");
    unmount();

    rpc.impl = (name) => {
      if (name === "get_dashboard") return Promise.resolve({ data: null, error: { message: "down" } });
      if (name === "sumit_status") return Promise.resolve({ data: null, error: { message: "down" } });
      return Promise.resolve({ data: null, error: null });
    };
    renderSettings();
    expect(await screen.findByText("לא הצלחנו לטעון את הנתונים")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ניסיון חוזר: SUMIT" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "SUMIT" })).not.toBeInTheDocument();
  });

  it("opens the SUMIT sheet from a same-app return and sends onboarding home by default", async () => {
    rpc.impl = (name) => {
      if (name === "get_dashboard") return Promise.resolve({ data: { ...dashboard, company_id: "company-1" }, error: null });
      if (name === "list_categories") return Promise.resolve({ data: [], error: null });
      if (name === "sumit_status") return Promise.resolve({ data: sumit({}), error: null });
      return Promise.resolve({ data: null, error: null });
    };
    function Place() {
      const location = useLocation();
      return <p>{`${location.pathname}${location.search}`}</p>;
    }
    const { unmount } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter initialEntries={["/settings?sheet=sumit"]}>
              <Place />
              <SettingsScreen />
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    const sheet = await screen.findByRole("dialog", { name: "חיבור SUMIT" });
    expect(within(sheet).getByLabelText("מספר חברה")).toBeInTheDocument();
    unmount();

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter initialEntries={["/onboarding?return=/settings?sheet=sumit"]}>
              <Routes>
                <Route path="/onboarding" element={<OnboardingScreen />} />
                <Route path="/settings" element={<h1>הגדרות</h1>} />
                <Route path="/" element={<h1>בית</h1>} />
              </Routes>
              <Place />
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("שם העסק"), { target: { value: "אלפא" } });
    fireEvent.click(screen.getByRole("button", { name: "המשך" }));
    expect(await screen.findByRole("heading", { name: "הגדרות" })).toBeInTheDocument();
    expect(screen.getByText("/settings?sheet=sumit")).toBeInTheDocument();
  });

  it("drops an off-site return and keeps Home as the default", async () => {
    function Place() {
      const location = useLocation();
      return <p>{`${location.pathname}${location.search}`}</p>;
    }
    const { unmount } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter initialEntries={["/onboarding?return=https://evil.example/steal"]}>
              <Routes>
                <Route path="/onboarding" element={<OnboardingScreen />} />
                <Route path="/" element={<h1>בית</h1>} />
              </Routes>
              <Place />
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("שם העסק"), { target: { value: "אלפא" } });
    fireEvent.click(screen.getByRole("button", { name: "המשך" }));
    expect(await screen.findByRole("heading", { name: "בית" })).toBeInTheDocument();
    expect(screen.getByText("/")).toBeInTheDocument();
    unmount();

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter initialEntries={["/onboarding"]}>
              <Routes>
                <Route path="/onboarding" element={<OnboardingScreen />} />
                <Route path="/" element={<h1>בית</h1>} />
              </Routes>
              <Place />
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("שם העסק"), { target: { value: "אלפא" } });
    fireEvent.click(screen.getByRole("button", { name: "המשך" }));
    expect(await screen.findByRole("heading", { name: "בית" })).toBeInTheDocument();
  });
});
