// FLOW-1056: Home on next month: the forecast's rows grouped by project, and its band figures. Invented sample.
import { describe, expect, it } from "vitest";
import { companyCashForecast, companyNextMonthForecast } from "../company-next-month";
import { HOME_NEXT_MONTH_SAMPLE, NEXT_MONTH_PROJECTS, NEXT_MONTH_TODAY } from "../dev/home-next-month-sample";
import { nothingExpected, thisMonthCashOut } from "./company-cash-next-month";
import { orderParts } from "./company-next-month-screen";
import { companyMonthForecast } from "../company-year-forecast";
import { FAR_MONTH_CAPTION, homeFutureGroups, homeFutureView } from "./home-future-month";

const reads = HOME_NEXT_MONTH_SAMPLE.next;
const INPUT = { currency: "USD", today: NEXT_MONTH_TODAY, recurring: reads.recurring, loans: reads.loans, categories: reads.categories, inputs: reads.inputs };
const PROFIT = companyNextMonthForecast(INPUT);
const FORECAST = companyCashForecast(PROFIT);
const PROJECTS = NEXT_MONTH_PROJECTS.projects;

function view(over: Partial<Parameters<typeof homeFutureView>[0]> = {}) {
  return homeFutureView({
    forecast: FORECAST,
    profitMinor: PROFIT.netMinor,
    categories: [],
    projects: PROJECTS,
    cash: HOME_NEXT_MONTH_SAMPLE.cash,
    today: NEXT_MONTH_TODAY,
    currency: "USD",
    search: "",
    loading: false,
    failed: false,
    offline: false,
    onRetry: () => undefined,
    ...over,
  });
}

describe("homeFutureGroups (FLOW-1056)", () => {
  it("groups the forecast's rows by project in the Projects tab's order, the general costs last, every row due", () => {
    const groups = homeFutureGroups({ forecast: FORECAST, projects: PROJECTS, currency: "USD", search: "" });
    expect(groups.length).toBeGreaterThan(1);
    // The צפי page's order (the Projects tab's), so Home and פירוט ועריכה list the projects alike.
    const order = orderParts(FORECAST.parts, PROJECTS, "USD").map((part) => part.projectId ?? "general");
    expect(groups.map((group) => group.id)).toEqual(order.filter((id) => groups.some((group) => group.id === id)));
    const general = groups.find((group) => group.id === "general");
    if (general != null) {
      expect(groups.at(-1)).toBe(general);
      expect(general.title).toBe("כללי");
    }
    for (const group of groups) {
      expect(group.due).toBe(true);
      expect(group.rows.every((row) => row.mark === "due")).toBe(true);
    }
  });

  it("sums each group in the currency and names its project", () => {
    const groups = homeFutureGroups({ forecast: FORECAST, projects: PROJECTS, currency: "USD", search: "" });
    const names = new Map(PROJECTS.map((row) => [row.id, row.name]));
    for (const group of groups) {
      if (group.id !== "general") expect(group.title).toBe(names.get(group.id));
      const out = group.rows.filter((row) => !row.income).reduce((sum, row) => sum + row.minor, 0n);
      const income = group.rows.filter((row) => row.income).reduce((sum, row) => sum + row.minor, 0n);
      expect(group.outMinor).toBe(out);
      expect(group.inMinor).toBe(income);
    }
  });

  it("opens each row's project's צפי page, a general row the overhead project's, and none without one", () => {
    const groups = homeFutureGroups({ forecast: FORECAST, projects: PROJECTS, currency: "USD", search: "?preview=1" });
    for (const group of groups.filter((item) => item.id !== "general")) {
      expect(group.rows.every((row) => row.href === `/projects/${group.id}/profit/next?preview=1`)).toBe(true);
    }
    const overhead = PROJECTS.find((row) => row.is_overhead)?.id ?? "";
    const general = groups.find((group) => group.id === "general");
    if (general != null) expect(general.rows.every((row) => row.href === `/projects/${overhead}/profit/next?preview=1`)).toBe(true);
    const noOverhead = homeFutureGroups({ forecast: FORECAST, projects: PROJECTS.filter((row) => !row.is_overhead), currency: "USD", search: "" });
    expect(noOverhead.find((group) => group.id === "general")?.rows.every((row) => row.href == null) ?? true).toBe(true);
  });

  it("is empty when nothing is expected", () => {
    const empty = { ...FORECAST, rows: [], parts: [], incomeMinor: 0n, expenseMinor: 0n, netMinor: 0n };
    expect(nothingExpected(empty)).toBe(true);
    expect(homeFutureGroups({ forecast: empty, projects: PROJECTS, currency: "USD", search: "" })).toEqual([]);
  });
});

describe("homeFutureView (FLOW-1056)", () => {
  it("gives the band the expected net, in and out, as the drawer's card did", () => {
    const ready = view();
    expect(ready.phase).toBe("ready");
    expect(ready.figures).toMatchObject({ netMinor: FORECAST.netMinor, incomeMinor: FORECAST.incomeMinor, expenseMinor: FORECAST.expenseMinor, currency: "USD" });
    expect(ready.figures?.expenseNote).toMatch(/^מול /u);
  });

  it("says loading until the forecast is read, and failed over loading", () => {
    expect(view({ loading: true }).phase).toBe("loading");
    expect(view({ forecast: null }).phase).toBe("loading");
    expect(view({ failed: true, loading: true })).toMatchObject({ phase: "failed", figures: null, groups: [] });
  });

  it("carries the month's expected profit, the profit-basis net, for the פירוט ועריכה row (FLOW-1066)", () => {
    expect(view().figures?.profitMinor).toBe(PROFIT.netMinor);
    expect(view({ profitMinor: null }).phase).toBe("loading");
  });

  it("next month keeps its caption and its comparison line", () => {
    const figures = view().figures;
    expect(figures?.caption).not.toBe(FAR_MONTH_CAPTION);
    expect(figures?.expenseNote).toMatch(/^מול /u);
  });

  it("leaves the expense line empty until this month's cash out is known, never \"מול $0\"", () => {
    expect(view({ cash: null }).figures?.expenseNote).toBe("");
    expect(thisMonthCashOut(null, NEXT_MONTH_TODAY, "USD")).toBeNull();
    expect(thisMonthCashOut(HOME_NEXT_MONTH_SAMPLE.cash, NEXT_MONTH_TODAY, "USD")).toBe(2_220_000n);
  });
});

describe("Home on a month after next (FLOW-1066)", () => {
  const profit = companyMonthForecast(INPUT, "2027-03");
  const far = companyCashForecast(profit);
  const ready = view({ forecast: far, profitMinor: profit.netMinor });

  it("is that month's forecast, with the estimate's note as its caption and no comparison with this month", () => {
    expect(far.month).toBe("2027-03");
    expect(ready.figures).toMatchObject({ netMinor: far.netMinor, incomeMinor: far.incomeMinor, expenseMinor: far.expenseMinor, profitMinor: profit.netMinor });
    expect(ready.figures?.caption).toBe(FAR_MONTH_CAPTION);
    expect(ready.figures?.expenseNote).toMatch(/^(קבועים וממוצעים|אין הוצאות צפויות)$/u);
  });

  it("opens each row's project's צפי page for that month", () => {
    const rows = ready.groups.flatMap((group) => group.rows).filter((row) => row.href != null);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.href?.endsWith("/profit/next?month=2027-03"))).toBe(true);
    const preview = view({ forecast: far, profitMinor: profit.netMinor, search: "?preview=1" });
    expect(preview.groups.flatMap((group) => group.rows).find((row) => row.href != null)?.href).toMatch(/\/profit\/next\?preview=1&month=2027-03$/u);
  });
});
