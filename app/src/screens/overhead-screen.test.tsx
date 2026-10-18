import type { ProjectDetail } from "@flow/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../ui/toast";
import { ProjectDetailScreen } from "./flow-screens";
import { ProjectProfitScreen } from "./project-profit-screen";

const rpc = vi.hoisted(() => ({
  impl: (_name: string, _args?: unknown): Promise<{ data: unknown; error: { message: string } | null }> =>
    Promise.resolve({ data: null, error: null }),
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: unknown) => rpc.impl(name, args),
  }),
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
  overhead_share_agorot: 4_000_000,
  overhead_weighted: true,
  profit_after_overhead_agorot: 6_000_000,
  categories: [],
  transactions: [],
};

/** The project's cash read (the page opens on it); the switch tests do not look at its figures. */
const cashMonths = {
  basis: "paid",
  base_currency: "ILS",
  months: [{
    month: "2026-10-01",
    by_currency: [{
      currency: "ILS",
      in_minor: 0,
      out_minor: 0,
      net_minor: 0,
      profit_minor: 0,
      excluded_count: 0,
      excluded_in_minor: 0,
      excluded_out_minor: 0,
      not_in_profit_categories: [],
    }],
  }],
};

function renderProject(sample: NonNullable<ProjectDetail>, section: "overview" = "overview") {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/projects/a"]}>
          <Routes>
            <Route path="/projects/:projectId" element={<ProjectDetailScreen section={section} sample={sample} />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const projectBase = {
  id: "a",
  name: "וילה רעננה",
  status: "active" as const,
  state_label: "פעיל",
  budget_agorot: null,
  income_agorot: 0n,
  direct_agorot: 8_000n,
  shared_agorot: 0n,
  profit_agorot: -8_000n,
  categories: [{ id: "h", name: "הובלה", amount_agorot: 3_000n }],
  transactions: [],
};

describe("project overhead hero", () => {
  const overheadProject = {
    id: "a",
    name: "וילה רעננה",
    status: "active" as const,
    state_label: "פעיל",
    budget_agorot: null,
    income_agorot: 20_000_000n,
    direct_agorot: 10_000_000n,
    shared_agorot: 0n,
    profit_agorot: 10_000_000n,
    after_overhead: true,
    overhead_share_agorot: 4_000_000n,
    overhead_weighted: true,
    profit_after_overhead_agorot: 6_000_000n,
    categories: [],
    transactions: [],
  };

  it("shows profit after the allocated share on the profit page", () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/projects/a/profit"]}>
          <Routes>
            <Route
              path="/projects/:projectId/profit"
              element={
                <ProjectProfitScreen
                  sample={{
                    project: { ...overheadProject, base_currency: "ILS", overhead_share_minor: 4_000_000n },
                    months: { basis: "cash", from: null, to: null, project_id: "a", after_overhead: true, base_currency: "ILS", months: [], by_currency: [] },
                  }}
                />
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText("+₪200,000")).toBeInTheDocument();
    // Expenses carry no minus (FLOW-328): the row's label says they are expenses.
    expect(screen.getByText("₪100,000", { selector: "bdi" })).toBeInTheDocument();
    expect(screen.queryByText("−₪100,000")).not.toBeInTheDocument();
    expect(screen.getByText("חלק בהוצאות הכלליות").nextSibling).toHaveTextContent("₪40,000");
    expect(screen.getByText("רווח אחרי הוצאות כלליות").nextSibling).toHaveTextContent("₪60,000");
  });

  it("names the share in the edit sheet from the ⋯ menu", () => {
    renderProject(overheadProject, "overview");
    // FLOW-340 C: the switch lives in the ⋯ menu.
    fireEvent.click(screen.getByRole("button", { name: "עוד" }));
    fireEvent.click(screen.getByRole("button", { name: /עריכת פרטים/ }));
    expect(screen.getByText("החלק בהוצאות כלליות ₪40,000")).toBeInTheDocument();
  });

  it("clicking the switch saves and shows the profit after the income share", async () => {
    let on = false;
    const calls: unknown[] = [];
    const projectArgs: unknown[] = [];
    rpc.impl = (name, args) => {
      if (name === "set_after_overhead") {
        calls.push(args);
        on = true;
        return Promise.resolve({ data: null, error: null });
      }
      if (name === "project_cash_months") return Promise.resolve({ data: cashMonths, error: null });
      if (name === "get_project") {
        projectArgs.push(args);
        return Promise.resolve({ data: { ...serverProject, after_overhead: on }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
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
    // The loading screen has its own עוד; wait for the page's rows first.
    await screen.findByRole("heading", { level: 1, name: "וילה רעננה" });
    fireEvent.click(screen.getByRole("button", { name: "עוד" }));
    fireEvent.click(screen.getByRole("button", { name: /עריכת פרטים/ }));
    const toggle = await screen.findByRole("switch", { name: "רווח אחרי הוצאות כלליות" });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls).toEqual([{ p_on: true, p_project_id: "a" }]);
    // The project screen counts on the company's basis, like Home (FLOW-103, decision 0170).
    expect(projectArgs).toContainEqual(expect.objectContaining({ p_id: "a", p_basis: null }));
    expect(screen.getByRole("switch", { name: "רווח אחרי הוצאות כלליות" })).toBeChecked();
  });

  it("rolls the switch back when the save fails", async () => {
    rpc.impl = (name) => {
      if (name === "project_cash_months") return Promise.resolve({ data: cashMonths, error: null });
      if (name === "get_project") {
        return Promise.resolve({ data: { ...serverProject, after_overhead: false }, error: null });
      }
      return Promise.resolve({ data: null, error: { message: "nope" } });
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
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
    // The loading screen has its own עוד; wait for the page's rows first.
    await screen.findByRole("heading", { level: 1, name: "וילה רעננה" });
    fireEvent.click(screen.getByRole("button", { name: "עוד" }));
    fireEvent.click(screen.getByRole("button", { name: /עריכת פרטים/ }));
    const toggle = await screen.findByRole("switch", { name: "רווח אחרי הוצאות כלליות" });
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "רווח אחרי הוצאות כלליות" })).not.toBeChecked();
    });
  });
});

describe("the project's finish row (FLOW-334)", () => {
  it("finishes the project from a row in the ⋯ menu, with a neutral confirm", async () => {
    const calls: Array<{ name: string; args: unknown }> = [];
    rpc.impl = (name, args) => {
      calls.push({ name, args });
      return Promise.resolve({ data: null, error: null });
    };
    renderProject({ ...projectBase }, "overview");
    fireEvent.click(screen.getByRole("button", { name: "עוד" }));
    const row = await screen.findByRole("button", { name: /^סיום הפרויקט/ });
    expect(row).toHaveClass("ui-row");
    fireEvent.click(row);
    // The menu closes as the confirm opens.
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "וילה רעננה" })).not.toBeInTheDocument(); });
    const confirm = await screen.findByRole("dialog", { name: /^לסיים את/ });
    const button = within(confirm).getByRole("button", { name: "סיום הפרויקט" });
    expect(button.querySelector("svg")).toBeNull();
    expect(button.className).not.toMatch(/danger/);
    fireEvent.click(button);
    await waitFor(() => {
      expect(calls.find((call) => call.name === "upsert_project")?.args).toMatchObject({ p_id: "a", p_status: "finished" });
    });
    // FLOW-445: a finish lands on the list with הסתיימו open, so the page is gone and focus does not return to עוד.
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: /^לסיים את/ })).not.toBeInTheDocument(); });
  });

  it("returns focus to עוד when the confirm is cancelled", async () => {
    renderProject({ ...projectBase }, "overview");
    fireEvent.click(screen.getByRole("button", { name: "עוד" }));
    fireEvent.click(await screen.findByRole("button", { name: /^סיום הפרויקט/ }));
    const confirm = await screen.findByRole("dialog", { name: /^לסיים את/ });
    fireEvent.click(within(confirm).getByRole("button", { name: "ביטול" }));
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: /^לסיים את/ })).not.toBeInTheDocument(); });
    await waitFor(() => { expect(screen.getByRole("button", { name: "עוד" })).toHaveFocus(); });
  });

  it("offers החזרה לפעיל on a finished project", async () => {
    renderProject({ ...projectBase, status: "finished" }, "overview");
    fireEvent.click(screen.getByRole("button", { name: "עוד" }));
    expect(await screen.findByRole("button", { name: /^החזרה לפעיל/ })).toBeInTheDocument();
  });
});
