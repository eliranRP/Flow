import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { israelToday } from "../ui/date-math";
import { BooksProvider } from "../use-books";
import { CashHistoryScreen, CashYearScreen } from "./cash-history";

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

const thisYear = Number(israelToday().slice(0, 4));
const total = (inMinor: number, outMinor: number) => ({ currency: "ILS", in_minor: inMinor, out_minor: outMinor, net_minor: inMinor - outMinor });

// Invented figures only.
const years = {
  basis: "paid",
  base_currency: "ILS",
  this_month: `${israelToday().slice(0, 7)}-01`,
  first_month: `${String(thisYear - 1)}-03-01`,
  by_currency: [total(900_000, 400_000)],
  years: [
    { year: thisYear, by_currency: [total(500_000, 100_000)] },
    { year: thisYear - 1, by_currency: [total(400_000, 300_000)] },
  ],
};

function monthRow(month: string, inMinor: number, outMinor: number) {
  return {
    month,
    by_currency: [
      { ...total(inMinor, outMinor), profit_minor: 0, excluded_count: 0, excluded_in_minor: 0, excluded_out_minor: 0 },
    ],
  };
}

const lastYear = thisYear - 1;
const yearMonths = {
  basis: "paid",
  base_currency: "ILS",
  months: [monthRow(`${String(lastYear)}-12-01`, 300_000, 100_000), monthRow(`${String(lastYear)}-03-01`, 100_000, 200_000), monthRow(`${String(lastYear)}-02-01`, 0, 0)],
};

function wrap(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BooksProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/cash/history" element={<CashHistoryScreen />} />
            <Route path="/cash/year/:year" element={<CashYearScreen />} />
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
    if (name === "cash_years") return Promise.resolve({ data: years, error: null });
    if (name === "cash_year_months") return Promise.resolve({ data: yearMonths, error: null });
    return Promise.resolve({ data: null, error: null });
  };
});

describe("Cash history (FLOW-417)", () => {
  it("shows the net since the first month, then a row per year opening its page", async () => {
    wrap("/cash/history");
    expect(await screen.findByText(`תזרים מאז מרץ ${String(lastYear)}`)).toBeInTheDocument();
    expect(screen.getAllByText("₪5,000").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: `תזרים ${String(lastYear)} ₪1,000` })).toHaveAttribute("href", `/cash/year/${String(lastYear)}`);
    expect(rpc.calls.map((c) => c.name)).toEqual(["cash_years"]);
  });

  it("shows a year's net, נכנס and יצא, then its months from the first cash month", async () => {
    wrap(`/cash/year/${String(lastYear)}`);
    expect(await screen.findByText(`תזרים ${String(lastYear)}`)).toBeInTheDocument();
    expect(rpc.calls.find((c) => c.name === "cash_year_months")?.args).toEqual({ p_year: lastYear });
    expect(await screen.findByRole("link", { name: `תזרים מרץ ${String(lastYear)} −₪1,000` })).toHaveAttribute("href", `/cash/${String(lastYear)}-03`);
    expect(screen.queryByRole("link", { name: /^תזרים פברואר/ })).toBeNull();
    expect(screen.getByLabelText(`נכנס ב${String(lastYear)} ₪4,000`)).toBeInTheDocument();
  });

  it("sends a broken year back to Home without a read", () => {
    wrap("/cash/year/abc");
    expect(screen.getByText("בית")).toBeInTheDocument();
    expect(rpc.calls).toEqual([]);
  });

  it("sends a signed-out read back to Home", async () => {
    rpc.impl = () => Promise.resolve({ data: null, error: null });
    wrap("/cash/history");
    expect(await screen.findByText("בית")).toBeInTheDocument();
  });
});
