import { fireEvent, screen, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { shiftMonthKey } from "../period";
import { renderWithProviders } from "../test-render";
import { israelToday } from "../ui/date-math";
import { HomeScreen } from "./HomeScreen";
import { CompanyProfitScreen } from "./company-profit-screen";
import { homeMonthLabel } from "./home-parts";

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
    // FLOW-418: what profit leaves out, by category, as the server sends it.
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
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<HomeScreen />} />
      <Route path="/profit" element={<CompanyProfitScreen />} />
    </Routes>,
    { route: path },
  );
}

beforeEach(() => {
  rpc.calls = [];
});

function bandOf(): HTMLElement {
  const band = document.querySelector(".ui-band");
  if (!(band instanceof HTMLElement)) throw new Error("no band");
  return band;
}

describe("Home's cash (FLOW-364: the redesigned Home)", () => {
  it("shows the month in the band with its net, נכנס, יצא and the split card", async () => {
    wrap();
    await screen.findByText("תזרים · עד היום");
    const band = bandOf();
    expect(within(band).getByText("₪3,200")).toBeInTheDocument();
    expect(within(band).getByText(homeMonthLabel(current))).toBeInTheDocument();
    expect(screen.getByText("תזרים · עד היום")).toBeInTheDocument();
    expect(rpc.calls.find((c) => c.name === "cash_months")?.args).toEqual({ p_months: 4 });
    const incoming = screen.getByRole("link", { name: /^נכנס/ });
    expect(incoming).toHaveAttribute("href", `/cash/${current}/in/ILS`);
    expect(screen.getByRole("link", { name: /^יצא/ })).toHaveAttribute("href", `/cash/${current}/out/ILS`);
    // FLOW-418: the split card, the cash profit leaves out first, then the month's profit.
    expect(screen.getByRole("heading", { name: "ממה מורכב התזרים" })).toBeInTheDocument();
    const kept = screen.getByRole("link", { name: /^השקעה, לא נספר ברווח/ });
    expect(kept).toHaveAttribute("href", `/cash/${current}/kept/ILS`);
    expect(within(kept).getByText("שיפוץ והשבחה, השקעת בעלים · 30%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^רווח החודש/ })).toBeInTheDocument();
    // No profit band, period pill or projects: those are the profit view's.
    expect(screen.queryByRole("button", { name: /בחירת תקופה/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "פרויקטים" })).not.toBeInTheDocument();
  });

  it("drops the old earlier-months list and its two links (FLOW-364)", async () => {
    wrap();
    await screen.findByText("תזרים · עד היום");
    expect(screen.queryByRole("heading", { name: "חודשים קודמים" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "לכל החודשים" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "לכל הקבועים" })).not.toBeInTheDocument();
  });

  it("reads a past month in the darker band, with a way back to the current month", async () => {
    wrap(0, `/?month=${month(1)}`);
    await screen.findByText("תזרים · חודש סגור");
    const back = screen.getByRole("link", { name: /^חזרה ל/ });
    expect(back).toHaveAttribute("href", "/");
    expect(bandOf()).toHaveClass("ui-band-past");
    expect(within(bandOf()).getByText("−₪1,150")).toBeInTheDocument();
    expect(screen.getByText(`שינוי מול ${homeMonthLabel(month(2)).split(" ")[0] ?? ""}, חודש מלא`)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^הוספה/ })).not.toBeInTheDocument();
  });

  it("keeps the attention box when something waits, and hides it when nothing does (design lead)", async () => {
    const first = wrap(7);
    expect(await screen.findByRole("link", { name: /7 פריטים ממתינים לאישור/ })).toHaveAttribute("href", "/review");
    expect(screen.getByRole("region", { name: "דורש טיפול" })).toBeInTheDocument();
    first.unmount();
    wrap(0);
    await screen.findByText("תזרים · עד היום");
    expect(screen.queryByText(/ממתינים לאישור/)).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "דורש טיפול" })).not.toBeInTheDocument();
  });

  it("opens the profit page on the month from רווח החודש", async () => {
    wrap();
    fireEvent.click(await screen.findByRole("button", { name: /^רווח החודש/ }));
    expect(await screen.findByRole("heading", { name: "רווח" })).toBeInTheDocument();
    // The month's read, and the year's read for מתחילת השנה: neither sends a basis of its own (FLOW-103), so the server counts on the company's choice (0170).
    const reads = rpc.calls.filter((c) => c.name === "get_dashboard");
    expect(reads.map((c) => c.args)).toContainEqual(expect.objectContaining({ p_from: `${current}-01` }));
    for (const read of reads) expect(read.args).not.toHaveProperty("p_basis");
  });
});
