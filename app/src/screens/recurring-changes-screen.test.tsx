import type { RecurringChange } from "@flow/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as forecast from "../forecast";
import { SAMPLE_RECURRING_THIS_MONTH } from "../forecast-sample";
import { projectAttentionRows } from "./project-attention";
import { RecurringChangesScreen } from "./recurring-changes-screen";
import { ToastProvider } from "../ui/toast";

// Two changes: the power bill up 38%, and the arnona bill as a drop.
const [power, arnona] = SAMPLE_RECURRING_THIS_MONTH;
if (power == null || arnona == null) throw new Error("sample");
const TWO: RecurringChange[] = [power, { ...arnona, change_percent: -30, amount_minor: -91_000n }];

function withQuery(node: ReactNode) {
  return <QueryClientProvider client={new QueryClient()}><ToastProvider>{node}</ToastProvider></QueryClientProvider>;
}

function renderAt(path: string) {
  return render(withQuery(
    <MemoryRouter initialEntries={[path]}>
      <RecurringChangesScreen sample={TWO} />
    </MemoryRouter>,
  ));
}

describe("חיובים שהשתנו (FLOW-1021)", () => {
  it("lists only the changed charges, each with its amount, its usual one and its payment", () => {
    renderAt("/recurring/changes");
    expect(screen.getByRole("heading", { name: "חיובים שהשתנו" })).toBeTruthy();
    const links = screen.getAllByRole("link").filter((link) => link.getAttribute("href")?.startsWith("/recurring/expense/"));
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/recurring/expense/s-power?project=p1", "/recurring/expense/s-arnona?project=p2"]);
    expect(links[0]?.textContent).toContain("חשמל עלה");
    expect(links[0]?.textContent).toContain("₪2,550 במקום ₪1,850");
    expect(links[1]?.textContent).toContain("ארנונה עירונית ירד");
    expect(links[1]?.textContent).toContain("₪910 במקום ₪1,300");
  });

  it("narrows to the project named in the address", () => {
    renderAt("/recurring/changes?project=p2");
    const links = screen.getAllByRole("link").filter((link) => link.getAttribute("href")?.startsWith("/recurring/expense/"));
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/recurring/expense/s-arnona?project=p2"]);
  });

  it("says so when nothing changed", () => {
    render(withQuery(
      <MemoryRouter>
        <RecurringChangesScreen sample={[]} />
      </MemoryRouter>,
    ));
    expect(screen.getByText("אין שינויים")).toBeTruthy();
  });

  it("marks a change as seen with its X, and ביטול brings it back (V3-Changes)", async () => {
    renderAt("/recurring/changes");
    fireEvent.click(screen.getByRole("button", { name: "סקרתי: חשמל עלה" }));
    expect(screen.queryByText("חשמל עלה")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "ביטול" }));
    expect(await screen.findByText("חשמל עלה")).toBeTruthy();
  });

  it("opens the project's own list from the project page", () => {
    const changes = TWO.map((row) => ({ ...row, project_id: "p1" }));
    const [row] = projectAttentionRows({ projectId: "p1", pending: 0, late: [], changes, search: "" });
    expect(row?.to).toBe("/recurring/changes?project=p1");
  });
});

// The live reads: the screen's own hooks, mocked so the test drives what the server returns.
describe("חיובים שהשתנו, live (FLOW-1021 r1)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function live(path: string) {
    return render(withQuery(
      <MemoryRouter initialEntries={[path]}>
        <RecurringChangesScreen />
      </MemoryRouter>,
    ));
  }

  function result(over: Partial<{ data: RecurringChange[] | undefined; isError: boolean; refetch: () => Promise<unknown> }>) {
    return { data: undefined, isError: false, refetch: vi.fn(() => Promise.resolve()), ...over } as unknown as ReturnType<typeof forecast.useRecurringChangesQuery>;
  }

  it("reads the company's changes, not the project's, without ?project=", () => {
    const company = vi.spyOn(forecast, "useRecurringChangesQuery").mockReturnValue(result({ data: TWO }));
    const own = vi.spyOn(forecast, "useProjectRecurringChangesQuery").mockReturnValue(result({}));
    live("/recurring/changes");
    expect(company).toHaveBeenCalledWith(true);
    expect(own).toHaveBeenCalledWith("", false);
    expect(screen.getAllByRole("link").filter((link) => link.getAttribute("href")?.startsWith("/recurring/expense/"))).toHaveLength(2);
  });

  it("reads the project's own changes with ?project=", () => {
    const company = vi.spyOn(forecast, "useRecurringChangesQuery").mockReturnValue(result({}));
    const own = vi.spyOn(forecast, "useProjectRecurringChangesQuery").mockReturnValue(result({ data: [{ ...power, project_id: "p9" }] }));
    live("/recurring/changes?project=p9");
    expect(company).toHaveBeenCalledWith(false);
    expect(own).toHaveBeenCalledWith("p9", true);
    expect(screen.getByText("חשמל עלה")).toBeTruthy();
  });

  it("treats an empty ?project= as the company's list", () => {
    const company = vi.spyOn(forecast, "useRecurringChangesQuery").mockReturnValue(result({ data: TWO }));
    vi.spyOn(forecast, "useProjectRecurringChangesQuery").mockReturnValue(result({}));
    live("/recurring/changes?project=");
    expect(company).toHaveBeenCalledWith(true);
  });

  // FLOW-1030: the screen's own head over its rows' skeleton, not the קבועים list's.
  it("loads under its own title and Back, over two skeleton rows", () => {
    vi.spyOn(forecast, "useRecurringChangesQuery").mockReturnValue(result({}));
    vi.spyOn(forecast, "useProjectRecurringChangesQuery").mockReturnValue(result({}));
    const { container } = live("/recurring/changes");
    expect(screen.getByRole("heading", { name: "חיובים שהשתנו" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "קבועים" })).toBeNull();
    expect(screen.getByRole("button", { name: "חזרה לבית" })).toBeTruthy();
    expect(container.querySelector(".ui-changes-skel [role=status]")?.textContent).toBe("טוען…");
    expect(container.querySelectorAll(".ui-changes-skel .ui-skel-list-row")).toHaveLength(2);
  });

  // FLOW-1030: opened from a project, Back names it and goes back to its page.
  it("names the project on Back, from its changes or the project page's read", () => {
    vi.spyOn(forecast, "useRecurringChangesQuery").mockReturnValue(result({}));
    vi.spyOn(forecast, "useProjectRecurringChangesQuery").mockReturnValue(result({ data: [{ ...power, project_id: "p9", project_name: "בית הכרם 4" }] }));
    live("/recurring/changes?project=p9");
    expect(screen.getByRole("button", { name: "חזרה לבית הכרם 4" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "חזרה לבית" })).toBeNull();
  });

  it("names the project on Back while its changes load, from the project page's read", () => {
    vi.spyOn(forecast, "useRecurringChangesQuery").mockReturnValue(result({}));
    vi.spyOn(forecast, "useProjectRecurringChangesQuery").mockReturnValue(result({}));
    const client = new QueryClient();
    client.setQueryData(["project", "off", "p9", "2026-10-01", "2026-10-31"], { id: "p9", name: "מגדלי הים" });
    render(
      <QueryClientProvider client={client}><ToastProvider>
        <MemoryRouter initialEntries={["/recurring/changes?project=p9"]}>
          <RecurringChangesScreen />
        </MemoryRouter>
      </ToastProvider></QueryClientProvider>,
    );
    expect(screen.getByRole("button", { name: "חזרה למגדלי הים" })).toBeTruthy();
  });

  it("goes back to the project's page on a deep link", () => {
    vi.spyOn(forecast, "useRecurringChangesQuery").mockReturnValue(result({}));
    vi.spyOn(forecast, "useProjectRecurringChangesQuery").mockReturnValue(result({ data: [] }));
    render(withQuery(
      <MemoryRouter initialEntries={["/recurring/changes?project=p9"]}>
        <Routes>
          <Route path="/recurring/changes" element={<RecurringChangesScreen />} />
          <Route path="/projects/:id" element={<p>project page</p>} />
        </Routes>
      </MemoryRouter>,
    ));
    fireEvent.click(screen.getByRole("button", { name: "חזרה לפרויקט" }));
    expect(screen.getByText("project page")).toBeTruthy();
  });

  it("says the read failed and reads again on נסו שוב", () => {
    const refetch = vi.fn(() => Promise.resolve());
    vi.spyOn(forecast, "useRecurringChangesQuery").mockReturnValue(result({ isError: true, refetch }));
    vi.spyOn(forecast, "useProjectRecurringChangesQuery").mockReturnValue(result({}));
    live("/recurring/changes");
    expect(screen.getByText("החיובים לא נטענו")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "נסו שוב" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
