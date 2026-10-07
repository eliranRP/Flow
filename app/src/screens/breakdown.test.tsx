import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GROUP_BY_KEY } from "../breakdown";
import { BooksProvider } from "../use-books";
import { BreakdownLinesScreen, BreakdownScreen } from "./breakdown";

const rpc = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: unknown }>,
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

// Invented figures only.
const expenses = {
  direction: "expense",
  basis: "invoiced",
  group_by: "category",
  from: "2026-10-01",
  to: "2026-10-31",
  totals: [
    { currency: "ILS", amount_minor: 4_832_000, count: 21 },
    { currency: "USD", amount_minor: 120_000, count: 1 },
  ],
  groups: [
    { key: "c1", name: "חומרי בנייה לדוגמה", currency: "ILS", amount_minor: 3_000_000, count: 12, shared: true },
    { key: "none", name: null, currency: "ILS", amount_minor: 1_832_000, count: 9, shared: false },
    { key: "c2", name: "תוכנה לדוגמה", currency: "USD", amount_minor: 120_000, count: 1, shared: false },
  ],
  excluded: [{ currency: "ILS", amount_minor: 50_000, count: 2 }],
  review_count: 3,
};

const lines = {
  rows: [
    {
      transaction_id: "t1",
      part: null,
      description: "חשבונית 101",
      supplier_name: "ספק לדוגמה",
      project_name: "פרויקט אלפא",
      category_name: "חומרי בנייה לדוגמה",
      doc_date: "2026-10-05",
      currency: "ILS",
      amount_minor: 420_000,
      shared: false,
    },
  ],
  has_more: true,
};

function wrap(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BooksProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/flow/:direction" element={<BreakdownScreen />} />
            <Route path="/flow/:direction/excluded/:currency" element={<BreakdownLinesScreen excluded />} />
            <Route path="/flow/:direction/:groupBy/:currency/:groupKey" element={<BreakdownLinesScreen />} />
            <Route path="/" element={<p>בית</p>} />
          </Routes>
        </MemoryRouter>
      </BooksProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rpc.calls = [];
  window.localStorage.removeItem(GROUP_BY_KEY);
  rpc.impl = (name, args) => {
    if (name === "get_breakdown") {
      const by = (args as { p_group_by: string }).p_group_by;
      return Promise.resolve({ data: { ...expenses, group_by: by }, error: null });
    }
    if (name === "get_breakdown_lines") return Promise.resolve({ data: lines, error: null });
    return Promise.resolve({ data: null, error: null });
  };
});

afterEach(() => {
  window.localStorage.removeItem(GROUP_BY_KEY);
});

describe("Breakdown screen", () => {
  it("asks for Home's basis and period, and lists the groups with their totals", async () => {
    wrap("/flow/expense");
    expect(await screen.findByText("חומרי בנייה לדוגמה")).toBeInTheDocument();
    const call = rpc.calls.find((c) => c.name === "get_breakdown");
    expect(call?.args).toMatchObject({ p_direction: "expense", p_group_by: "category", p_basis: "invoiced" });
    expect(call?.args).toHaveProperty("p_from");
    expect(screen.getByText("בלי קטגוריה")).toBeInTheDocument();
    expect(screen.getByText("12 תנועות · כולל חלק משותף")).toBeInTheDocument();
    expect(screen.getByText("−₪48,320")).toBeInTheDocument();
    expect(screen.getAllByText("−$1,200")).toHaveLength(2);
    // Every currency's group opens its lines.
    expect(screen.getByRole("link", { name: /תוכנה לדוגמה/ })).toHaveAttribute("href", "/flow/expense/category/USD/c2");
  });

  it("shows the waiting count with no amount, and the kept-out lines apart from the total", async () => {
    wrap("/flow/expense");
    const waiting = await screen.findByRole("link", { name: /3 ממתינים לאישור/ });
    expect(waiting).toHaveAttribute("href", "/review");
    expect(within(waiting).queryByText(/₪/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "לא נכלל בסכום" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /מחוץ לרווח/ })).toHaveAttribute("href", "/flow/expense/excluded/ILS");
  });

  it("regroups by supplier and remembers the choice on the device", async () => {
    wrap("/flow/expense");
    await screen.findByText("חומרי בנייה לדוגמה");
    fireEvent.click(screen.getByRole("radio", { name: "ספק" }));
    await waitFor(() => {
      expect(rpc.calls.some((c) => c.name === "get_breakdown" && (c.args as { p_group_by: string }).p_group_by === "payer")).toBe(true);
    });
    expect(window.localStorage.getItem(GROUP_BY_KEY)).toBe("payer");
  });

  it("calls the income grouping לקוח", async () => {
    wrap("/flow/income");
    expect(await screen.findByRole("radio", { name: "לקוח" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "נכנס" })).toBeInTheDocument();
  });

  it("shows the empty state with a period button", async () => {
    rpc.impl = () => Promise.resolve({ data: { ...expenses, totals: [], groups: [], excluded: [], review_count: 0 }, error: null });
    wrap("/flow/expense");
    expect(await screen.findByText("אין הוצאות בתקופה הזו")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "בחירת תקופה" })).toBeInTheDocument();
  });

  it("sends an unknown direction back to Home", () => {
    wrap("/flow/sideways");
    expect(screen.getByText("בית")).toBeInTheDocument();
  });
});

describe("Breakdown lines screen", () => {
  it("lists a group's lines with its name and total, and pages", async () => {
    wrap("/flow/expense/category/ILS/c1");
    expect(await screen.findByText("ספק לדוגמה")).toBeInTheDocument();
    const call = rpc.calls.find((c) => c.name === "get_breakdown_lines");
    expect(call?.args).toMatchObject({
      p_direction: "expense",
      p_group_by: "category",
      p_group_key: "c1",
      p_currency: "ILS",
      p_excluded: false,
      p_offset: 0,
    });
    expect(await screen.findByRole("heading", { name: "חומרי בנייה לדוגמה" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ספק לדוגמה/ })).toHaveAttribute("href", "/transactions/t1");
    fireEvent.click(screen.getByRole("button", { name: "עוד תנועות" }));
    await waitFor(() => {
      expect(rpc.calls.some((c) => c.name === "get_breakdown_lines" && (c.args as { p_offset: number }).p_offset === 40)).toBe(true);
    });
  });

  it("asks for the kept-out lines", async () => {
    wrap("/flow/expense/excluded/ILS");
    await screen.findByText("ספק לדוגמה");
    const call = rpc.calls.find((c) => c.name === "get_breakdown_lines");
    expect(call?.args).toMatchObject({ p_excluded: true, p_currency: "ILS" });
    expect(screen.getByRole("heading", { name: "מחוץ לרווח" })).toBeInTheDocument();
  });
});
