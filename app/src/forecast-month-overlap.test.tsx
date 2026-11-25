import { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCompanyForecastTotals, useCompanyMonthRows } from "./company-forecast-query";
import { companyCashForecast } from "./company-next-month";
import { useSetForecastItem } from "./forecast-month";
import { QUERY_STALE_MS } from "./query-client";
import { renderWithProviders } from "./test-render";

// FLOW-1323 (review): a skip reads no forecast after the write, so a forecast read that overlaps it must not leave the pre-skip answer:
// one under way at the tap, and one that begins between the tap and the write's commit. Invented keys only.
type Answer = { data: unknown; error: unknown };
type Server = { rows: unknown; totals: unknown; hold: Array<(value: unknown) => void> | null; write: () => Promise<Answer>; calls: string[] };
const server = vi.hoisted((): Server => ({ rows: null, totals: null, hold: null, write: () => Promise.resolve({ data: null, error: null }), calls: [] }));
vi.mock("./lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: unknown) => {
      server.calls.push(name);
      if (name === "set_forecast_item") return server.write();
      if (name === "company_forecast") {
        const detail = (args as { p_detail: string }).p_detail;
        const data = detail === "rows" ? server.rows : server.totals;
        // A held read answers with what the server held when it was sent.
        return server.hold == null || detail !== "rows" ? Promise.resolve({ data, error: null }) : new Promise<Answer>((resolve) => { server.hold?.push(() => { resolve({ data, error: null }); }); });
      }
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
const rent = row("rec:income:t1", "Example Tenant", 100_000, { category_id: "c-rent" });
const power = row("rec:expense:power", "Power", -18_600);
const part = (rows: unknown[], expense: number) => ({ cash_only_minor: 0, average_months: 3, removed: [], arrived: [], loan_cash: [], project_id: "p1", income_minor: 100_000, expense_minor: expense, rows });
const month = (expense: number, rows: unknown[], skipped: unknown[]) => ({ month: MONTH, income_minor: 100_000, expense_minor: expense, net_minor: 100_000 - expense, cash_only_minor: 0, projects: 1, general: false, income: FACTS, parts: [part(rows, expense)], skipped });
const rowsOf = (expense: number, rows: unknown[], skipped: unknown[]) => ({ today: TODAY, currency: "USD", months: [month(expense, rows, skipped)], income: FACTS, split_keys: [] });
const totalsOf = (expense: number) => ({ today: TODAY, currency: "USD", months: [{ ...month(expense, [], []), parts: undefined, skipped: undefined }], income: FACTS });
const BEFORE = rowsOf(18_600, [rent, power], []);
const AFTER = rowsOf(0, [rent], [{ ...power, project_id: "p1" }]);

function Band() {
  const read = useCompanyMonthRows(TODAY, MONTH, true, false);
  const set = useSetForecastItem(MONTH);
  const cash = read.answer == null ? null : companyCashForecast(read.answer.forecast);
  return (
    <>
      <p data-testid="band">{cash == null ? "loading" : `${String(cash.netMinor)} ${String(cash.expenseMinor)}`}</p>
      <button type="button" onClick={() => { set.mutate({ key: POWER, patch: { moved_out: true }, undo: false, prior: null }); }}>skip</button>
    </>
  );
}

function Card() {
  const read = useCompanyForecastTotals(TODAY, [MONTH], true);
  return <p data-testid="card">{read.data == null ? "none" : String(read.data.months[0]?.expenseMinor)}</p>;
}

const band = () => screen.getByTestId("band").textContent;
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: QUERY_STALE_MS } } });

beforeEach(() => {
  server.rows = BEFORE;
  server.totals = totalsOf(18_600);
  server.hold = null;
  server.calls.length = 0;
  server.write = () => Promise.resolve({ data: null, error: null });
});

describe("a forecast read that overlaps a skip (FLOW-1323)", () => {
  it("a rows read under way at the tap does not bring the pre-skip figures back: the band ends at the post-skip answer", async () => {
    const client = newClient();
    renderWithProviders(<Band />, { route: "/", client });
    await waitFor(() => { expect(band()).toBe("81400 18600"); });
    // Re-entering the month reads the rows again (everything is stale after a write); that read is still out when the skip is tapped.
    server.hold = [];
    void client.invalidateQueries({ queryKey: ["month-forecast"], predicate: (query) => query.queryKey[3] === "rows" });
    await waitFor(() => { expect(server.hold?.length).toBe(1); });
    let commit: () => void = () => undefined;
    server.write = () => new Promise<Answer>((resolve) => { commit = () => { server.rows = AFTER; resolve({ data: null, error: null }); }; });
    fireEvent.click(screen.getByRole("button", { name: "skip" }));
    await waitFor(() => { expect(band()).toBe("100000 0"); });
    // The held read answers with the pre-skip rows: it was cancelled, so the band stays.
    await act(async () => { server.hold?.forEach((answer) => { answer(null); }); await Promise.resolve(); });
    expect(band()).toBe("100000 0");
    server.hold = null;
    commit();
    await waitFor(() => { expect(client.isMutating()).toBe(0); });
    await waitFor(() => { expect(client.isFetching()).toBe(0); });
    expect(band()).toBe("100000 0");
  });

  it("a totals read that begins between the tap and the commit is read again once the write settles", async () => {
    const client = newClient();
    renderWithProviders(<><Band /><Card /></>, { route: "/", client });
    await waitFor(() => { expect(band()).toBe("81400 18600"); });
    await waitFor(() => { expect(screen.getByTestId("card").textContent).toBe("18600"); });
    let commit: () => void = () => undefined;
    server.write = () => new Promise<Answer>((resolve) => { commit = () => { server.rows = AFTER; server.totals = totalsOf(0); resolve({ data: null, error: null }); }; });
    fireEvent.click(screen.getByRole("button", { name: "skip" }));
    await waitFor(() => { expect(screen.getByTestId("card").textContent).toBe("0"); });
    // Profit opens while the write is out: its totals read starts now and lands the server's pre-skip answer.
    await act(async () => { await client.invalidateQueries({ queryKey: ["month-forecast"], predicate: (query) => query.queryKey[3] === "totals" }); });
    await waitFor(() => { expect(screen.getByTestId("card").textContent).toBe("18600"); });
    commit();
    await waitFor(() => { expect(client.isMutating()).toBe(0); });
    await waitFor(() => { expect(screen.getByTestId("card").textContent).toBe("0"); });
    expect(band()).toBe("100000 0");
  });
});
