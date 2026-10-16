import { fireEvent, screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { shiftMonthKey } from "../period";
import { renderWithProviders } from "../test-render";
import { israelToday } from "../ui/date-math";
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
  has_more: true,
};

function wrap(path: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/cash/:month" element={<CashMonthScreen />} />
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

  it("reads a month older than Home's from its year, and Back returns to that year (FLOW-417)", async () => {
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

  it("steps months with the chevrons by the title, from the first month to this one (FLOW-362)", async () => {
    const impl = rpc.impl;
    rpc.impl = (name, args) =>
      name === "cash_years"
        ? Promise.resolve({ data: { basis: "paid", base_currency: "ILS", this_month: `${current}-01`, first_month: `${earlier}-01`, by_currency: [], years: [] }, error: null })
        : impl(name, args);
    wrap(`/cash/${earlier}`);
    await screen.findByRole("link", { name: /^נכנס ב/ });
    // The first month has no earlier chevron; the later one opens this month's page in place.
    const later = await screen.findByRole("button", { name: /^תזרים / });
    expect(screen.getAllByRole("button", { name: /^תזרים / })).toHaveLength(1);
    fireEvent.click(later);
    expect(await screen.findByRole("link", { name: /^נכנס ב.* ₪18,000 – פירוט$/ })).toHaveAttribute("href", `/cash/${current}/in/ILS`);
    // This month has no later chevron, and its earlier one goes back.
    expect(screen.getAllByRole("button", { name: /^תזרים / })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /^תזרים / }));
    expect(await screen.findByRole("link", { name: /^יצא ב/ })).toHaveAttribute("href", `/cash/${earlier}/out/ILS`);
  });

  it("sends a broken month back to Home without a read", () => {
    wrap("/cash/oct");
    expect(screen.getByText("בית")).toBeInTheDocument();
    expect(rpc.calls).toEqual([]);
  });
});
