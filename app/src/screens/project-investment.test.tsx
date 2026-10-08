import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../ui/toast";
import { ViewerPreview } from "../use-is-viewer";
import { ProjectInvestmentSection, editVerdict, rawToMinor, rehabBreakdown } from "./project-investment";

type Call = { name: string; args: unknown };
const rpc = vi.hoisted(() => ({
  calls: [] as Call[],
  impl: (_name: string, _args?: unknown): Promise<{ data: unknown; error: { message: string } | null }> =>
    Promise.resolve({ data: null, error: null }),
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: unknown) => {
      rpc.calls.push({ name, args });
      return rpc.impl(name, args);
    },
  }),
}));

/** Invented figures, in minor units as the server sends them. */
const investment = {
  currency: "ILS",
  purchase_minor: 125_000_000,
  arv_minor: 190_000_000,
  value_minor: 165_000_000,
  value_date: "2026-10-01",
  rehab_minor: 31_240_000,
  rehab_other_currencies: [],
  loan_balance_minor: 80_000_000,
  loan_balance_other_currencies: [],
  forced_equity_minor: 33_760_000,
  current_equity_minor: 85_000_000,
};

function project(patch: Record<string, unknown> = {}, inv: Record<string, unknown> = {}) {
  return { id: "p1", is_overhead: false, investment: { ...investment, ...inv }, categories_by_currency: [], loans: [], ...patch };
}

function serve(data: unknown) {
  rpc.impl = (name) => {
    if (name === "get_project") return Promise.resolve({ data, error: null });
    return Promise.resolve({ data: { before: {}, after: {} }, error: null });
  };
}

function renderSection(viewer = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const section = <ProjectInvestmentSection projectId="p1" />;
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/projects/p1"]}>
          {viewer ? <ViewerPreview>{section}</ViewerPreview> : section}
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function saves(): Call[] {
  return rpc.calls.filter((call) => call.name === "set_project_investment");
}

beforeEach(() => {
  rpc.calls = [];
});

describe("ProjectInvestmentSection", () => {
  it("reads the project on the cash basis for all time and shows the figures", async () => {
    serve(project());
    renderSection();
    expect(await screen.findByText("₪1,250,000")).toBeInTheDocument();
    expect(screen.getByText("מתחילת הפרויקט")).toBeInTheDocument();
    expect(screen.getByText("₪1,900,000")).toBeInTheDocument();
    expect(screen.getByText("₪337,600")).toBeInTheDocument();
    expect(screen.getByText("₪850,000")).toBeInTheDocument();
    expect(screen.getByText("01/10/2026")).toBeInTheDocument();
    expect(rpc.calls.find((call) => call.name === "get_project")?.args).toEqual({ p_id: "p1", p_basis: "cash" });
  });

  it("names a missing figure instead of an equity, and offers הוספה", async () => {
    serve(project({}, { arv_minor: null, forced_equity_minor: null }));
    renderSection();
    expect(await screen.findByText("חסר שווי אחרי שיפוץ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /שווי אחרי שיפוץ.*הוספה/ })).toBeInTheDocument();
    expect(screen.queryByText("₪0")).not.toBeInTheDocument();
  });

  it("says another currency blocks the equity and lists the loan apart", async () => {
    serve(project({}, {
      loan_balance_other_currencies: [{ currency: "USD", balance_minor: 12_000_000 }],
      current_equity_minor: null,
    }));
    renderSection();
    expect(await screen.findByText("לא מחושב, יש הלוואה בדולר")).toBeInTheDocument();
    const loans = screen.getByRole("button", { name: /יתרת הלוואות/ });
    expect(within(loans).getByText("$120,000")).toBeInTheDocument();
    expect(loans).toHaveTextContent("ועוד $120,000 בדולר");
  });

  it("is read-only for a viewer: no chevrons, no הוספה, nothing opens", async () => {
    serve(project({}, { arv_minor: null, forced_equity_minor: null }));
    const { container } = renderSection(true);
    expect(await screen.findByText("₪1,250,000")).toBeInTheDocument();
    const card = container.querySelector(".ui-invest") as HTMLElement;
    expect(within(card).queryAllByRole("button")).toHaveLength(0);
    expect(within(card).queryByText("הוספה")).not.toBeInTheDocument();
    expect(card.querySelector(".ui-row-chevron")).toBeNull();
  });

  it("shows no card on the overhead project", async () => {
    serve(project({ is_overhead: true }));
    const { container } = renderSection();
    await waitFor(() => { expect(rpc.calls.some((call) => call.name === "get_project")).toBe(true); });
    await waitFor(() => { expect(container.querySelector(".ui-invest")).toBeNull(); });
    expect(screen.queryByText("השקעה")).not.toBeInTheDocument();
  });

  it("saves only the edited figure on שמירה", async () => {
    serve(project());
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: /מחיר קנייה/ }));
    const field = await screen.findByRole("textbox", { name: "מחיר קנייה" });
    fireEvent.change(field, { target: { value: "1300000" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(saves()).toHaveLength(1); });
    expect(saves()[0]?.args).toEqual({ p_project_id: "p1", p_patch: { purchase_minor: 130_000_000 } });
  });

  it("saves the figure when the sheet closes", async () => {
    serve(project());
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: /שווי אחרי שיפוץ/ }));
    const field = await screen.findByRole("textbox", { name: "שווי אחרי שיפוץ" });
    fireEvent.change(field, { target: { value: "2000000" } });
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    await waitFor(() => { expect(saves()).toHaveLength(1); });
    expect(saves()[0]?.args).toEqual({ p_project_id: "p1", p_patch: { arv_minor: 200_000_000 } });
  });

  it("clears the figure with null on מחיקה", async () => {
    serve(project());
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: /מחיר קנייה/ }));
    fireEvent.click(await screen.findByRole("button", { name: "מחיקה" }));
    await waitFor(() => { expect(saves()).toHaveLength(1); });
    expect(saves()[0]?.args).toEqual({ p_project_id: "p1", p_patch: { purchase_minor: null } });
  });

  it("saves today's value with its date, which starts on today", async () => {
    serve(project());
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: /שווי היום/ }));
    expect(await screen.findByText(/היום ·/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "שווי היום" }), { target: { value: "1700000" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(saves()).toHaveLength(1); });
    const args = saves()[0]?.args as { p_patch: Record<string, unknown> };
    expect(Object.keys(args.p_patch).sort()).toEqual(["value_date", "value_minor"]);
    expect(args.p_patch.value_minor).toBe(170_000_000);
    expect(args.p_patch.value_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("investment helpers", () => {
  it("parses the field's digits to minor units", () => {
    expect(rawToMinor("")).toBeNull();
    expect(rawToMinor("1250000.5")).toBe(125_000_050n);
    expect(rawToMinor("12.")).toBe(1_200n);
  });

  it("holds an emptied figure instead of clearing it on close", () => {
    expect(editVerdict("purchase", { minor: 100n, date: null }, { raw: "", date: "2026-10-08", dateTouched: false })).toEqual({ kind: "hold" });
    expect(editVerdict("purchase", { minor: null, date: null }, { raw: "", date: "2026-10-08", dateTouched: false })).toEqual({ kind: "clean" });
  });

  it("lists rehab by category and the left-out ones apart, and checks the sum", () => {
    const costs = [
      { id: "a", name: "חומרים", currency: "ILS", minor: 700n },
      { id: null, name: null, currency: "ILS", minor: 100n },
      { id: "b", name: "רכישת נכס", currency: "ILS", minor: 5_000n },
      { id: "a", name: "חומרים", currency: "ILS", minor: 200n },
      { id: "c", name: "חומרים", currency: "USD", minor: 300n },
    ];
    const categories = [
      { id: "a", name: "חומרים", in_rehab: true },
      { id: "b", name: "רכישת נכס", in_rehab: false, excluded_from_pnl: true },
    ];
    const result = rehabBreakdown(costs, categories, "ILS", 1_000n);
    expect(result.counted.map((line) => [line.name, line.minor])).toEqual([["חומרים", 900n], ["בלי קטגוריה", 100n]]);
    expect(result.left).toEqual([expect.objectContaining({ name: "רכישת נכס", reason: "מחוץ לרווח והפסד" })]);
    expect(result.addsUp).toBe(true);
    expect(rehabBreakdown(costs, categories, "ILS", 999n).addsUp).toBe(false);
  });
});

describe("project page", () => {
  it("shows the card under the categories, and none on the overhead project", async () => {
    const { ProjectDetailScreen } = await import("./project-detail-screen");
    const { Route, Routes } = await import("react-router-dom");
    const base = {
      id: "p1",
      name: "פרויקט לדוגמה",
      status: "active",
      state_label: "פעיל",
      budget_agorot: null,
      income_agorot: 0,
      direct_agorot: 0,
      shared_agorot: 0,
      profit_agorot: 0,
      categories: [],
      transactions: [],
    };
    for (const overhead of [false, true]) {
      rpc.calls = [];
      rpc.impl = (name, args) => {
        if (name !== "get_project") return Promise.resolve({ data: [], error: null });
        const cash = (args as { p_basis?: string }).p_basis === "cash";
        return Promise.resolve({ data: cash ? project({ is_overhead: overhead }) : { ...base, is_overhead: overhead }, error: null });
      };
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const view = render(
        <QueryClientProvider client={client}>
          <ToastProvider>
            <MemoryRouter initialEntries={["/projects/p1"]}>
              <Routes>
                <Route path="/projects/:projectId" element={<ProjectDetailScreen />} />
              </Routes>
            </MemoryRouter>
          </ToastProvider>
        </QueryClientProvider>,
      );
      await screen.findByText("הוצאות לפי קטגוריה");
      await waitFor(() => { expect(rpc.calls.some((call) => (call.args as { p_basis?: string }).p_basis === "cash")).toBe(true); });
      if (overhead) {
        await waitFor(() => { expect(view.container.querySelector(".ui-invest")).toBeNull(); });
      } else {
        expect(await screen.findByText("₪1,250,000")).toBeInTheDocument();
        const heads = [...view.container.querySelectorAll("h2")].map((node) => node.textContent);
        expect(heads.indexOf("השקעה")).toBe(heads.indexOf("הוצאות לפי קטגוריה") + 1);
      }
      view.unmount();
    }
  });
});
