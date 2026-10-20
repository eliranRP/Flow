import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { monthForecastBoardSample, monthForecastSample } from "../forecast-sample";
import { shiftMonthKey } from "../period";
import { renderWithProviders } from "../test-render";
import { israelToday } from "../ui/date-math";
import { ForecastScreen } from "./forecast-screen";

const rpc = vi.hoisted(() => vi.fn((_name: string, _args?: unknown) => Promise.resolve({ data: null, error: null })));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({ rpc }),
}));

describe("ForecastScreen", () => {
  it("switches to לפי קטגוריה: each side's categories, their sums, and an open category's items", () => {
    renderWithProviders(<ForecastScreen sample={monthForecastBoardSample("board")} />, { route: "/forecast" });
    expect(screen.getByRole("radio", { name: "לפי פריט" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "לפי קטגוריה" }));
    expect(screen.getByRole("radio", { name: "לפי קטגוריה" })).toHaveAttribute("aria-checked", "true");
    const out = screen.getByRole("region", { name: "יוצא" });
    expect(within(out).getByText("$50,369")).toBeTruthy();
    expect(within(out).getByText("Streaming באיחור · עוד $962")).toBeTruthy();
    const into = screen.getByRole("region", { name: "נכנס" });
    expect(within(into).getByText("+$44,628")).toBeTruthy();
    const rent = within(into).getByRole("button", { name: /^שכירות/ });
    expect(rent).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(rent);
    expect(rent).toHaveAttribute("aria-expanded", "true");
    expect(within(into).getByRole("button", { name: "Elm St, unit 2, +$1,650" })).toBeTruthy();
    expect(within(into).getByRole("link", { name: "עדיין קבוע? לאישור ←" })).toHaveAttribute("href", "/recurring/income/elm");
    // A category with nothing still to come is a plain row: not a button, and nothing to expand.
    expect(within(out).queryByRole("button", { name: /^אחר/ })).toBeNull();
    const other = within(out).getByText("אחר").closest(".ui-forecast-cat-row");
    expect(other?.tagName).toBe("DIV");
    expect(other).not.toHaveAttribute("aria-expanded");
  });

  it("moves between the views with the arrow keys, focus following the checked chip (roving tabindex)", () => {
    renderWithProviders(<div dir="rtl"><ForecastScreen sample={monthForecastBoardSample("board")} /></div>, { route: "/forecast" });
    const items = screen.getByRole("radio", { name: "לפי פריט" });
    const categories = screen.getByRole("radio", { name: "לפי קטגוריה" });
    expect(items).toHaveAttribute("tabindex", "0");
    expect(categories).toHaveAttribute("tabindex", "-1");
    // Under dir=rtl the next chip is to the left (with two chips, either arrow reaches the other one).
    fireEvent.keyDown(items, { key: "ArrowLeft" });
    expect(categories).toHaveAttribute("aria-checked", "true");
    expect(categories).toHaveAttribute("tabindex", "0");
    expect(document.activeElement).toBe(categories);
    expect(screen.getByRole("region", { name: "יוצא" })).toBeTruthy();
    fireEvent.keyDown(categories, { key: "ArrowRight" });
    expect(items).toHaveAttribute("aria-checked", "true");
    expect(document.activeElement).toBe(items);
  });

  it("keeps the page's query on the ask's link", () => {
    renderWithProviders(<ForecastScreen sample={monthForecastBoardSample("board")} />, { route: "/forecast?from=home" });
    fireEvent.click(screen.getByRole("radio", { name: "לפי קטגוריה" }));
    fireEvent.click(within(screen.getByRole("region", { name: "נכנס" })).getByRole("button", { name: /^שכירות/ }));
    expect(screen.getByRole("link", { name: "עדיין קבוע? לאישור ←" })).toHaveAttribute("href", "/recurring/income/elm?from=home");
  });

  it("draws a sample with no month by category with nothing so far, not a skeleton", () => {
    renderWithProviders(<ForecastScreen sample={{ ...monthForecastBoardSample("board"), soFar: undefined }} />, { route: "/forecast" });
    fireEvent.click(screen.getByRole("radio", { name: "לפי קטגוריה" }));
    expect(screen.getByRole("region", { name: "יוצא" })).toBeTruthy();
  });

  it("live, counts a dollar company's items in dollars (the company currency, not shekels)", async () => {
    const reads: Record<string, unknown> = {
      mcp_company_loan_currency: "USD",
      expected_months: {
        today: "2026-10-11",
        project_id: null,
        months: [{ month: "2026-10", open: true, by_currency: [] }],
        recurring: [{ direction: "expense", party_id: "p-1", name: "Example Utility", currency: "USD", typical_amount_minor: -25000, typical_day: 20, months_seen: 6, seen_this_month: false }],
      },
      list_unpaid: [],
      forecast_overrides_for: [],
    };
    rpc.mockImplementation((name: string) => Promise.resolve({ data: (reads[name] ?? null) as null, error: null }));
    try {
      renderWithProviders(<ForecastScreen />, { route: "/forecast" });
      expect(await screen.findByRole("button", { name: /^Example Utility,/ })).toBeTruthy();
      expect(screen.getByRole("button", { name: /^Example Utility,/ }).getAttribute("aria-label")).toContain("$250");
      expect(screen.queryByText("הכל כבר הגיע")).toBeNull();
    } finally {
      rpc.mockImplementation(() => Promise.resolve({ data: null, error: null }));
    }
  });

  it("live, reads the chart's six cash months once, and sums today's net with the forecast's remaining in and out", async () => {
    const month = israelToday().slice(0, 7);
    const row = (incomeMinor: number, outMinor: number) => ({
      currency: "USD", in_minor: incomeMinor, out_minor: outMinor, net_minor: incomeMinor - outMinor, profit_minor: 0,
      excluded_count: 0, excluded_in_minor: 0, excluded_out_minor: 0, not_in_profit_categories: [],
    });
    const earlier = shiftMonthKey(month, -1);
    const cashMonths = { basis: "paid", base_currency: "USD", months: [{ month: `${month}-01`, by_currency: [row(300_000, 500_000)] }, { month: `${earlier}-01`, by_currency: [row(400_000, 100_000)] }] };
    const reads: Record<string, unknown> = {
      mcp_company_loan_currency: "USD",
      cash_months: cashMonths,
      expected_months: {
        today: `${month}-01`,
        project_id: null,
        months: [{ month, open: true, by_currency: [] }],
        recurring: [{ direction: "expense", party_id: "p-1", name: "Example Utility", currency: "USD", typical_amount_minor: -25000, typical_day: 28, months_seen: 6, seen_this_month: false }],
      },
      list_unpaid: [],
      forecast_overrides_for: [],
    };
    rpc.mockClear();
    rpc.mockImplementation((name: string) => Promise.resolve({ data: (reads[name] ?? null) as null, error: null }));
    try {
      renderWithProviders(<ForecastScreen />, { route: "/forecast" });
      const chart = await screen.findByRole("img", { name: /^נכנס ויצא לפי חודש, / });
      expect(chart.getAttribute("aria-label")).toContain("עד היום: נכנס $3,000, יצא $5,000; צפוי עוד: נכנס $0, יצא $250");
      expect(chart.querySelectorAll(".ui-fc-month-bars")).toHaveLength(2);
      // Home's four months give today's net; the chart's six are one read of their own.
      const calls = rpc.mock.calls.filter(([name]) => name === "cash_months").map(([, args]) => args);
      expect(calls).toEqual(expect.arrayContaining([{ p_months: 4 }, { p_months: 6 }]));
      expect(calls).toHaveLength(2);
      // −$2,000 today, nothing in, $250 out: −$2,250 at the month's end.
      expect(document.querySelector(".ui-fc-start")?.textContent).toBe("תזרים היום−$2,000");
      expect(document.querySelector(".ui-fc-net-strong bdi")?.textContent).toBe("−$2,250");
      expect(document.querySelector(".ui-forecast-big bdi")?.textContent).toBe("−$2,250");
    } finally {
      rpc.mockImplementation(() => Promise.resolve({ data: null, error: null }));
    }
  });

  it("titles the screen תזרים צפוי, in its header and its compact bar", () => {
    renderWithProviders(<ForecastScreen sample={monthForecastBoardSample("board")} />, { route: "/forecast" });
    expect(screen.getByRole("heading", { level: 1, name: "תזרים צפוי" })).toBeTruthy();
    expect(screen.getByText("סוף אוקטובר · עוד 20 ימים")).toBeTruthy();
    expect(document.querySelector(".ui-forecast-compact-figure")?.textContent).toBe("תזרים צפוי · −$5,741");
  });

  it("shows the month's end as the big figure, and the card's whole sum under it: today, in, out, the end", () => {
    renderWithProviders(<ForecastScreen sample={monthForecastSample("positive")} />, { route: "/forecast" });
    // Net 1,200 plus income 9,000 minus charges 6,045 (the small one included): 4,155.
    expect(document.querySelector(".ui-forecast-big bdi")?.textContent).toBe("₪4,155");
    // Today's figure lives in the card, not under the big one.
    expect(document.querySelector(".ui-forecast-today")).toBeNull();
    const card = document.querySelector(".ui-forecast-fc .ui-fc-card");
    expect(card?.querySelector(".ui-fc-start")?.textContent).toBe("תזרים היום₪1,200");
    const columns = [...(card?.querySelectorAll(".ui-fc-col") ?? [])].map((column) => column.textContent);
    expect(columns).toEqual(["צפוי להיכנס+₪9,0002 פריטים", "צפוי לצאת₪6,0453 פריטים, כולם קבועים"]);
    // The strong last row is the big figure: start + in − out.
    expect(card?.querySelector(".ui-fc-net-strong")?.textContent).toBe("תזרים בסוף אוקטובר₪4,155");
    expect(card?.querySelector(".ui-fc-net-strong")?.classList.contains("ui-fc-neg")).toBe(false);
    // Both sections keep their heads.
    expect(screen.getByRole("heading", { level: 2, name: /^צפוי להיכנס/ })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: /^צפוי לצאת/ })).toBeTruthy();
  });

  it("counts the board's items honestly: late income, recurring charges, every item in the corner", () => {
    renderWithProviders(<ForecastScreen sample={monthForecastBoardSample("board")} />, { route: "/forecast" });
    const card = document.querySelector(".ui-forecast-fc .ui-fc-card");
    expect(card?.querySelector(".ui-fc-caption")?.textContent).toBe("16 פריטים · פירוט למטה");
    // No link: the list is right below.
    expect(card?.tagName).toBe("DIV");
    expect([...(card?.querySelectorAll(".ui-fc-col") ?? [])].map((column) => column.textContent)).toEqual([
      "צפוי להיכנס+$19,7503 פריטים · 2 באיחור",
      "צפוי לצאת$8,30013 פריטים, מהם 11 קבועים",
    ]);
    // −$17,191 + $19,750 − $8,300 = −$5,741, in the signal colour as the big figure.
    expect(card?.querySelector(".ui-fc-start")?.textContent).toBe("תזרים היום−$17,191");
    const net = card?.querySelector(".ui-fc-net-strong");
    expect(net?.textContent).toBe("תזרים בסוף אוקטובר−$5,741");
    expect(net?.classList.contains("ui-fc-neg")).toBe(true);
    expect(document.querySelector(".ui-forecast-big")?.classList.contains("ui-forecast-big-neg")).toBe(true);
  });

  it("draws the chart: May to September as they ended, October so far with what is still expected on top", () => {
    renderWithProviders(<ForecastScreen sample={monthForecastBoardSample("board")} />, { route: "/forecast" });
    const chart = screen.getByRole("img", { name: "נכנס ויצא לפי חודש, מאי עד סוף אוקטובר. אוקטובר עד היום: נכנס $24,878, יצא $42,069; צפוי עוד: נכנס $19,750, יצא $8,300" });
    expect(chart.querySelectorAll(".ui-fc-month-bars")).toHaveLength(6);
    expect(chart.querySelectorAll(".ui-fc-now .ui-fc-cap")).toHaveLength(2);
    expect(chart.querySelector(".ui-fc-now .ui-fc-bar-label")?.textContent).toBe("אוק׳ · צפי");
    expect(screen.getByText("נכנס ויצא לפי חודש")).toBeTruthy();
    expect(screen.getByText("מאי עד סוף אוקטובר")).toBeTruthy();
  });

  it("keeps each amount LTR, so a minus sits at the start of the figure", () => {
    renderWithProviders(<ForecastScreen sample={monthForecastSample("negative")} />, { route: "/forecast" });
    const big = document.querySelector(".ui-forecast-big bdi");
    expect(big?.getAttribute("dir")).toBe("ltr");
    expect(big?.textContent.startsWith("₪")).toBe(true);
    const today = document.querySelector(".ui-fc-start bdi");
    expect(today?.getAttribute("dir")).toBe("ltr");
    expect(today?.textContent.startsWith("−₪")).toBe(true);
  });

  it("lists a moved item under לא החודש and counts it in the reset line", () => {
    renderWithProviders(<ForecastScreen sample={monthForecastSample("moved")} />, { route: "/forecast" });
    expect(screen.getByText("לא החודש")).toBeTruthy();
    expect(screen.getByText("שינית פריט אחד בצפי")).toBeTruthy();
    expect(screen.getByRole("button", { name: "איפוס" })).toBeTruthy();
  });

  it("counts two changed items in the reset line", () => {
    // The board's changed frame with its count doubled: the copy is the only thing under test.
    const sample = monthForecastBoardSample("changed");
    const twice = { ...sample, data: { ...sample.data, build: { ...sample.data.build, changed: 2 } } };
    renderWithProviders(<ForecastScreen sample={twice} />, { route: "/forecast" });
    expect(screen.getByText("שינית 2 פריטים בצפי")).toBeTruthy();
  });

  it("draws a moved item as one muted button with its name and amount, and no total on the head", () => {
    renderWithProviders(<ForecastScreen sample={monthForecastBoardSample("changed")} />, { route: "/forecast" });
    const head = screen.getByText("לא החודש");
    const section = head.closest("section");
    expect(section).toBeTruthy();
    expect(head.parentElement?.querySelector(".ui-forecast-section-total")).toBeNull();
    const row = within(section as HTMLElement).getByRole("button", { name: "Northgate Co, +$12,500" });
    expect(row.querySelector(".ui-forecast-initial")).toBeNull();
    expect(row.querySelector("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(row.textContent).toBe("Northgate Co+$12,500");
  });

  it("keeps the reset row in place with no changes: hidden, and its button disabled", () => {
    renderWithProviders(<ForecastScreen sample={monthForecastSample("positive")} />, { route: "/forecast" });
    const line = document.querySelector(".ui-forecast-changed");
    expect(line).toBeTruthy();
    expect(line?.getAttribute("aria-hidden")).toBe("true");
    expect(line?.classList.contains("ui-forecast-changed-on")).toBe(false);
    const reset = line?.querySelector("button");
    expect(reset?.disabled).toBe(true);
  });

  it("resets to Flow's numbers with an undo that sends each captured override back", async () => {
    rpc.mockClear();
    const sample = monthForecastBoardSample("changed");
    renderWithProviders(<ForecastScreen sample={sample} />, { route: "/forecast" });
    fireEvent.click(screen.getByRole("button", { name: "איפוס" }));
    await waitFor(() => { expect(rpc).toHaveBeenCalledWith("reset_forecast_month", { p_month: "2026-10" }); });
    await screen.findByText("הצפי חזר לחישוב של Flow");
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith("set_forecast_item", {
        p_month: "2026-10",
        p_item_key: "invoice:inv-1043",
        p_patch: { amount_minor: null, due_on: null, moved_out: true },
      });
    });
    expect(rpc.mock.calls.filter(([name]) => name === "set_forecast_item")).toHaveLength(1);
  });

  it("says everything arrived in the board's copy, with no figures, sections or footnote", () => {
    renderWithProviders(<ForecastScreen sample={monthForecastBoardSample("empty")} />, { route: "/forecast" });
    expect(screen.getByText("הכל כבר הגיע")).toBeTruthy();
    expect(screen.getByText("אוקטובר · נכון ל־30/10")).toBeTruthy();
    expect(screen.getByText(/הצפי לנובמבר ייפתח ב־1 בחודש/)).toBeTruthy();
    expect(document.querySelector(".ui-forecast-big")).toBeNull();
    expect(document.querySelector(".ui-fc-card")).toBeNull();
    expect(document.querySelector(".ui-forecast-changed")).toBeNull();
    expect(document.querySelector(".ui-forecast-foot")).toBeNull();
    expect(document.querySelector(".ui-forecast-compact")).toBeNull();
  });

  it("gives the footnote no link", () => {
    renderWithProviders(<ForecastScreen sample={monthForecastSample("positive")} />, { route: "/forecast" });
    const foot = document.querySelector(".ui-forecast-foot");
    expect(foot?.textContent).toContain("הקישו על פריט כדי לשנות סכום או מועד.");
    expect(foot?.querySelector("a")).toBeNull();
  });
});
