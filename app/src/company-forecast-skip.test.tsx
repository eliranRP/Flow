import { QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { companyCashForecast, companyIncomeNoteOfFacts } from "./company-next-month";
import { useCompanyForecastTotals, useCompanyMonthRows } from "./company-forecast-query";
import { useSetForecastItem } from "./forecast-month";
import { QUERY_STALE_MS } from "./query-client";
import { renderWithProviders } from "./test-render";

// FLOW-1308 (review): a skip changes the company forecast's totals on the tap, as it did when the app built them from the
// cached inputs (FLOW-1214); a failed write puts them back; and no cached 'totals' keeps a pre-skip figure for Profit.
type Answer = { data: unknown; error: unknown };
type Rpc = { calls: Array<{ name: string; args: unknown }>; write: () => Promise<Answer>; rows: unknown; totals: unknown };
const rpc = vi.hoisted((): Rpc => ({ calls: [], write: () => Promise.resolve({ data: null, error: null }), rows: null, totals: null }));

vi.mock("./lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: unknown) => {
      rpc.calls.push({ name, args });
      if (name === "set_forecast_item") return rpc.write();
      if (name === "company_forecast") return Promise.resolve({ data: (args as { p_detail: string }).p_detail === "rows" ? rpc.rows : rpc.totals, error: null });
      return Promise.resolve({ data: [], error: null });
    },
  }),
}));
vi.mock("./wait-for-session", () => ({ waitForAccessToken: () => Promise.resolve() }));

const TODAY = "2026-11-24";
const MONTH = "2026-12";
const POWER = "party:expense:power:USD";
const FACTS = { rows: 1, recurring: 1, rent: 1, name: "Example Tenant" };
const row = (key: string, name: string, minor: number, extra: Record<string, unknown> = {}) => ({ key, kind: "recurring", direction: minor > 0 ? "income" : "expense", name, date: `${MONTH}-05`, minor, ...extra });
const part = (extra: Record<string, unknown>) => ({ cash_only_minor: 0, average_months: 3, removed: [], arrived: [], loan_cash: [], ...extra });

/** One project with a rent in and a power charge out (18,600), as company_forecast gives it for 'rows'. */
const ROWS = {
  today: TODAY,
  currency: "USD",
  months: [{
    month: MONTH, income_minor: 100_000, expense_minor: 18_600, net_minor: 81_400, cash_only_minor: 0, projects: 1, general: false, income: FACTS,
    parts: [part({ project_id: "p1", income_minor: 100_000, expense_minor: 18_600, rows: [row("rec:income:t1", "Example Tenant", 100_000, { category_id: "c-rent" }), row("rec:expense:power", "Power", -18_600)] })],
    skipped: [],
  }],
  income: FACTS,
  split_keys: [],
};
const TOTALS = { today: TODAY, currency: "USD", months: [{ month: MONTH, income_minor: 100_000, expense_minor: 18_600, net_minor: 81_400, cash_only_minor: 0, projects: 1, general: false, income: FACTS }], income: FACTS };

function Band() {
  const read = useCompanyMonthRows(TODAY, MONTH, true, false);
  const set = useSetForecastItem(MONTH);
  const profit = read.answer?.forecast ?? null;
  const cash = profit == null ? null : companyCashForecast(profit);
  return (
    <>
      <p data-testid="band">{cash == null ? "loading" : `${String(cash.netMinor)} ${String(cash.expenseMinor)} ${String(read.answer?.months[0]?.netMinor)}`}</p>
      <button type="button" onClick={() => { set.mutate({ key: POWER, patch: { moved_out: true }, undo: false, prior: null }); }}>skip</button>
    </>
  );
}

function Card({ enabled }: { enabled: boolean }) {
  const read = useCompanyForecastTotals(TODAY, [MONTH], enabled);
  return <p data-testid="card">{read.data == null ? "none" : String(read.data.months[0]?.expenseMinor)}</p>;
}

const calls = (name: string) => rpc.calls.filter((call) => call.name === name);
const band = () => screen.getByTestId("band").textContent;
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: QUERY_STALE_MS } } });

beforeEach(() => {
  rpc.calls.length = 0;
  rpc.write = () => Promise.resolve({ data: null, error: null });
  rpc.rows = ROWS;
  rpc.totals = TOTALS;
});

describe("a skip and the company forecast (FLOW-1308)", () => {
  it("changes the band's net, expense and month totals on the tap, before the write answers", async () => {
    let answer: (value: Answer) => void = () => undefined;
    rpc.write = () => new Promise<Answer>((resolve) => { answer = resolve; });
    const client = newClient();
    renderWithProviders(<Band />, { route: "/", client });
    await waitFor(() => { expect(band()).toBe("81400 18600 81400"); });
    fireEvent.click(screen.getByRole("button", { name: "skip" }));
    await waitFor(() => { expect(band()).toBe("100000 0 100000"); });
    // The write is still out: the figures moved on the tap.
    expect(client.isMutating()).toBe(1);
    answer({ data: null, error: null });
    await waitFor(() => { expect(client.isMutating()).toBe(0); });
  });

  it("puts the figures back when the write fails", async () => {
    let refuse: () => void = () => undefined;
    rpc.write = () => new Promise<Answer>((resolve) => { refuse = () => { resolve({ data: null, error: { message: "refused" } }); }; });
    renderWithProviders(<Band />, { route: "/", client: newClient() });
    await waitFor(() => { expect(band()).toBe("81400 18600 81400"); });
    fireEvent.click(screen.getByRole("button", { name: "skip" }));
    await waitFor(() => { expect(band()).toBe("100000 0 100000"); });
    refuse();
    await waitFor(() => { expect(band()).toBe("81400 18600 81400"); });
  });

  it("writes the cached totals of Profit's card from the patched month at the tap, so it draws at once with the skip, and puts them back when the write fails", async () => {
    let refuse: () => void = () => undefined;
    rpc.write = () => new Promise<Answer>((resolve) => { refuse = () => { resolve({ data: null, error: { message: "refused" } }); }; });
    const client = newClient();
    // Profit was open before: its card's totals and its year view's are cached (as kept rows are put back), and it is not mounted now.
    const month = { month: MONTH, incomeMinor: 100_000n, expenseMinor: 18_600n, netMinor: 81_400n, cashOnlyMinor: 0n, projects: 1, general: false, income: { ...FACTS, rent: 1 } };
    const card = ["month-forecast", "off", "company", "totals", TODAY, MONTH];
    const year = ["month-forecast", "off", "company", "totals", TODAY, `${MONTH},2027-01`];
    client.setQueryData(card, { today: TODAY, currency: "USD", months: [month], income: FACTS });
    client.setQueryData(year, { today: TODAY, currency: "USD", months: [month, { ...month, month: "2027-01" }], income: FACTS });
    renderWithProviders(<Band />, { route: "/", client });
    await waitFor(() => { expect(band()).toBe("81400 18600 81400"); });
    fireEvent.click(screen.getByRole("button", { name: "skip" }));
    await waitFor(() => { expect(client.getQueryData(year)).toBeUndefined(); });
    // The card's totals are the month's with the skip, while the write is out.
    renderWithProviders(<Card enabled />, { route: "/", client });
    expect(screen.getByTestId("card").textContent).toBe("0");
    expect(calls("set_forecast_item")).toHaveLength(1);
    refuse();
    await waitFor(() => { expect(band()).toBe("81400 18600 81400"); });
    expect(String((client.getQueryData(card) as { months: Array<{ expenseMinor: bigint }> }).months[0]?.expenseMinor)).toBe("18600");
  });

  it("keeps the card's patched totals after the write succeeds: Profit opens and draws the post-skip figure at once, with no read before it", async () => {
    const client = newClient();
    const card = ["month-forecast", "off", "company", "totals", TODAY, MONTH];
    const month = { month: MONTH, incomeMinor: 100_000n, expenseMinor: 18_600n, netMinor: 81_400n, cashOnlyMinor: 0n, projects: 1, general: false, income: FACTS };
    client.setQueryData(card, { today: TODAY, currency: "USD", months: [month], income: FACTS });
    renderWithProviders(<Band />, { route: "/", client });
    await waitFor(() => { expect(band()).toBe("81400 18600 81400"); });
    fireEvent.click(screen.getByRole("button", { name: "skip" }));
    await waitFor(() => { expect(client.isMutating()).toBe(0); });
    expect(calls("set_forecast_item")).toHaveLength(1);
    // The write has succeeded: the card's answer is still there, patched.
    expect(client.getQueryData(card)).toBeDefined();
    const before = calls("company_forecast").filter((call) => (call.args as { p_detail: string }).p_detail === "totals").length;
    renderWithProviders(<Card enabled />, { route: "/", client });
    // Drawn in the render that mounted it, from the cache, with no totals read sent before it.
    expect(screen.getByTestId("card").textContent).toBe("0");
    expect(calls("company_forecast").filter((call) => (call.args as { p_detail: string }).p_detail === "totals")).toHaveLength(before);
  });

  it("moves the income note's counts on the tap, with the categories Home holds, and back when the write fails", async () => {
    let refuse: () => void = () => undefined;
    rpc.write = () => new Promise<Answer>((resolve) => { refuse = () => { resolve({ data: null, error: { message: "refused" } }); }; });
    const facts = { rows: 2, recurring: 2, rent: 2, name: null };
    const rent = (id: string) => row(`rec:income:${id}`, id, 50_000, { category_id: "c-rent" });
    rpc.rows = { ...ROWS, income: facts, months: [{ ...ROWS.months[0], income_minor: 100_000, expense_minor: 0, net_minor: 100_000, income: facts, parts: [part({ project_id: "p1", income_minor: 100_000, expense_minor: 0, rows: [rent("t1"), rent("t2")] })] }] };
    const client = newClient();
    client.setQueryData(["categories", "off"], [{ id: "c-rent", name: "שכירות", parent_id: null }]);
    function Note() {
      const read = useCompanyMonthRows(TODAY, MONTH, true, false);
      const set = useSetForecastItem(MONTH);
      const facts0 = read.answer?.months[0]?.income;
      return (
        <>
          <p data-testid="note">{facts0 == null ? "loading" : companyIncomeNoteOfFacts(facts0)}</p>
          <button type="button" onClick={() => { set.mutate({ key: "party:income:t1:USD", patch: { moved_out: true }, undo: false, prior: null }); }}>skip rent</button>
        </>
      );
    }
    renderWithProviders(<Note />, { route: "/", client });
    await waitFor(() => { expect(screen.getByTestId("note").textContent).toBe("2 שכירויות קבועות"); });
    fireEvent.click(screen.getByRole("button", { name: "skip rent" }));
    await waitFor(() => { expect(screen.getByTestId("note").textContent).toBe("שכירות קבועה אחת"); });
    expect(client.isMutating()).toBe(1);
    refuse();
    await waitFor(() => { expect(screen.getByTestId("note").textContent).toBe("2 שכירויות קבועות"); });
  });
});
