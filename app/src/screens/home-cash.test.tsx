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

function wrap(reviewCount = 0, path = "/") {
  rpc.impl = (name) => {
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
        expected_months: {
          today: israelToday(),
          project_id: null,
          months: [{ month: current, open: true, by_currency: [{ currency: "ILS", income_minor: 0, expense_minor: -999_999 }] }],
          recurring: [
            { direction: "expense", party_id: "p-power", name: "Example Power", currency: "ILS", typical_amount_minor: -25_000, typical_day: 28, months_seen: 6, seen_this_month: false, project_id: "pj-1" },
            { direction: "expense", party_id: "p-water", name: "Example Water", currency: "ILS", typical_amount_minor: -40_000, typical_day: 28, months_seen: 6, seen_this_month: false, project_id: "pj-1" },
          ],
        },
        list_unpaid: [
          { id: "inv-1", description: "Invoice 1", doc_date: `${current}-01`, project_name: null, customer_name: "Example Client", open_gross_agorot: 50_000, open_net_agorot: 50_000, currency: "ILS", direction: "income" },
          { id: "bill-1", description: "Bill 1", doc_date: `${current}-01`, project_name: null, customer_name: "Example Supplier", open_gross_agorot: 20_000, open_net_agorot: 20_000, currency: "ILS", direction: "expense" },
        ],
        forecast_overrides_for: [],
        company_forecast_edits_for: {
          month: current,
          overhead_project_id: null,
          edits: [
            { id: "e-1", project_id: "pj-1", kind: "add", row_key: null, category_id: "c-refund", category_name: "Utility refund", direction: "income", amount_minor: 10_000, pace: "month", start_month: current, matched_transaction_id: null },
            { id: "e-2", project_id: "pj-1", kind: "remove", row_key: "rec:expense:p-water", category_id: null, category_name: null, direction: null, amount_minor: null, pace: "month", start_month: current },
          ],
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
    await waitFor(() => { expect(rpc.calls.some((c) => c.name === "list_unpaid")).toBe(true); });
    // Home's figures are not drawn yet: nothing of the forecast's has gone out.
    for (const name of ["expected_months", "forecast_overrides_for", "company_forecast_edits_for", "cash_month_lines"]) {
      expect(rpc.calls.some((c) => c.name === name)).toBe(false);
    }
    releaseCash();
    await screen.findByText("תזרים · עד היום");
    await waitFor(() => { expect(rpc.calls.some((c) => c.name === "forecast_overrides_for")).toBe(true); });
    // FLOW-1036: the one-off group's lines, both sides of this month in the base currency.
    await waitFor(() => { expect(rpc.calls.filter((c) => c.name === "cash_month_lines")).toHaveLength(2); });
    expect(rpc.calls.find((c) => c.name === "cash_month_lines")?.args).toMatchObject({ p_month: `${current}-01`, p_currency: "ILS" });
    expect(rpc.calls.filter((c) => c.name === "list_unpaid")).toHaveLength(1);
    // FLOW-1056: next month's forecast is read on next month only.
    expect(rpc.calls.some((c) => c.name === "company_next_month_inputs")).toBe(false);
  });
});

describe("Home on next month (FLOW-1056)", () => {
  it("opens on ?month= next month with the forecast's band and its reads, no attention reads drawn, and steps back", async () => {
    const next = shiftMonthKey(current, 1);
    wrap(3, `/?month=${next}`);
    expect(await screen.findByText(`תזרים צפוי · ${homeMonthLabel(next).split(" ")[0] ?? ""}`)).toBeInTheDocument();
    expect(within(bandOf()).getByText(homeMonthLabel(next))).toBeInTheDocument();
    await waitFor(() => { expect(rpc.calls.some((c) => c.name === "company_next_month_inputs")).toBe(true); });
    // FLOW-1171: next month is built from `edits`, so its read leaves rest_edits out.
    expect(rpc.calls.filter((c) => c.name === "company_next_month_inputs").map((c) => c.args)).toEqual([{ p_today: israelToday(), p_rest: false }]);
    // This sample's reads come back empty: the list says the forecast did not load, with its retry; the band stays.
    expect(await screen.findByRole("button", { name: "נסו שוב" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "דורש טיפול" })).toBeNull();
    // FLOW-1066: the forecast runs 12 months on, so next month's later arrow is on.
    expect(within(bandOf()).getByRole("button", { name: "חודש הבא" })).not.toHaveAttribute("aria-disabled", "true");
    fireEvent.click(within(bandOf()).getByRole("button", { name: "חודש קודם" }));
    expect(await screen.findByText("תזרים · עד היום")).toBeInTheDocument();
  });

  it("a month after next month asks for every later month's edits (FLOW-1171)", async () => {
    wrap(3, `/?month=${shiftMonthKey(current, 2)}`);
    await waitFor(() => { expect(rpc.calls.some((c) => c.name === "company_next_month_inputs")).toBe(true); });
    expect(rpc.calls.filter((c) => c.name === "company_next_month_inputs").map((c) => c.args)).toEqual([{ p_today: israelToday(), p_rest: true }]);
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
    expect(client.getQueryCache().find({ queryKey: ["month-forecast", "off", current] })?.isDisabled()).toBe(false);
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
      if (name === "expected_months") return held.then(() => ({ data: null, error: { message: "boom" } }));
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
