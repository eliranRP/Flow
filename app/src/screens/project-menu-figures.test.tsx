import type { ProjectsCashMonth } from "@flow/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../ui/toast";
import { ProjectMenu } from "./project-menu";

type Answer = { data: unknown; error: { message: string } | null };

const rpc = vi.hoisted(() => ({
  calls: [] as { name: string; args: unknown }[],
  /** The next projects_cash_month answer; a test holds it to see the menu before the read lands. */
  answer: (): Promise<unknown> => Promise.resolve(null),
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: unknown) => {
      rpc.calls.push({ name, args });
      return rpc.answer();
    },
  }),
}));

const row = { id: "p1", name: "Oak Ridge", status: "active", is_overhead: false, type: null, created_at: "2026-01-01T00:00:00Z", finished_on: null, budget_minor: null, spent_minor: 0, cash: [], profit_all_minor: 0, first_month: null };
const answer = (extra: object): Answer => ({ data: { base_currency: "ILS", projects: [{ ...row, ...extra }], unassigned: { count: 0, cash: [] } }, error: null });

function renderMenu() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30 * 60_000 }, mutations: { retry: false } } });
  // The Projects list's row, as it holds it: it has neither of the menu's figures (FLOW-1204).
  client.setQueryData<ProjectsCashMonth>(["projects-cash", undefined, undefined], { base_currency: "ILS", projects: [row as never], unassigned: { count: 0, cash: [] } } as never);
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/projects/p1"]}>
          <ProjectMenu projectId="p1" name="Oak Ridge" budget={null} finished={false} investmentTo="/projects/p1/investment" hasInvestment={false} profitTo="/projects/p1/profit" />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "עוד" }));
  return screen.getByRole("dialog", { name: "Oak Ridge" });
}

const DELETE = /^מחיקת הפרויקט/;

describe("the menu's delete row and waiting-lines warning wait for the project's own read (FLOW-1204)", () => {
  beforeEach(() => {
    rpc.calls.length = 0;
  });

  it("shows a placeholder in the delete row's place and a loading line in the finish sheet until the read lands", async () => {
    let land: (value: Answer) => void = () => undefined;
    rpc.answer = () => new Promise((resolve) => { land = resolve; });
    const menu = renderMenu();
    expect(menu.querySelector(".ui-skeleton-bar")).not.toBeNull();
    expect(within(menu).queryByRole("button", { name: DELETE })).not.toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("button", { name: /^סיום הפרויקט/ }));
    expect(screen.getByRole("dialog", { name: /^לסיים את/ })).toHaveTextContent("בודקים שורות ממתינות…");
    // The confirm waits for the warning, so a fast tap cannot finish before it shows.
    expect(within(screen.getByRole("dialog", { name: /^לסיים את/ })).getByRole("button", { name: "סיום הפרויקט" })).toBeDisabled();
    await waitFor(() => { expect(rpc.calls).toHaveLength(1); });
    land(answer({ pending_count: 2, deletable: false }));
    await waitFor(() => { expect(screen.getByRole("dialog", { name: /^לסיים את/ })).toHaveTextContent("יש בו 2 פריטים לאישור"); });
    expect(screen.getByRole("dialog", { name: /^לסיים את/ })).not.toHaveTextContent("בודקים");
    expect(within(screen.getByRole("dialog", { name: /^לסיים את/ })).getByRole("button", { name: "סיום הפרויקט" })).toBeEnabled();
  });

  it("swaps the placeholder for the real row when the project can be deleted", async () => {
    rpc.answer = () => Promise.resolve(answer({ pending_count: 0, deletable: true }));
    const menu = renderMenu();
    expect(await within(menu).findByRole("button", { name: DELETE })).toBeInTheDocument();
    expect(menu.querySelector(".ui-skeleton-bar")).toBeNull();
    expect(rpc.calls.map((call) => (call.args as { p_project?: string }).p_project)).toEqual(["p1"]);
  });

  it("leaves nothing in its place when the project cannot be deleted", async () => {
    rpc.answer = () => Promise.resolve(answer({ pending_count: 0, deletable: false }));
    const menu = renderMenu();
    await waitFor(() => { expect(menu.querySelector(".ui-skeleton-bar")).toBeNull(); });
    expect(within(menu).queryByRole("button", { name: DELETE })).not.toBeInTheDocument();
    expect(within(menu).queryByRole("button", { name: /ניסיון חוזר/ })).not.toBeInTheDocument();
  });

  it("says so when the read fails, in the row and in the finish sheet, and ניסיון חוזר reads again", async () => {
    rpc.answer = () => Promise.resolve({ data: null, error: { message: "boom" } });
    const menu = renderMenu();
    await within(menu).findByRole("button", { name: /ניסיון חוזר/ });
    expect(menu.querySelector(".ui-skeleton-bar")).toBeNull();
    fireEvent.click(within(menu).getByRole("button", { name: /^סיום הפרויקט/ }));
    const sheet = screen.getByRole("dialog", { name: /^לסיים את/ });
    expect(sheet).toHaveTextContent("לא הצלחנו לבדוק שורות ממתינות");
    expect(within(sheet).getByRole("button", { name: "ניסיון חוזר" })).toBeInTheDocument();
    // A failing read never blocks finishing.
    expect(within(sheet).getByRole("button", { name: "סיום הפרויקט" })).toBeEnabled();
    fireEvent.click(within(sheet).getByRole("button", { name: "חזרה" }));
    rpc.answer = () => Promise.resolve(answer({ pending_count: 0, deletable: true }));
    fireEvent.click(within(menu).getByRole("button", { name: /ניסיון חוזר/ }));
    expect(await within(menu).findByRole("button", { name: DELETE })).toBeInTheDocument();
    expect(rpc.calls).toHaveLength(2);
  });
});
