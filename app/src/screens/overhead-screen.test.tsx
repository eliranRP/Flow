import type { ProjectDetail } from "@flow/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../ui/toast";
import { ProjectDetailScreen } from "./flow-screens";

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

function renderProject(sample: NonNullable<ProjectDetail>, section: "overview" | "expenses" = "expenses") {
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

describe("project category breakdown", () => {
  it("adds a waiting line so the category list matches the project expenses", () => {
    renderProject({
      ...projectBase,
      pending_count: 1,
      pending_agorot: 5_000n,
    });
    expect(screen.getByRole("link", { name: /הובלה/ })).toHaveAttribute("href", expect.stringMatching(/^\/projects\/a\/categories\/h\?period=/));
    expect(screen.getByRole("link", { name: /1 ממתינה לאישור/ })).toHaveAttribute("href", "/review?project=a");
    // FLOW-334: the waiting row reads as Home's review row, not a category.
    const waiting = screen.getByRole("link", { name: /1 ממתינה לאישור/ });
    expect(waiting).toHaveClass("ui-row-pending");
    expect(waiting.querySelector(".ui-row-icon svg")).not.toBeNull();
    expect(screen.queryByText("אין עדיין הוצאות מסווגות.")).not.toBeInTheDocument();
    expect(screen.queryByText("כולל חלק מהוצאות משותפות")).not.toBeInTheDocument();
  });

  it("keeps a project that is only waiting off the empty category sentence", () => {
    renderProject({
      ...projectBase,
      categories: [],
      pending_count: 2,
      pending_agorot: 8_000n,
    });
    expect(screen.getByText("2 ממתינות לאישור")).toBeInTheDocument();
    expect(screen.queryByText("אין עדיין הוצאות מסווגות.")).not.toBeInTheDocument();
  });

  it("shows the shared-cost note only when a line includes a share", () => {
    const { rerender } = renderProject({
      ...projectBase,
      categories: [
        { id: "h", name: "הובלה", amount_agorot: 7_000n, has_shared_share: true },
        { id: "m", name: "חומרים", amount_agorot: 2_000n, has_shared_share: false },
      ],
    });
    const haul = screen.getByRole("link", { name: /הובלה/ });
    const note = within(haul).getByText("כולל חלק מהוצאות משותפות");
    expect(note).toHaveClass("ui-shared-note");
    expect(note).toHaveClass("t-hint");
    expect(within(screen.getByRole("link", { name: /חומרים/ })).queryByText("כולל חלק מהוצאות משותפות")).not.toBeInTheDocument();
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <MemoryRouter initialEntries={["/projects/a"]}>
            <Routes>
              <Route
                path="/projects/:projectId"
                element={
                  <ProjectDetailScreen
                    section="expenses"
                    sample={{
                      ...projectBase,
                      categories: [{ id: "m", name: "חומרים", amount_agorot: 2_000n, has_shared_share: false }],
                    }}
                  />
                }
              />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(screen.queryByText("כולל חלק מהוצאות משותפות")).not.toBeInTheDocument();
  });

  it("says there are no classified expenses when nothing is waiting either", () => {
    renderProject({
      ...projectBase,
      direct_agorot: 0n,
      profit_agorot: 0n,
      categories: [],
    });
    expect(screen.getByText("אין עדיין הוצאות מסווגות.")).toBeInTheDocument();
  });
});

describe("project overhead hero", () => {
  it("shows profit after the allocated share when the switch is on", () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter initialEntries={["/projects/a"]}>
            <Routes>
              <Route
                path="/projects/:projectId"
                element={
                  <ProjectDetailScreen
                    sample={{
                      id: "a",
                      name: "וילה רעננה",
                      status: "active",
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
                    }}
                  />
                }
              />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText("₪200,000")).toBeInTheDocument();
    // The band labels the figure הוצאות, so it carries no minus (FLOW-328).
    expect(screen.getByText("₪100,000", { selector: "bdi" })).toBeInTheDocument();
    expect(screen.queryByText("−₪100,000")).not.toBeInTheDocument();
    expect(screen.getByText("₪60,000")).toBeInTheDocument();
    expect(screen.queryByText("₪100,000", { selector: ".t-display" })).not.toBeInTheDocument();
    // FLOW-340 C: the switch lives in the ⋯ menu.
    fireEvent.click(screen.getByRole("button", { name: "עוד" }));
    expect(screen.getByText("החלק בהוצאות הכלליות: ₪40,000")).toBeInTheDocument();
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
    await screen.findByRole("link", { name: /^הכנסות/ });
    fireEvent.click(screen.getByRole("button", { name: "עוד" }));
    const toggle = await screen.findByRole("switch", { name: "רווח אחרי הוצאות כלליות" });
    expect(toggle).not.toBeChecked();
    expect(screen.queryByText("₪60,000")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(screen.getByText("₪60,000")).toBeInTheDocument();
    });
    expect(calls).toEqual([{ p_on: true, p_project_id: "a" }]);
    // The project screen asks for the same books basis as Home (decision 0060).
    expect(projectArgs).toContainEqual(expect.objectContaining({ p_id: "a", p_basis: "invoiced" }));
    expect(screen.getByRole("switch", { name: "רווח אחרי הוצאות כלליות" })).toBeChecked();
  });

  it("rolls the switch back when the save fails", async () => {
    rpc.impl = (name) => {
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
    await screen.findByRole("link", { name: /^הכנסות/ });
    fireEvent.click(screen.getByRole("button", { name: "עוד" }));
    const toggle = await screen.findByRole("switch", { name: "רווח אחרי הוצאות כלליות" });
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "רווח אחרי הוצאות כלליות" })).not.toBeChecked();
    });
    expect(document.querySelector(".t-display")?.textContent).toBe("₪100,000");
    expect(screen.queryByText("₪60,000")).not.toBeInTheDocument();
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
    const row = await screen.findByRole("button", { name: "סיום הפרויקט" });
    expect(row).toHaveClass("ui-row");
    fireEvent.click(row);
    // The menu closes as the confirm opens.
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "עוד" })).not.toBeInTheDocument(); });
    const confirm = await screen.findByRole("dialog", { name: "לסיים את הפרויקט?" });
    const button = within(confirm).getByRole("button", { name: "סיום הפרויקט" });
    expect(button.querySelector("svg")).toBeNull();
    expect(button.className).not.toMatch(/danger/);
    fireEvent.click(button);
    await waitFor(() => {
      expect(calls.find((call) => call.name === "upsert_project")?.args).toMatchObject({ p_id: "a", p_status: "finished" });
    });
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "לסיים את הפרויקט?" })).not.toBeInTheDocument(); });
    await waitFor(() => { expect(screen.getByRole("button", { name: "עוד" })).toHaveFocus(); });
  });

  it("returns focus to עוד when the confirm is cancelled", async () => {
    renderProject({ ...projectBase }, "overview");
    fireEvent.click(screen.getByRole("button", { name: "עוד" }));
    fireEvent.click(await screen.findByRole("button", { name: "סיום הפרויקט" }));
    const confirm = await screen.findByRole("dialog", { name: "לסיים את הפרויקט?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "ביטול" }));
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "לסיים את הפרויקט?" })).not.toBeInTheDocument(); });
    await waitFor(() => { expect(screen.getByRole("button", { name: "עוד" })).toHaveFocus(); });
  });

  it("offers החזרה לפעיל on a finished project", async () => {
    renderProject({ ...projectBase, status: "finished" }, "overview");
    fireEvent.click(screen.getByRole("button", { name: "עוד" }));
    expect(await screen.findByRole("button", { name: "החזרה לפעיל" })).toBeInTheDocument();
  });
});
