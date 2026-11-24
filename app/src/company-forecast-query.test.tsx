import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCompanyForecastTotals, useCompanyMonthRows } from "./company-forecast-query";
import { renderWithProviders } from "./test-render";

// FLOW-1308: company_forecast is one request per view, with the Israel day, and a failed or malformed answer is a failed read.
// Invented answers in the shape of FLOW-1307's.
type Rpc = { calls: Array<{ name: string; args: unknown }>; answers: Record<string, unknown>; fail: string | null };
const rpc = vi.hoisted((): Rpc => ({ calls: [], answers: {}, fail: null }));

vi.mock("./lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: unknown) => {
      rpc.calls.push({ name, args });
      if (rpc.fail === name) return Promise.resolve({ data: null, error: new Error("offline") });
      return Promise.resolve({ data: rpc.answers[name] ?? null, error: null });
    },
  }),
}));
vi.mock("./wait-for-session", () => ({ waitForAccessToken: () => Promise.resolve() }));

const TODAY = "2026-11-24";
const FACTS = { rows: 1, recurring: 1, rent: 1, name: "Example Tenant" };
const NOTHING = { rows: 0, recurring: 0, rent: 0 };

function month(name: string, extra: Record<string, unknown> = {}) {
  return { month: name, income_minor: 100_000, expense_minor: 40_000, net_minor: 60_000, cash_only_minor: 5_000, projects: 1, general: false, income: FACTS, ...extra };
}

const rowsAnswer = {
  today: TODAY,
  currency: "USD",
  months: [month("2026-12", {
    parts: [{
      project_id: "p1", income_minor: 100_000, expense_minor: 40_000, cash_only_minor: 5_000, average_months: 6, removed: [], arrived: [], loan_cash: [{ loan_id: "l1", row_category_ids: [], minor: 5_000 }],
      rows: [
        { key: "avg:c1", kind: "average", direction: "expense", name: "Repairs", minor: -40_000, category_id: "c1" },
        { key: "rec:income:t1", kind: "recurring", direction: "income", name: "Example Tenant", date: "2026-12-05", minor: 100_000, category_id: "c-rent" },
      ],
    }],
    skipped: [],
  })],
  income: FACTS,
  split_keys: [],
};

const totalsAnswer = (months: string[]) => ({ today: TODAY, currency: "USD", months: months.map((name) => month(name)), income: FACTS });

function Totals({ months }: { months: string[] }) {
  const read = useCompanyForecastTotals(TODAY, months, true);
  return <p data-testid="out">{read.isError ? "failed" : read.data == null ? "loading" : `${String(read.data.months.length)} months, ${String(read.data.months[0]?.incomeMinor)}`}</p>;
}

function Rows({ withOverrides = false }: { withOverrides?: boolean }) {
  const read = useCompanyMonthRows(TODAY, "2026-12", true, withOverrides);
  const forecast = read.answer?.forecast;
  return (
    <>
      <p data-testid="out">{read.failed ? "failed" : read.pending ? "loading" : forecast == null ? "none" : forecast.rows.map((row) => row.name).join(",")}</p>
      <p data-testid="income">{forecast == null ? "" : String(forecast.incomeMinor)}</p>
      <button type="button" onClick={() => { void read.refetch(); }}>retry</button>
    </>
  );
}

function calls(name: string) {
  return rpc.calls.filter((call) => call.name === name);
}

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeEach(() => {
  rpc.calls.length = 0;
  rpc.fail = null;
  rpc.answers = { company_forecast: null, forecast_overrides_for: [] };
});

describe("useCompanyForecastTotals (FLOW-1308)", () => {
  it("reads next month's totals in one request: the month, 'totals' and the day", async () => {
    rpc.answers.company_forecast = totalsAnswer(["2026-12"]);
    renderWithProviders(<Totals months={["2026-12"]} />, { route: "/", client: client() });
    await waitFor(() => { expect(screen.getByTestId("out").textContent).toBe("1 months, 100000"); });
    expect(rpc.calls).toEqual([{ name: "company_forecast", args: { p_months: ["2026-12"], p_detail: "totals", p_today: TODAY } }]);
  });

  it("reads every month left in the year in one request, in the order asked", async () => {
    const months = ["2026-12", "2027-01", "2027-02"];
    rpc.answers.company_forecast = totalsAnswer(months);
    renderWithProviders(<Totals months={months} />, { route: "/", client: client() });
    await waitFor(() => { expect(screen.getByTestId("out").textContent).toBe("3 months, 100000"); });
    expect(calls("company_forecast")).toHaveLength(1);
    expect(calls("company_forecast")[0]?.args).toEqual({ p_months: months, p_detail: "totals", p_today: TODAY });
  });

  it("asks nothing for no month (December has none left)", () => {
    renderWithProviders(<Totals months={[]} />, { route: "/", client: client() });
    expect(screen.getByTestId("out").textContent).toBe("loading");
    expect(rpc.calls).toEqual([]);
  });

  it("a failed read, or an answer with an unsafe amount, is a failed read", async () => {
    rpc.fail = "company_forecast";
    const first = renderWithProviders(<Totals months={["2026-12"]} />, { route: "/", client: client() });
    await waitFor(() => { expect(screen.getByTestId("out").textContent).toBe("failed"); });
    first.unmount();
    rpc.fail = null;
    rpc.answers.company_forecast = { ...totalsAnswer(["2026-12"]), months: [month("2026-12", { income_minor: 2 ** 60 })] };
    renderWithProviders(<Totals months={["2026-12"]} />, { route: "/", client: client() });
    await waitFor(() => { expect(screen.getByTestId("out").textContent).toBe("failed"); });
  });
});

describe("useCompanyMonthRows (FLOW-1308)", () => {
  it("reads a month's page in one request ('rows', the month, the day), and nothing of the four reads it replaced", async () => {
    rpc.answers.company_forecast = rowsAnswer;
    renderWithProviders(<Rows />, { route: "/", client: client() });
    // The rows come in the builder's order: the recurring charge first, the average after it.
    await waitFor(() => { expect(screen.getByTestId("out").textContent).toBe("Example Tenant,Repairs"); });
    expect(screen.getByTestId("income").textContent).toBe("100000");
    expect(rpc.calls).toEqual([{ name: "company_forecast", args: { p_months: ["2026-12"], p_detail: "rows", p_today: TODAY } }]);
  });

  it("reads the month's override rows too only where a row can be skipped (for the undo)", async () => {
    rpc.answers.company_forecast = rowsAnswer;
    renderWithProviders(<Rows withOverrides />, { route: "/", client: client() });
    await waitFor(() => { expect(screen.getByTestId("out").textContent).toBe("Example Tenant,Repairs"); });
    expect(calls("company_forecast")).toHaveLength(1);
    expect(calls("forecast_overrides_for").map((call) => call.args)).toEqual([{ p_month: "2026-12" }]);
  });

  it("a failed read is failed, and the retry reads again", async () => {
    rpc.fail = "company_forecast";
    renderWithProviders(<Rows />, { route: "/", client: client() });
    await waitFor(() => { expect(screen.getByTestId("out").textContent).toBe("failed"); });
    rpc.fail = null;
    rpc.answers.company_forecast = rowsAnswer;
    screen.getByRole("button", { name: "retry" }).click();
    await waitFor(() => { expect(screen.getByTestId("out").textContent).toBe("Example Tenant,Repairs"); });
    expect(calls("company_forecast")).toHaveLength(2);
  });

  it("an answer that is not of one month with its parts is a failed read", async () => {
    rpc.answers.company_forecast = { ...rowsAnswer, months: [month("2026-12")] };
    renderWithProviders(<Rows />, { route: "/", client: client() });
    await waitFor(() => { expect(screen.getByTestId("out").textContent).toBe("failed"); });
  });

  it("an answer with no income facts at all is refused, not drawn as empty", async () => {
    rpc.answers.company_forecast = { ...rowsAnswer, income: NOTHING, months: [{ ...(rowsAnswer.months[0] as object), income: undefined }] };
    renderWithProviders(<Rows />, { route: "/", client: client() });
    await waitFor(() => { expect(screen.getByTestId("out").textContent).toBe("failed"); });
  });
});
