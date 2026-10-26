import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../ui/toast";
import { devProjectsCash } from "../dev/projects-sample";
import { ProjectDetailScreen } from "./flow-screens";
import { offlineSinceOf } from "./project-detail-screen";

const rpc = vi.hoisted(() => ({
  impl: (_name: string): Promise<{ data: unknown; error: { message: string } | null }> => Promise.resolve({ data: null, error: null }),
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({ rpc: (name: string) => rpc.impl(name) }),
}));

const serverProject = {
  id: "a",
  name: "וילה רעננה",
  status: "active",
  state_label: "פעיל",
  budget_agorot: null,
  income_agorot: 20_000_000,
  direct_agorot: 10_000_000,
  shared_agorot: 0,
  profit_agorot: 10_000_000,
  categories: [],
  transactions: [],
};

const cashMonths = {
  basis: "paid",
  base_currency: "ILS",
  months: [{
    month: "2026-10-01",
    by_currency: [{ currency: "ILS", in_minor: 20_000_000, out_minor: 10_000_000, net_minor: 10_000_000, profit_minor: 10_000_000, excluded_count: 0, excluded_in_minor: 0, excluded_out_minor: 0, not_in_profit_categories: [] }],
  }],
};

const listMonth = {
  ...devProjectsCash,
  projects: [{ ...devProjectsCash.projects[0], id: "a", name: "וילה רעננה" }],
};

function renderLive() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/projects/a"]}>
          <Routes>
            <Route path="/projects/:projectId" element={<ProjectDetailScreen />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  act(() => { onlineManager.setOnline(true); });
  rpc.impl = () => Promise.resolve({ data: null, error: null });
});

describe("the project page's offline and failed states (FLOW-961)", () => {
  it("keeps the figures offline and says, in the band, which moment they are from", async () => {
    rpc.impl = (name) => Promise.resolve({ data: name === "get_project" ? serverProject : name === "project_cash_months" ? cashMonths : null, error: null });
    renderLive();
    expect(await screen.findByRole("heading", { name: "וילה רעננה" })).toBeInTheDocument();
    expect(screen.queryByText(/^אין חיבור · מוצג המצב/)).not.toBeInTheDocument();
    act(() => { onlineManager.setOnline(false); });
    expect((await screen.findByText(/^אין חיבור · מוצג המצב מ־/)).closest("[role=status]")).toHaveTextContent(/^אין חיבור · מוצג המצב מ־\d\d:\d\d$/);
    // The figures stay on screen.
    expect(screen.getByRole("heading", { name: "וילה רעננה" })).toBeInTheDocument();
  });

  it("draws no offline line without a read time", () => {
    expect(offlineSinceOf(true, 1_000, 2_000)).toBeNull();
    expect(offlineSinceOf(false, 0, 0)).toBeNull();
    expect(offlineSinceOf(false, 0, 2_000)).toBe(2_000);
    expect(offlineSinceOf(false, 1_000, 2_000)).toBe(1_000);
  });

  it("keeps the band on a failed read: the name, נסו שוב and צריך עזרה?", async () => {
    rpc.impl = (name) => Promise.resolve(name === "get_project"
      ? { data: null, error: { message: "boom" } }
      : { data: name === "project_cash_months" ? cashMonths : name === "projects_cash_month" ? listMonth : null, error: null });
    renderLive();
    // The name comes from the Projects list's row when the project's own read failed.
    expect(await screen.findByRole("heading", { name: "וילה רעננה לא נטען" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "נסו שוב" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "צריך עזרה?" })).toHaveAttribute("href", "/help");
  });
});
