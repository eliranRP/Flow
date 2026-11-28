import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { onlineManager } from "@tanstack/react-query";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { shiftMonthKey } from "../period";
import { renderWithProviders } from "../test-render";
import { israelToday } from "../ui/date-math";
import { HomeScreen } from "./HomeScreen";
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

function wrap(reviewCount = 0, path = "/", answers: Record<string, unknown> = {}) {
  rpc.impl = (name) => {
    if (name in answers) return Promise.resolve({ data: answers[name], error: null });
    if (name === "cash_months") return Promise.resolve({ data: cash, error: null });
    if (name === "get_dashboard") return Promise.resolve({ data: dashboard(reviewCount), error: null });
    if (name === "list_unpaid" || name === "list_missing_bills" || name === "recurring_schedule") return Promise.resolve({ data: [], error: null });
    return Promise.resolve({ data: null, error: null });
  };
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<HomeScreen />} />
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

describe("Home's forecast row (FLOW-1008)", () => {
  it("shows the תזרים צפוי screen's own number: still to come, the owner's edits, a supplier bill as money out", async () => {
    rpc.impl = (name) => {
      const data: Record<string, unknown> = {
        cash_months: cash,
        get_dashboard: dashboard(0),
        list_missing_bills: [],
        recurring_schedule: [],
        mcp_company_loan_currency: "ILS",
        // FLOW-1314: one read, as the database sends it (no currency, expected_on, late_days or null field). Still to come: a ₪500
        // invoice and the owner's ₪100 added line in; the ₪250 power charge and a ₪200 supplier bill out (the water bill is removed).
        month_forecast: {
          month: current,
          base: "ILS",
          overrides: [],
          build: {
            items: [
              { key: "party:expense:p-power:ILS", direction: "expense", kind: "recurring", name: "Example Power", usual: 25_000, minor: 25_000, day: 28, project_id: "pj-1", pace: "month", moved_out: false, overridden: false },
              { key: "invoice:inv-1", direction: "income", kind: "invoice", name: "Example Client", usual: 50_000, minor: 50_000, description: "Invoice 1", moved_out: false, overridden: false },
              { key: "invoice:bill-1", direction: "expense", kind: "invoice", name: "Example Supplier", usual: 20_000, minor: 20_000, description: "Bill 1", moved_out: false, overridden: false },
              { key: "added:e-1", direction: "income", kind: "added", name: "Utility refund", usual: 10_000, minor: 10_000, category_id: "c-refund", project_id: "pj-1", pace: "month", line_start: current, moved_out: false, overridden: false },
            ],
            income: ["invoice:inv-1", "added:e-1"],
            expense: ["party:expense:p-power:ILS", "invoice:bill-1"],
            moved: [],
            small: [],
            incomeTotal: 60_000,
            expenseTotal: 45_000,
            changed: 0,
          },
        },
      };
      return Promise.resolve({ data: data[name] ?? null, error: null });
    };
    renderWithProviders(<Routes><Route path="/" element={<HomeScreen />} /></Routes>, { route: "/" });
    // ₪3,200 today + ₪500 invoice + ₪100 added line − ₪250 power − ₪200 supplier bill; the removed water bill is out.
    const row = await screen.findByRole("link", { name: "תזרים צפוי לסוף החודש" });
    await waitFor(() => { expect(within(row).getByText("₪3,350")).toBeInTheDocument(); });
  });
});

describe("Home's cold load (FLOW-1019)", () => {
  it("reads list_unpaid once, and starts the forecast's and the month lines' reads only after the figures are drawn", async () => {
    let releaseCash: () => void = () => undefined;
    const cashHeld = new Promise<void>((resolve) => { releaseCash = resolve; });
    rpc.impl = (name) => {
      if (name === "cash_months") return cashHeld.then(() => ({ data: cash, error: null }));
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard(0), error: null });
      if (name === "list_unpaid" || name === "list_missing_bills" || name === "recurring_schedule") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    };
    renderWithProviders(<Routes><Route path="/" element={<HomeScreen />} /></Routes>, { route: "/" });
    await waitFor(() => { expect(rpc.calls.some((c) => c.name === "forecast_overrides_for")).toBe(true); });
    // Home's figures are not drawn yet: nothing of the forecast's, the month's lines' or the attention counts' has gone out (FLOW-1346). Its overrides read is the late bills', at mount (FLOW-1259).
    for (const name of ["month_forecast", "cash_month_lines", "list_unpaid"]) {
      expect(rpc.calls.some((c) => c.name === name)).toBe(false);
    }
    releaseCash();
    await screen.findByText("תזרים · עד היום");
    await waitFor(() => { expect(rpc.calls.some((c) => c.name === "forecast_overrides_for")).toBe(true); });
    // FLOW-1314: the forecast is one request, with the month and today's date.
    await waitFor(() => { expect(rpc.calls.some((c) => c.name === "month_forecast")).toBe(true); });
    expect(rpc.calls.filter((c) => c.name === "month_forecast").map((c) => c.args)).toEqual([{ p_month: current, p_today: israelToday() }]);
    for (const name of ["expected_months", "company_forecast_edits_for"]) expect(rpc.calls.some((c) => c.name === name)).toBe(false);
    // FLOW-1036: the one-off group's lines, both sides of this month in the base currency.
    await waitFor(() => { expect(rpc.calls.filter((c) => c.name === "cash_month_lines")).toHaveLength(2); });
    expect(rpc.calls.find((c) => c.name === "cash_month_lines")?.args).toMatchObject({ p_month: `${current}-01`, p_currency: "ILS" });
    expect(rpc.calls.filter((c) => c.name === "list_unpaid")).toHaveLength(1);
    // FLOW-1056: next month's forecast is read on next month only.
    expect(rpc.calls.some((c) => c.name === "company_next_month_inputs")).toBe(false);
  });
});

// FLOW-1346: under the four-request cap (FLOW-1344) the reads that wait for first paint go out in this order: cash_years
// (it only bounds the month picker), the forecast, the month's two line lists, then the attention counts. The late reads
// (FLOW-1259) and the cash reads start at mount, and none of the after-paint ones before the figures draw.
const AFTER_PAINT_READS = ["cash_years", "month_forecast", "cash_month_lines", "list_jev_bookings", "recurring_changes", "count_transfer_matches", "count_utility_refunds", "list_unpaid"];
const ATTENTION_COUNTS = ["list_jev_bookings", "recurring_changes", "count_transfer_matches", "count_utility_refunds", "list_unpaid"];

describe("Home's cold read order (FLOW-1346)", () => {
  it("sends the forecast and the month's lines before the attention counts, all after the figures draw", async () => {
    let releaseCash: () => void = () => undefined;
    const cashHeld = new Promise<void>((resolve) => { releaseCash = resolve; });
    rpc.impl = (name) => {
      if (name === "cash_months") return cashHeld.then(() => ({ data: cash, error: null }));
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard(0), error: null });
      if (name === "count_transfer_matches") return Promise.resolve({ data: 0, error: null });
      if (name === "list_unpaid" || name === "missing_bills" || name === "list_jev_bookings" || name === "recurring_schedule") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    };
    const names = () => rpc.calls.map((c) => c.name);
    renderWithProviders(<Routes><Route path="/" element={<HomeScreen />} /></Routes>, { route: "/" });
    // At mount, with the figures held: the late reads go out, and no after-paint read has.
    await waitFor(() => { expect(names()).toEqual(expect.arrayContaining(["missing_bills", "forecast_overrides_for"])); });
    for (const name of AFTER_PAINT_READS) expect(names()).not.toContain(name);
    releaseCash();
    await screen.findByText("תזרים · עד היום");
    await waitFor(() => { expect(names()).toEqual(expect.arrayContaining(AFTER_PAINT_READS)); });
    const order = names();
    const forecastAt = order.indexOf("month_forecast");
    const lastLineAt = order.lastIndexOf("cash_month_lines");
    expect(forecastAt).toBeLessThan(order.indexOf("cash_month_lines"));
    for (const name of ATTENTION_COUNTS) expect(order.indexOf(name)).toBeGreaterThan(Math.max(forecastAt, lastLineAt));
  });
});

describe("Home on next month (FLOW-1056)", () => {
  it("opens on ?month= next month with the forecast's band and its reads, no attention reads drawn, and steps back", async () => {
    const next = shiftMonthKey(current, 1);
    wrap(3, `/?month=${next}`);
    expect(await screen.findByText(`תזרים צפוי · ${homeMonthLabel(next).split(" ")[0] ?? ""}`)).toBeInTheDocument();
    expect(within(bandOf()).getByText(homeMonthLabel(next))).toBeInTheDocument();
    // FLOW-1308: next month is one company_forecast read of its rows, with the Israel day.
    await waitFor(() => { expect(rpc.calls.some((c) => c.name === "company_forecast")).toBe(true); });
    expect(rpc.calls.filter((c) => c.name === "company_forecast").map((c) => c.args)).toEqual([{ p_months: [next], p_detail: "rows", p_today: israelToday() }]);
    // This sample's reads come back empty: the list says the forecast did not load, with its retry; the band stays.
    expect(await screen.findByRole("button", { name: "נסו שוב" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "דורש טיפול" })).toBeNull();
    // FLOW-1066: the forecast runs 12 months on, so next month's later arrow is on.
    expect(within(bandOf()).getByRole("button", { name: "חודש הבא" })).not.toHaveAttribute("aria-disabled", "true");
    fireEvent.click(within(bandOf()).getByRole("button", { name: "חודש קודם" }));
    expect(await screen.findByText("תזרים · עד היום")).toBeInTheDocument();
  });

  it("a month after next month is one company_forecast read of that month (FLOW-1308)", async () => {
    const later = shiftMonthKey(current, 2);
    wrap(3, `/?month=${later}`);
    await waitFor(() => { expect(rpc.calls.some((c) => c.name === "company_forecast")).toBe(true); });
    expect(rpc.calls.filter((c) => c.name === "company_forecast").map((c) => c.args)).toEqual([{ p_months: [later], p_detail: "rows", p_today: israelToday() }]);
  });

  it("draws next month's band, income note and rows from the one read, with none of the four it replaced (FLOW-1308)", async () => {
    const next = shiftMonthKey(current, 1);
    const row = (key: string, name: string, minor: number, extra: Record<string, unknown> = {}) => ({ key, kind: "recurring", direction: minor > 0 ? "income" : "expense", name, date: `${next}-05`, minor, ...extra });
    const part = (extra: Record<string, unknown>) => ({ cash_only_minor: 0, average_months: 3, removed: [], arrived: [], loan_cash: [], ...extra });
    const facts = { rows: 1, recurring: 1, rent: 1, name: "Example Tenant" };
    const answer = {
      today: israelToday(),
      currency: "ILS",
      months: [{
        month: next, income_minor: 500_000, expense_minor: 300_000, net_minor: 200_000, cash_only_minor: 0, projects: 1, general: true, income: facts,
        parts: [
          part({ project_id: "pj-1", income_minor: 500_000, expense_minor: 0, rows: [row("rec:income:s-rent", "Example Tenant", 500_000, { category_id: "c-rent" })] }),
          part({ income_minor: 0, expense_minor: 300_000, rows: [row("rec:expense:s-power", "Example Power", -300_000)] }),
        ],
        skipped: [],
      }],
      income: facts,
      split_keys: [],
    };
    wrap(0, `/?month=${next}`, { company_forecast: answer });
    expect(await screen.findByText("Example Tenant")).toBeInTheDocument();
    expect(screen.getByText("Example Power")).toBeInTheDocument();
    // companyIncomeNote's "one rent": the band's line under the income, from the counts the database gave.
    expect(within(bandOf()).getByText("שכירות קבועה אחת")).toBeInTheDocument();
    expect(rpc.calls.filter((c) => c.name === "company_forecast")).toHaveLength(1);
    for (const name of ["company_next_month_inputs", "expected_months"]) expect(rpc.calls.some((c) => c.name === name)).toBe(false);
  });

  it("reads a past month's own lines for its activity, and not the schedule's month", async () => {
    wrap(0, `/?month=${month(1)}`);
    expect(await screen.findByText("תזרים · חודש סגור")).toBeInTheDocument();
    await waitFor(() => { expect(rpc.calls.filter((c) => c.name === "cash_month_lines")).toHaveLength(2); });
    expect(rpc.calls.find((c) => c.name === "cash_month_lines")?.args).toMatchObject({ p_month: `${month(1)}-01` });
    expect(screen.getByRole("heading", { name: `הפעילות ב${homeMonthLabel(month(1)).split(" ")[0] ?? ""}` })).toBeInTheDocument();
  });

  it("goes no further than the forecast's last month (FLOW-1066): a later ?month= is that month, its later arrow off", async () => {
    const last = shiftMonthKey(current, 12);
    wrap(0, `/?month=${shiftMonthKey(current, 13)}`);
    expect(await screen.findByText(`תזרים צפוי · ${homeMonthLabel(last).split(" ")[0] ?? ""}`)).toBeInTheDocument();
    expect(within(bandOf()).getByText(homeMonthLabel(last))).toBeInTheDocument();
    expect(within(bandOf()).getByRole("button", { name: "חודש הבא" })).toHaveAttribute("aria-disabled", "true");
  });

  it("reads the forecast from the first render when Home is opened again with its data cached", async () => {
    const { client, unmount } = wrap();
    await screen.findByText("תזרים · עד היום");
    await waitFor(() => { expect(rpc.calls.some((c) => c.name === "forecast_overrides_for")).toBe(true); });
    unmount();
    rpc.calls = [];
    renderWithProviders(<Routes><Route path="/" element={<HomeScreen />} /></Routes>, { route: "/", client });
    // The figures are cached, so the forecast is read from the first render, with no idle wait.
    expect(screen.getByText("תזרים · עד היום")).toBeInTheDocument();
    expect(client.getQueryCache().find({ queryKey: ["month-forecast", "off", "answer", current] })?.isDisabled()).toBe(false);
  });
});

// FLOW-1252: the late rows are drawn on the current month only, so another month reads neither the late bills nor this month's overrides.
describe("Home's late bills by month (FLOW-1252)", () => {
  it("opened on a past month, sends neither missing_bills nor forecast_overrides_for", async () => {
    wrap(0, `/?month=${month(1)}`);
    expect(await screen.findByText("תזרים · חודש סגור")).toBeInTheDocument();
    // The month's own lines wait for first paint, as the late bills' overrides did: once they went out, the late read had its turn.
    await waitFor(() => { expect(rpc.calls.filter((c) => c.name === "cash_month_lines")).toHaveLength(2); });
    expect(rpc.calls.some((c) => c.name === "missing_bills")).toBe(false);
    expect(rpc.calls.some((c) => c.name === "forecast_overrides_for")).toBe(false);
  });

  it("on the current month, reads the late bills and this month's overrides", async () => {
    wrap(0, "/");
    await screen.findByText("תזרים · עד היום");
    await waitFor(() => { expect(rpc.calls.some((c) => c.name === "missing_bills")).toBe(true); });
    await waitFor(() => { expect(rpc.calls.some((c) => c.name === "forecast_overrides_for")).toBe(true); });
  });
});

// FLOW-1259: on the current month the late bills and this month's overrides start at mount, while Home's figures are still held.
describe("Home's late reads at mount (FLOW-1259)", () => {
  it("starts missing_bills and forecast_overrides_for before the figures draw, and the forecast reads none of its own", async () => {
    let releaseCash: () => void = () => undefined;
    const cashHeld = new Promise<void>((resolve) => { releaseCash = resolve; });
    rpc.impl = (name) => {
      if (name === "cash_months") return cashHeld.then(() => ({ data: cash, error: null }));
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard(0), error: null });
      if (name === "list_unpaid" || name === "missing_bills" || name === "recurring_schedule") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    };
    renderWithProviders(<Routes><Route path="/" element={<HomeScreen />} /></Routes>, { route: "/" });
    await waitFor(() => { expect(rpc.calls.some((c) => c.name === "forecast_overrides_for")).toBe(true); });
    expect(rpc.calls.some((c) => c.name === "missing_bills")).toBe(true);
    // Home's figures are not drawn yet, and the month forecast has not started.
    expect(screen.queryByText("תזרים · עד היום")).toBeNull();
    expect(rpc.calls.some((c) => c.name === "month_forecast")).toBe(false);
    releaseCash();
    await screen.findByText("תזרים · עד היום");
    // FLOW-1314: the month forecast carries its overrides in its own answer, so it asks for none: the late bills' read is the only one.
    await waitFor(() => { expect(rpc.calls.some((c) => c.name === "month_forecast")).toBe(true); });
    expect(rpc.calls.filter((c) => c.name === "forecast_overrides_for")).toHaveLength(1);
    expect(rpc.calls.filter((c) => c.name === "missing_bills")).toHaveLength(1);
  });
});

// FLOW-1253: the late bills' currency read is keyed. FLOW-1314: the month forecast gets the currency inside month_forecast, so a cold Home still sends it once.
describe("Home's company currency read (FLOW-1253)", () => {
  it("a cold Home sends mcp_company_loan_currency once, beside the month forecast's one read", async () => {
    rpc.impl = (name) => {
      if (name === "mcp_company_loan_currency") return Promise.resolve({ data: "ILS", error: null });
      if (name === "cash_months") return Promise.resolve({ data: cash, error: null });
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard(0), error: null });
      if (name === "list_unpaid" || name === "missing_bills" || name === "recurring_schedule") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    };
    renderWithProviders(<Routes><Route path="/" element={<HomeScreen />} /></Routes>, { route: "/" });
    // The forecast's read goes out after first paint.
    await waitFor(() => { expect(rpc.calls.some((c) => c.name === "month_forecast")).toBe(true); });
    expect(rpc.calls.filter((c) => c.name === "mcp_company_loan_currency")).toHaveLength(1);
  });
});

describe("Home's forecast row while it loads (FLOW-1031)", () => {
  it("keeps the row's place until the read answers, and lets it go when the read fails", async () => {
    let failForecast: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { failForecast = resolve; });
    rpc.impl = (name) => {
      if (name === "cash_months") return Promise.resolve({ data: cash, error: null });
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard(0), error: null });
      if (name === "list_unpaid" || name === "list_missing_bills" || name === "recurring_schedule") return Promise.resolve({ data: [], error: null });
      if (name === "month_forecast") return held.then(() => ({ data: null, error: { message: "boom" } }));
      return Promise.resolve({ data: null, error: null });
    };
    renderWithProviders(<Routes><Route path="/" element={<HomeScreen />} /></Routes>, { route: "/" });
    await screen.findByText("תזרים · עד היום");
    const band = bandOf();
    // Drawn before the forecast is read: the row's box, a bar for its figure, and no link yet.
    expect(band.querySelector(".ui-home-forecast .ui-skel-forecast-value")).not.toBeNull();
    expect(screen.queryByRole("link", { name: "תזרים צפוי לסוף החודש" })).toBeNull();
    failForecast();
    await waitFor(() => { expect(band.querySelector(".ui-home-forecast")).toBeNull(); }, { timeout: 5000 });
  });
});

describe("Home's cash (FLOW-364: the redesigned Home)", () => {
  it("shows the month in the band with its net, נכנס and יצא, and no split card (FLOW-1036)", async () => {
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
    // FLOW-1036: the split card, the next-month card and the reports card left Home; profit is in דוחות.
    expect(screen.queryByText("ממה מורכב התזרים")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^רווח החודש/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "החודש הבא" })).not.toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "תנועות החודש" })).toBeInTheDocument();
    // No profit band, period pill or projects: those are the profit view's.
    expect(screen.queryByRole("button", { name: /בחירת תקופה/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "פרויקטים" })).not.toBeInTheDocument();
    // FLOW-364: the old earlier-months list and its two links are gone (the board's Home has nothing there).
    expect(screen.queryByRole("heading", { name: "חודשים קודמים" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "לכל החודשים" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "לכל הקבועים" })).not.toBeInTheDocument();
  });

  it("says in the band which moment the figures are from when the network drops (FLOW-958)", async () => {
    wrap();
    await screen.findByText("תזרים · עד היום");
    expect(document.querySelector(".ui-band-offline")).toBeNull();
    try {
      act(() => {
        onlineManager.setOnline(false);
      });
      expect(await screen.findByText(/אין חיבור · מוצג המצב מ־/)).toBeInTheDocument();
      expect(within(bandOf()).getByText("₪3,200")).toBeInTheDocument();
    } finally {
      act(() => {
        onlineManager.setOnline(true);
      });
    }
    await waitFor(() => {
      expect(document.querySelector(".ui-band-offline")).toBeNull();
    });
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

  it("keeps the attention cards when something waits, and hides them when nothing does (design lead)", async () => {
    const first = wrap(7);
    expect(await screen.findByRole("link", { name: "7 פריטים ממתינים לאישור" })).toHaveAttribute("href", "/review");
    expect(screen.getByRole("heading", { name: "דורש טיפול" })).toBeInTheDocument();
    first.unmount();
    wrap(0);
    await screen.findByText("תזרים · עד היום");
    expect(screen.queryByRole("link", { name: /לאישור/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "דורש טיפול" })).not.toBeInTheDocument();
  });
});

describe("Home's first paint waits on cash_months alone", () => {
  /** get_dashboard answers only when the test says so. */
  function held(cashAnswer: unknown) {
    let answer: (value: { data: unknown; error: null }) => void = () => undefined;
    rpc.impl = (name) => {
      if (name === "cash_months") return Promise.resolve({ data: cashAnswer, error: null });
      if (name === "get_dashboard") return new Promise((resolve) => { answer = resolve; });
      if (name === "list_unpaid" || name === "list_missing_bills" || name === "recurring_schedule") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    };
    renderWithProviders(<HomeScreen />);
    return (data: unknown) => { answer({ data, error: null }); };
  }

  it("draws the month before get_dashboard answers, then adds the review count", async () => {
    const answer = held(cash);
    await screen.findByText("תזרים · עד היום");
    expect(within(bandOf()).getByText("₪3,200")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /לאישור/ })).not.toBeInTheDocument();
    answer(dashboard(3));
    expect(await screen.findByRole("link", { name: "3 פריטים ממתינים לאישור" })).toHaveAttribute("href", "/review");
  });

  it("keeps the skeleton, not the empty state, while a company with no recent cash line waits for get_dashboard to decide", async () => {
    const answer = held({ ...cash, months: cash.months.map((row) => ({ ...row, by_currency: [] })) });
    await waitFor(() => { expect(rpc.calls.map((c) => c.name)).toContain("cash_months"); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(document.querySelector("[aria-busy=\"true\"]")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "חברו את הבנק" })).not.toBeInTheDocument();
    // get_dashboard decides: this company has books (the month's profit), so Home draws them.
    answer(dashboard(0));
    await screen.findByText("תזרים · עד היום");
    expect(screen.queryByRole("heading", { name: "חברו את הבנק" })).not.toBeInTheDocument();
  });

  it("says the review count failed, with a retry, when get_dashboard fails after cash drew the books", async () => {
    let fail = true;
    rpc.impl = (name) => {
      if (name === "cash_months") return Promise.resolve({ data: cash, error: null });
      if (name === "get_dashboard") return Promise.resolve(fail ? { data: null, error: { message: "db down" } } : { data: dashboard(4), error: null });
      if (name === "list_unpaid" || name === "list_missing_bills" || name === "recurring_schedule") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    };
    renderWithProviders(<HomeScreen />);
    await screen.findByText("תזרים · עד היום");
    expect(await screen.findByText("לא הצלחנו לטעון.")).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "נסו שוב" }));
    expect(await screen.findByRole("link", { name: "4 פריטים ממתינים לאישור" })).toBeInTheDocument();
    expect(screen.queryByText("לא הצלחנו לטעון.")).not.toBeInTheDocument();
  });
});

describe("Home's lines (FLOW-1189)", () => {
  // Invented lines; a page answers what the call asks for (p_limit, p_offset), as cash_month_lines does.
  function line(id: string, side: "in" | "out") {
    return {
      transaction_id: `${side}-${id}`,
      part: "principal",
      description: `Example line ${id}`,
      supplier_name: "Example Supplier",
      project_name: null,
      category_name: "Example category",
      doc_date: `${current}-02`,
      cash_month_date: `${current}-03`,
      currency: "ILS",
      amount_minor: 1_000,
      side,
      shared: false,
      source: "mercury",
      kept_out: false,
      recurring: false,
    };
  }

  function linesPage(args: unknown, side: "in" | "out", total: number) {
    const { p_limit: limit, p_offset: offset } = args as { p_limit: number; p_offset: number };
    const count = Math.max(0, Math.min(limit, total - offset));
    return { rows: Array.from({ length: count }, (_, i) => line(String(offset + i), side)), has_more: offset + limit < total };
  }

  function readLines(totals: { in: number; out: number }) {
    rpc.impl = (name, args) => {
      if (name === "cash_months") return Promise.resolve({ data: cash, error: null });
      if (name === "get_dashboard") return Promise.resolve({ data: dashboard(0), error: null });
      if (name === "cash_month_lines") {
        const side = (args as { p_side: "in" | "out" }).p_side;
        return Promise.resolve({ data: linesPage(args, side, totals[side]), error: null });
      }
      if (name === "list_unpaid" || name === "list_missing_bills" || name === "recurring_schedule") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    };
  }

  it("asks for 20 lines a side and no further page (the month's lines screen keeps 200)", async () => {
    readLines({ in: 45, out: 45 });
    renderWithProviders(<Routes><Route path="/" element={<HomeScreen />} /></Routes>, { route: "/" });
    await waitFor(() => { expect(rpc.calls.filter((c) => c.name === "cash_month_lines")).toHaveLength(2); });
    const reads = rpc.calls.filter((c) => c.name === "cash_month_lines").map((c) => c.args as { p_side: string; p_limit: number; p_offset: number });
    expect(reads.map((read) => [read.p_side, read.p_limit, read.p_offset]).sort()).toEqual([["in", 20, 0], ["out", 20, 0]]);
  });

  it("the current month has no more row: the band's money in / money out rows open its lines", async () => {
    readLines({ in: 3, out: 45 });
    renderWithProviders(<Routes><Route path="/" element={<HomeScreen />} /></Routes>, { route: "/" });
    await waitFor(() => { expect(rpc.calls.filter((c) => c.name === "cash_month_lines")).toHaveLength(2); });
    await screen.findByRole("link", { name: "כל הקבועים" });
    await screen.findAllByText(/Example (line|Supplier)/);
    expect(screen.queryByRole("link", { name: "כל התנועות" })).not.toBeInTheDocument();
  });

  it("a past month with more than 20 lines a side ends with its lines row (FLOW-1056), and reads no further page", async () => {
    readLines({ in: 21, out: 3 });
    renderWithProviders(<Routes><Route path="/" element={<HomeScreen />} /></Routes>, { route: `/?month=${month(1)}` });
    const more = await screen.findByRole("link", { name: `כל התנועות ב${homeMonthLabel(month(1)).split(" ")[0] ?? ""}` });
    expect(more).toHaveAttribute("href", `/cash/${month(1)}/out/ILS`);
    expect(rpc.calls.filter((c) => c.name === "cash_month_lines")).toHaveLength(2);
  });

  it("a past month with exactly 20 lines a side has no more row", async () => {
    readLines({ in: 20, out: 20 });
    renderWithProviders(<Routes><Route path="/" element={<HomeScreen />} /></Routes>, { route: `/?month=${month(1)}` });
    await waitFor(() => { expect(rpc.calls.filter((c) => c.name === "cash_month_lines")).toHaveLength(2); });
    await screen.findAllByText("Example Supplier");
    expect(screen.queryByRole("link", { name: /^כל התנועות ב/ })).not.toBeInTheDocument();
  });
});
