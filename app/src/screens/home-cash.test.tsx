import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { shiftMonthKey } from "../period";
import { israelToday } from "../ui/date-math";
import { ToastProvider } from "../ui/toast";
import { BooksProvider } from "../use-books";
import { HomeScreen, ProfitScreen } from "./HomeScreen";

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
const month = (back: number) => shiftMonthKey(current, -back);

function currencyRow(inMinor: number, outMinor: number, profit: number) {
  return {
    currency: "ILS",
    in_minor: inMinor,
    out_minor: outMinor,
    net_minor: inMinor - outMinor,
    profit_minor: profit,
    excluded_count: 0,
    excluded_in_minor: 0,
    excluded_out_minor: 0,
    // FLOW-417: what profit leaves out, by category, as the server sends it.
    not_in_profit_categories: [
      { name: "שיפוץ והשבחה", amount_minor: -440_000 },
      { name: "השקעת בעלים", amount_minor: 200_000 },
    ],
  };
}

// Invented figures only (frame b's).
const cash = {
  basis: "paid",
  base_currency: "ILS",
  months: [
    { month: `${month(0)}-01`, by_currency: [currencyRow(1_800_000, 1_480_000, 560_000)] },
    { month: `${month(1)}-01`, by_currency: [currencyRow(1_650_000, 1_765_000, 210_000)] },
    { month: `${month(2)}-01`, by_currency: [currencyRow(1_720_000, 1_480_000, 390_000)] },
    { month: `${month(3)}-01`, by_currency: [currencyRow(1_700_000, 1_520_000, 330_000)] },
  ],
};

function dashboard(reviewCount: number) {
  return {
    company_id: "co",
    name: "חברה לדוגמה",
    vat_registered: true,
    basis: "invoiced",
    from: `${current}-01`,
    to: israelToday(),
    income_agorot: 1_000_000,
    direct_agorot: 400_000,
    shared_agorot: 0,
    overhead_agorot: 0,
    expense_agorot: 400_000,
    net_profit_agorot: 600_000,
    prev_income_agorot: null,
    prev_expense_agorot: null,
    prev_net_agorot: null,
    active_projects: 1,
    review_count: reviewCount,
    projects: [],
    by_currency: [],
  };
}

function wrap(reviewCount = 0, path = "/") {
  rpc.impl = (name) => {
    if (name === "cash_months") return Promise.resolve({ data: cash, error: null });
    if (name === "get_dashboard") return Promise.resolve({ data: dashboard(reviewCount), error: null });
    if (name === "list_unpaid" || name === "list_missing_bills") return Promise.resolve({ data: [], error: null });
    return Promise.resolve({ data: null, error: null });
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <BooksProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/" element={<HomeScreen />} />
              <Route path="/profit" element={<ProfitScreen />} />
            </Routes>
          </MemoryRouter>
        </BooksProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rpc.calls = [];
});

describe("Home's cash (FLOW-413, frame b)", () => {
  it("names the month on the band with its cash, then נכנס, יצא and a quiet רווח החודש", async () => {
    wrap();
    const figure = await screen.findByRole("heading", { name: "₪3,200" });
    expect(figure.closest(".ui-band")).not.toBeNull();
    expect(screen.getByText(/^תזרים /).closest(".ui-band")).not.toBeNull();
    expect(rpc.calls.find((c) => c.name === "cash_months")?.args).toEqual({ p_months: 4 });
    const incoming = screen.getByRole("link", { name: /^נכנס ב/ });
    expect(incoming).toHaveAttribute("href", `/cash/${current}/in/ILS`);
    expect(within(incoming).getByText("₪18,000")).toHaveClass("ui-income");
    expect(screen.getByRole("link", { name: /^יצא ב/ })).toHaveAttribute("href", `/cash/${current}/out/ILS`);
    expect(screen.getByRole("link", { name: /^רווח ב/ })).toHaveClass("ui-cash-quiet");
    // FLOW-417: the rest of the month's figure, profit leaves out, under it with what it holds.
    const kept = screen.getByRole("link", { name: /^לא נספר ברווח ב\S+ −₪2,400 – פירוט$/ });
    expect(kept).toHaveAttribute("href", `/cash/${current}/kept/ILS`);
    expect(within(kept).getByText("שיפוץ והשבחה, השקעת בעלים")).toHaveClass("ui-flow-hint");
    // No profit band, period pill or projects: those are the profit view's.
    expect(screen.queryByRole("button", { name: /בחירת תקופה/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "פרויקטים" })).not.toBeInTheDocument();
  });

  it("lists the three earlier months by their net, a loss in red, each opening its page", async () => {
    wrap();
    const loss = await screen.findByRole("link", { name: /−₪1,150/ });
    expect(screen.getByRole("heading", { name: "חודשים קודמים" })).toBeInTheDocument();
    expect(loss).toHaveAttribute("href", `/cash/${month(1)}`);
    expect(within(loss).getByText("−₪1,150")).toHaveClass("ui-loss");
    expect(screen.getByRole("link", { name: /^תזרים \S+ ₪2,400/ })).toHaveAttribute("href", `/cash/${month(2)}`);
    expect(screen.getByRole("link", { name: /₪1,800/ })).toHaveAttribute("href", `/cash/${month(3)}`);
  });

  it("keeps the attention box when something waits, and hides it when nothing does (design lead)", async () => {
    const first = wrap(7);
    expect(await screen.findByRole("link", { name: /7 פריטים ממתינים לאישור/ })).toHaveAttribute("href", "/review");
    first.unmount();
    wrap(0);
    await screen.findByRole("heading", { name: "₪3,200" });
    expect(screen.queryByText(/ממתינים לאישור/)).not.toBeInTheDocument();
  });

  it("opens the profit view on the month from רווח החודש, with a way back to the cash", async () => {
    wrap();
    fireEvent.click(await screen.findByRole("link", { name: /^רווח ב/ }));
    expect(await screen.findByRole("button", { name: "חזרה לתזרים" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /בחירת תקופה/ })).toBeInTheDocument();
    const profit = rpc.calls.filter((c) => c.name === "get_dashboard").at(-1);
    expect(profit?.args).toMatchObject({ p_from: `${current}-01` });
    // FLOW-103: no basis of its own, so the server counts on the company's choice (0170).
    expect(profit?.args).not.toHaveProperty("p_basis");
  });
});
