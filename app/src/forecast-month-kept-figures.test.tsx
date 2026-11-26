import { QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCompanyForecastTotals, useCompanyMonthRows } from "./company-forecast-query";
import { useSetForecastItem } from "./forecast-month";
import { flushKeptReads, keepReadsOf, resetKeptReadsForTests, restoreKeptReads } from "./kept-reads";
import type { KeptRow, KeptStore } from "./kept-store";
import { resetShownCompanyForTests, setShownCompany } from "./lib/company-header";
import type { CompanyForecastTotals } from "./company-forecast-map";
import type { ProjectForecastRead } from "./project-forecast-map";
import { projectForecastKey, useProjectForecast } from "./project-forecast-query";
import { SAMPLE_MONTH, SAMPLE_TODAY, sampleProjectForecastAnswer } from "./project-forecast-sample";
import { renderWithProviders } from "./test-render";

// FLOW-1341: a skip deletes the device's kept copies of the answers it changes at the tap, and keeps the patched ones again once the server has
// accepted it, so a cold start draws Profit's card and the project card at their post-skip figures at once, not as skeletons (and never the
// pre-skip figures). Invented keys only; the kept rows are checked against the real schemas when they are put back.
const server = vi.hoisted(() => ({ project: null, rows: null, totals: null }));
vi.mock("./lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: { p_detail?: string }) => {
      const data = name === "project_forecast" ? server.project : name === "company_forecast" ? (args?.p_detail === "rows" ? server.rows : server.totals) : null;
      return Promise.resolve({ data, error: null });
    },
  }),
}));
vi.mock("./wait-for-session", () => ({ waitForAccessToken: () => Promise.resolve() }));

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PROJECT = "juniper-ct";
const POWER = "party:expense:power:USD";
const FACTS = { rows: 1, recurring: 1, rent: 1, name: "Example Tenant" };
const row = (key: string, name: string, minor: number, extra: Record<string, unknown> = {}) => ({ key, kind: "recurring", direction: minor > 0 ? "income" : "expense", name, date: `${SAMPLE_MONTH}-05`, minor, ...extra });
const part = (rows: unknown[], expense: number) => ({ cash_only_minor: 0, average_months: 3, removed: [], arrived: [], loan_cash: [], project_id: PROJECT, income_minor: 100_000, expense_minor: expense, rows });
const month = (expense: number, rows: unknown[], skipped: unknown[]) => ({ month: SAMPLE_MONTH, income_minor: 100_000, expense_minor: expense, net_minor: 100_000 - expense, cash_only_minor: 0, projects: 1, general: false, income: FACTS, parts: [part(rows, expense)], skipped });
const rent = row("rec:income:t1", "Example Tenant", 100_000, { category_id: "c-rent" });
const power = row("rec:expense:power", "Power", -18_600);
const rowsOf = (expense: number, rows: unknown[], skipped: unknown[]) => ({ today: SAMPLE_TODAY, currency: "USD", months: [month(expense, rows, skipped)], income: FACTS, split_keys: [] });
const totalsOf = (expense: number) => ({ today: SAMPLE_TODAY, currency: "USD", months: [{ ...month(expense, [], []), parts: undefined, skipped: undefined }], income: FACTS });

const TOTALS_KEY = ["month-forecast", "off", "company", "totals", SAMPLE_TODAY, SAMPLE_MONTH];
const PROJECT_KEY = projectForecastKey("off", PROJECT, SAMPLE_MONTH, SAMPLE_TODAY, null);

function memoryStore(): KeptStore & { held: Map<string, KeptRow> } {
  const held = new Map<string, KeptRow>();
  return {
    held,
    all: () => Promise.resolve([...held.values()]),
    ids: () => Promise.resolve([...held.keys()]),
    put: (next) => { for (const item of next) held.set(item.id, item); return Promise.resolve(); },
    remove: (ids) => { for (const id of ids) held.delete(id); return Promise.resolve(); },
    clear: () => { held.clear(); return Promise.resolve(); },
  };
}

function Home() {
  useCompanyMonthRows(SAMPLE_TODAY, SAMPLE_MONTH, true, false);
  useCompanyForecastTotals(SAMPLE_TODAY, [SAMPLE_MONTH], true);
  useProjectForecast(PROJECT, SAMPLE_MONTH, SAMPLE_TODAY, null, true);
  const set = useSetForecastItem(SAMPLE_MONTH);
  return <button type="button" onClick={() => { set.mutate({ key: POWER, patch: { moved_out: true }, undo: false, prior: null }); }}>skip</button>;
}

beforeEach(() => {
  resetShownCompanyForTests();
  setShownCompany(USER, COMPANY);
  server.project = sampleProjectForecastAnswer();
  server.rows = rowsOf(18_600, [rent, power], []);
  server.totals = totalsOf(18_600);
});

describe("a cold start after a skip draws the post-skip figures (FLOW-1341)", () => {
  it("puts back Profit's card and the project card as the skip left them, never as before it", async () => {
    const store = memoryStore();
    resetKeptReadsForTests(store);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    keepReadsOf(client);
    renderWithProviders(<Home />, { client });
    await waitFor(() => { expect(client.isFetching()).toBe(0); });
    await waitFor(() => { expect(client.getQueryData(PROJECT_KEY)).toBeDefined(); });
    await flushKeptReads();
    expect(store.held.size).toBe(2);

    fireEvent.click(screen.getByRole("button", { name: "skip" }));
    await waitFor(() => { expect(client.isMutating()).toBe(0); });
    await waitFor(async () => { await flushKeptReads(); expect(store.held.size).toBe(2); });

    // A cold start: a new cache, the same device.
    const cold = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await restoreKeptReads(cold);
    const card = cold.getQueryData<CompanyForecastTotals>(TOTALS_KEY);
    expect(card?.months[0]?.expenseMinor).toBe(0n);
    expect(card?.months[0]?.netMinor).toBe(100_000n);
    const project = cold.getQueryData<ProjectForecastRead>(PROJECT_KEY);
    expect(project?.forecast.expenseMinor).toBe(34_000n);
    expect(project?.forecast.skipped?.map((item) => item.key)).toEqual(["rec:expense:power"]);
  });
});
