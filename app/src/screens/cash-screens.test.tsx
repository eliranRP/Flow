import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { shiftMonthKey } from "../period";
import { israelToday } from "../ui/date-math";
import { BooksProvider } from "../use-books";
import { CashLinesScreen, CashMonthScreen } from "./cash-screens";

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
  has_more: true,
};

function wrap(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BooksProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/cash/:month" element={<CashMonthScreen />} />
            <Route path="/cash/:month/:side/:currency" element={<CashLinesScreen />} />
            <Route path="/cash/year/:year" element={<p>שנה</p>} />
            <Route path="/" element={<p>בית</p>} />
          </Routes>
        </MemoryRouter>
      </BooksProvider>
    </QueryClientProvider>,
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

describe("Cash month page", () => {
  it("shows an earlier month's net, then נכנס, יצא and its profit; a currency that moved adds its line", async () => {
    wrap(`/cash/${earlier}`);
    expect(await screen.findByRole("link", { name: /^נכנס ב/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^תזרים / })).toBeInTheDocument();
    expect(screen.getAllByText("−₪1,150").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /^נכנס ב/ })).toHaveAttribute("href", `/cash/${earlier}/in/ILS`);
    expect(screen.getByRole("link", { name: /^יצא ב/ })).toHaveAttribute("href", `/cash/${earlier}/out/ILS`);
    expect(screen.getByRole("link", { name: /^רווח ב/ })).toHaveAttribute("href", "/profit");
    expect(screen.getAllByText("$300").length).toBeGreaterThan(0);
  });

  it("reads a month older than Home's from its year, and Back returns to that year (FLOW-416)", async () => {
    const yearMonths = { ...months, months: [{ month: "2001-01-01", by_currency: [currencyRow("ILS", 300_000, 100_000, 0)] }] };
    const impl = rpc.impl;
    rpc.impl = (name, args) => (name === "cash_year_months" ? Promise.resolve({ data: yearMonths, error: null }) : impl(name, args));
    wrap("/cash/2001-01");
    expect(await screen.findByRole("link", { name: /^נכנס ב/ })).toHaveAttribute("href", "/cash/2001-01/in/ILS");
    expect(rpc.calls.find((c) => c.name === "cash_year_months")?.args).toEqual({ p_year: 2001 });
    expect(screen.getAllByText("₪2,000").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "חזרה לתזרים" }));
    expect(await screen.findByText("שנה")).toBeInTheDocument();
  });

  it("sends a month its year does not hold back to the year", async () => {
    wrap("/cash/2001-01");
    expect(await screen.findByText("שנה")).toBeInTheDocument();
  });

  it("sends a broken month back to Home without a read", () => {
    wrap("/cash/oct");
    expect(screen.getByText("בית")).toBeInTheDocument();
    expect(rpc.calls).toEqual([]);
  });
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

  it("switches currency in place and loads the next page", async () => {
    wrap(`/cash/${earlier}/out/ILS`);
    await screen.findByText("בנק לדוגמה");
    fireEvent.click(screen.getByRole("button", { name: "עוד תנועות" }));
    await waitFor(() => {
      expect(rpc.calls.some((c) => c.name === "cash_month_lines" && (c.args as { p_offset: number }).p_offset === 40)).toBe(true);
    });
    fireEvent.click(screen.getByRole("radio", { name: "USD" }));
    await waitFor(() => {
      expect(rpc.calls.some((c) => c.name === "cash_month_lines" && (c.args as { p_currency: string }).p_currency === "USD")).toBe(true);
    });
  });
});
