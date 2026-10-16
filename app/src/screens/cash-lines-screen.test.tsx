import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { shiftMonthKey } from "../period";
import { renderWithProviders } from "../test-render";
import { israelToday } from "../ui/date-math";
import { CashLinesScreen } from "./cash-lines-screen";
import { CashMonthScreen } from "./cash-screens";

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

const current = israelToday().slice(0, 7);
const earlier = shiftMonthKey(current, -1);

function currencyRow(currency: string, inMinor: number, outMinor: number, profit: number) {
  return {
    currency,
    in_minor: inMinor,
    out_minor: outMinor,
    net_minor: inMinor - outMinor,
    profit_minor: profit,
    excluded_count: 0,
    excluded_in_minor: 0,
    excluded_out_minor: 0,
  };
}

// Invented figures only.
const months = {
  basis: "paid",
  base_currency: "ILS",
  months: [
    { month: `${current}-01`, by_currency: [currencyRow("ILS", 1_800_000, 1_480_000, 560_000)] },
    { month: `${earlier}-01`, by_currency: [currencyRow("ILS", 100_000, 215_000, -40_000), currencyRow("USD", 0, 30_000, 0)] },
  ],
};

const lines = {
  rows: [
    {
      transaction_id: "t1",
      part: "principal",
      description: "תשלום הלוואה",
      supplier_name: "בנק לדוגמה",
      project_name: "בית לדוגמה",
      category_name: "קרן הלוואה",
      doc_date: `${earlier}-02`,
      cash_month_date: `${earlier}-03`,
      currency: "ILS",
      amount_minor: 120_000,
      side: "out",
      shared: false,
      source: "mercury",
      kept_out: false,
    },
  ],
  has_more: false,
};

function wrap(path: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/cash/:month" element={<CashMonthScreen />} />
      <Route path="/cash/:month/:side/:currency" element={<CashLinesScreen />} />
      <Route path="/cash/year/:year" element={<p>שנה</p>} />
      <Route path="/" element={<p>בית</p>} />
    </Routes>,
    { route: path },
  );
}

beforeEach(() => {
  rpc.calls = [];
  rpc.impl = (name) => {
    if (name === "cash_months") return Promise.resolve({ data: months, error: null });
    if (name === "cash_month_lines") return Promise.resolve({ data: lines, error: null });
    return Promise.resolve({ data: null, error: null });
  };
});

describe("Cash lines", () => {
  it("asks for the month, side and currency, and lists the lines with no minus under יצא", async () => {
    wrap(`/cash/${earlier}/out/ILS`);
    expect(await screen.findByText("בנק לדוגמה")).toBeInTheDocument();
    expect(rpc.calls.find((c) => c.name === "cash_month_lines")?.args).toMatchObject({
      p_month: `${earlier}-01`,
      p_side: "out",
      p_currency: "ILS",
      p_offset: 0,
    });
    expect(screen.getByRole("heading", { name: "יצא" })).toBeInTheDocument();
    expect(screen.queryByText(/^−₪1,200/)).toBeNull();
    expect(screen.getByRole("link", { name: /בנק לדוגמה/ })).toHaveAttribute("href", "/transactions/t1");
  });

  it("switches currency in place", async () => {
    wrap(`/cash/${earlier}/out/ILS`);
    await screen.findByText("בנק לדוגמה");
    fireEvent.click(screen.getByRole("radio", { name: "USD" }));
    await waitFor(() => {
      expect(rpc.calls.some((c) => c.name === "cash_month_lines" && (c.args as { p_currency: string }).p_currency === "USD")).toBe(true);
    });
  });

  it("loads every page before it shows the totals and the groups (FLOW-366)", async () => {
    const page = (id: string) => ({ ...lines.rows[0], transaction_id: id, description: id, supplier_name: id });
    rpc.impl = (name, args) => {
      if (name === "cash_months") return Promise.resolve({ data: months, error: null });
      if (name === "cash_month_lines") {
        const offset = (args as { p_offset: number }).p_offset;
        return Promise.resolve({
          data: offset === 0 ? { rows: [page("t-first")], has_more: true } : { rows: [page("t-second")], has_more: false },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    };
    wrap(`/cash/${earlier}/out/ILS`);
    expect(await screen.findByText("t-second")).toBeInTheDocument();
    expect(rpc.calls.filter((c) => c.name === "cash_month_lines").map((c) => (c.args as { p_offset: number }).p_offset)).toEqual([0, 200]);
    expect(rpc.calls.find((c) => c.name === "cash_month_lines")?.args).toMatchObject({ p_limit: 200 });
    expect(screen.queryByRole("button", { name: "עוד תנועות" })).toBeNull();
  });

  it("flips the side in place and keeps the order chip", async () => {
    wrap(`/cash/${earlier}/out/ILS?order=amount`);
    await screen.findByText("בנק לדוגמה");
    fireEvent.click(screen.getByRole("radio", { name: "נכנס" }));
    await waitFor(() => {
      expect(rpc.calls.some((c) => c.name === "cash_month_lines" && (c.args as { p_side: string }).p_side === "in")).toBe(true);
    });
  });

  it("sets the order from the chips, and groups by project with the largest first", async () => {
    wrap(`/cash/${earlier}/out/ILS`);
    await screen.findByText("בנק לדוגמה");
    expect(screen.getByRole("button", { name: "לפי תאריך" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "לפי פרויקט" }));
    expect(await screen.findByRole("heading", { name: "בית לדוגמה" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "לפי פרויקט" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("Cash lines profit leaves out (FLOW-418)", () => {
  it("reads the not_in_profit side, shows net less profit, and gives money out its minus", async () => {
    const capital = { ...lines.rows[0], transaction_id: "t2", part: null, supplier_name: "שותף לדוגמה", category_name: "השקעת בעלים", amount_minor: 45_000, side: "in" };
    rpc.impl = (name) => {
      if (name === "cash_months") return Promise.resolve({ data: months, error: null });
      if (name === "cash_month_lines") return Promise.resolve({ data: { rows: [lines.rows[0], capital], has_more: false }, error: null });
      return Promise.resolve({ data: null, error: null });
    };
    wrap(`/cash/${earlier}/kept/ILS`);
    expect(await screen.findByText("בנק לדוגמה")).toBeInTheDocument();
    expect(rpc.calls.find((c) => c.name === "cash_month_lines")?.args).toMatchObject({ p_side: "not_in_profit", p_currency: "ILS" });
    expect(screen.getByRole("heading", { name: "לא נספר ברווח" })).toBeInTheDocument();
    // Net −₪1,150 less profit −₪400; the month sends no categories, so all of it is the rest.
    expect(document.querySelector(".ui-breakdown-total")?.textContent).toMatch(/^−₪750$/);
    expect(screen.getByText(/מזה −₪750 מע״מ והפרשים/)).toBeInTheDocument();
    expect(screen.getByText("−₪1,200")).toBeInTheDocument();
    expect(screen.getByText("+₪450")).toHaveClass("ui-income");
  });
});
