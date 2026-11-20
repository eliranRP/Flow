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
  /** FLOW-1231: the next list_project_groups answer; a test holds it to see the edit sheet while the groups load. */
  groups: (): Promise<unknown> => Promise.resolve({ data: [], error: null }),
  /** FLOW-1243: every read the menu starts, as an rpc name or "from:<table>". */
  reads: [] as string[],
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: unknown) => {
      rpc.reads.push(name);
      // FLOW-1230: a live menu also reads the groups (on a touch or an open); the month read is the one these tests count.
      if (name === "list_project_groups") return rpc.groups();
      if (name !== "projects_cash_month") return Promise.resolve({ data: [], error: null });
      rpc.calls.push({ name, args });
      return rpc.answer();
    },
    from: (table: string) => {
      rpc.reads.push(`from:${table}`);
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
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

  // FLOW-1220: the slot keeps its place as a quiet line, so the rows above do not move when the read lands.
  it("shows a quiet, non-tappable line in the delete slot when the project cannot be deleted", async () => {
    rpc.answer = () => Promise.resolve(answer({ pending_count: 0, deletable: false }));
    const menu = renderMenu();
    await waitFor(() => { expect(menu.querySelector(".ui-skeleton-bar")).toBeNull(); });
    expect(within(menu).queryByRole("button", { name: DELETE })).not.toBeInTheDocument();
    expect(within(menu).queryByRole("button", { name: /ניסיון חוזר/ })).not.toBeInTheDocument();
    const line = within(menu).getByText("אי אפשר למחוק: יש בו תנועות").closest(".ui-row");
    expect(line).not.toBeNull();
    expect(line?.tagName).toBe("DIV");
    expect(within(menu).queryByRole("button", { name: /אי אפשר למחוק/ })).not.toBeInTheDocument();
    expect(line?.querySelector(".ui-row-chevron")).toBeNull();
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

  // FLOW-1219: the menu list is busy and a status line says it is checking, until the read lands or fails.
  it("marks the menu list busy and says it is checking, and clears both when the read lands", async () => {
    let land: (value: Answer) => void = () => undefined;
    rpc.answer = () => new Promise((resolve) => { land = resolve; });
    const menu = renderMenu();
    const list = menu.querySelector(".ui-project-menu-list");
    expect(list).toHaveAttribute("aria-busy", "true");
    expect(within(menu).getByRole("status")).toHaveTextContent("בודקים אם אפשר למחוק…");
    await waitFor(() => { expect(rpc.calls).toHaveLength(1); });
    land(answer({ pending_count: 0, deletable: true }));
    expect(await within(menu).findByRole("button", { name: DELETE })).toBeInTheDocument();
    expect(list).not.toHaveAttribute("aria-busy");
    expect(within(menu).getByRole("status")).toHaveTextContent("");
  });

  it("clears the busy mark and the checking line when the read fails", async () => {
    rpc.answer = () => Promise.resolve({ data: null, error: { message: "boom" } });
    const menu = renderMenu();
    await within(menu).findByRole("button", { name: /ניסיון חוזר/ });
    expect(menu.querySelector(".ui-project-menu-list")).not.toHaveAttribute("aria-busy");
    expect(within(menu).getByRole("status")).toHaveTextContent("");
  });
});

/** The page with the menu closed: the list's seed is there, and the menu's read has not been asked for yet. */
function renderClosedMenu() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30 * 60_000 }, mutations: { retry: false } } });
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
}

describe("the menu's read after the first paint when the list has a seed (FLOW-1212)", () => {
  beforeEach(() => {
    rpc.calls.length = 0;
  });

  it("does not read at mount; the read goes out after the paint, and the placeholder shows until it lands", async () => {
    let land: (value: Answer) => void = () => undefined;
    rpc.answer = () => new Promise((resolve) => { land = resolve; });
    renderClosedMenu();
    // Right after the page draws, nothing is sent: the seed is all the page needs.
    expect(rpc.calls).toHaveLength(0);
    await waitFor(() => { expect(rpc.calls).toHaveLength(1); });
    expect((rpc.calls[0]?.args as { p_project: string }).p_project).toBe("p1");
    fireEvent.click(screen.getByRole("button", { name: "עוד" }));
    const menu = screen.getByRole("dialog", { name: "Oak Ridge" });
    expect(menu.querySelector(".ui-skeleton-bar")).not.toBeNull();
    expect(within(menu).queryByRole("button", { name: DELETE })).not.toBeInTheDocument();
    land(answer({ pending_count: 0, deletable: true }));
    expect(await within(menu).findByRole("button", { name: DELETE })).toBeInTheDocument();
    expect(rpc.calls).toHaveLength(1);
  });

  it("opened before the deferred read has started, the read starts at once and the placeholder shows until it lands", async () => {
    let land: (value: Answer) => void = () => undefined;
    rpc.answer = () => new Promise((resolve) => { land = resolve; });
    renderClosedMenu();
    expect(rpc.calls).toHaveLength(0);
    // The tap comes before the idle moment: the menu asks for its figures now.
    fireEvent.click(screen.getByRole("button", { name: "עוד" }));
    await waitFor(() => { expect(rpc.calls).toHaveLength(1); });
    const menu = screen.getByRole("dialog", { name: "Oak Ridge" });
    expect(menu.querySelector(".ui-skeleton-bar")).not.toBeNull();
    expect(within(menu).queryByRole("button", { name: DELETE })).not.toBeInTheDocument();
    land(answer({ pending_count: 0, deletable: true }));
    expect(await within(menu).findByRole("button", { name: DELETE })).toBeInTheDocument();
    // The deferred read does not go out again once it has landed.
    await new Promise((resolve) => { setTimeout(resolve, 200); });
    expect(rpc.calls).toHaveLength(1);
  });

  it("a touch on the ⋯ button, before the menu opens, starts the read, so the menu opens with it in flight or landed", async () => {
    let land: (value: Answer) => void = () => undefined;
    rpc.answer = () => new Promise((resolve) => { land = resolve; });
    renderClosedMenu();
    expect(rpc.calls).toHaveLength(0);
    // The pointer goes down on ⋯: the read starts now, and the menu is still shut.
    fireEvent.pointerDown(screen.getByRole("button", { name: "עוד" }));
    await waitFor(() => { expect(rpc.calls).toHaveLength(1); });
    expect(screen.queryByRole("dialog", { name: "Oak Ridge" })).not.toBeInTheDocument();
    // The menu opens after the read has landed: the delete row is there, with no placeholder.
    land(answer({ pending_count: 0, deletable: true }));
    await waitFor(() => { expect(rpc.calls).toHaveLength(1); });
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    fireEvent.click(screen.getByRole("button", { name: "עוד" }));
    const menu = screen.getByRole("dialog", { name: "Oak Ridge" });
    expect(within(menu).getByRole("button", { name: DELETE })).toBeInTheDocument();
    expect(menu.querySelector(".ui-skeleton-bar")).toBeNull();
    expect(rpc.calls).toHaveLength(1);
  });
});

/** The edit sheet opened from the menu (its extras hold the קבוצה row or its place). */
function openEditSheet(menu: HTMLElement) {
  fireEvent.click(within(menu).getByRole("button", { name: /^עריכת פרטים/ }));
  return screen.getByRole("dialog", { name: "עריכת פרויקט" });
}

// The skeleton is an aria-hidden row in the edit sheet's extras.
const skeletonRow = (sheet: HTMLElement) => sheet.querySelector<HTMLElement>('.ui-row[aria-hidden="true"]');

describe("the edit sheet holds the קבוצה row's place while the groups load (FLOW-1231)", () => {
  beforeEach(() => {
    rpc.calls.length = 0;
    rpc.answer = () => Promise.resolve(answer({ pending_count: 0, deletable: true }));
    rpc.groups = () => Promise.resolve({ data: [], error: null });
  });

  it("shows a skeleton in the row's place while the groups read is in flight, then the row in the same list", async () => {
    let land: (value: unknown) => void = () => undefined;
    rpc.groups = () => new Promise((resolve) => { land = resolve; });
    const sheet = openEditSheet(renderMenu());
    const skeleton = skeletonRow(sheet);
    expect(skeleton).not.toBeNull();
    const holder = skeleton?.parentElement;
    expect(holder?.classList.contains("ui-project-list")).toBe(true);
    expect(within(sheet).queryByRole("button", { name: /^קבוצה/ })).not.toBeInTheDocument();
    land({ data: [{ id: "g1", name: "בניין לדוגמה" }], error: null });
    const group = await within(sheet).findByRole("button", { name: /^קבוצה/ });
    expect(skeletonRow(sheet)).toBeNull();
    // The row takes the skeleton's place: the same list, so the rows below it (שמירה) do not move.
    expect(group.closest(".ui-project-list")).toBe(holder);
    expect(group.closest(".ui-row")?.parentElement).toBe(holder);
  });

  it("shows nothing in the row's place when the groups read fails, since the row never showed", async () => {
    rpc.groups = () => Promise.resolve({ data: null, error: { message: "boom" } });
    const sheet = openEditSheet(renderMenu());
    await waitFor(() => { expect(skeletonRow(sheet)).toBeNull(); });
    expect(within(sheet).queryByRole("button", { name: /^קבוצה/ })).not.toBeInTheDocument();
  });

  it("shows no skeleton for a sample without groups, since no read is in flight", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30 * 60_000 }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter initialEntries={["/projects/p1"]}>
            <ProjectMenu projectId="p1" name="Oak Ridge" budget={null} finished={false} sample sampleRow={row as never} investmentTo="/projects/p1/investment" hasInvestment={false} profitTo="/projects/p1/profit" />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "עוד" }));
    const sheet = openEditSheet(screen.getByRole("dialog", { name: "Oak Ridge" }));
    expect(skeletonRow(sheet)).toBeNull();
    expect(within(sheet).queryByRole("button", { name: /^קבוצה/ })).not.toBeInTheDocument();
    expect(rpc.calls).toHaveLength(0);
  });
});

describe("the ⋯ menu's groups read is one request (FLOW-1243)", () => {
  it("reads list_project_groups once and no projects row", async () => {
    rpc.reads.length = 0;
    renderMenu();
    await waitFor(() => { expect(rpc.reads).toContain("list_project_groups"); });
    expect(rpc.reads.filter((read) => read === "list_project_groups")).toHaveLength(1);
    expect(rpc.reads.some((read) => read.startsWith("from:projects"))).toBe(false);
  });
});
