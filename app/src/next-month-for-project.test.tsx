import { QueryClient } from "@tanstack/react-query";
import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JUNIPER_NEXT } from "./dev/project-next-month-sample";
import { useProjectNextMonth } from "./next-month-for-project";
import { projectForecastOf } from "./project-forecast-map";
import { sampleProjectForecastAnswer } from "./project-forecast-sample";
import { nextMonthKey } from "./project-next-month";
import { QUERY_STALE_MS } from "./query-client";
import { renderWithProviders } from "./test-render";
import { israelToday } from "./ui/date-math";

// FLOW-1315: the project page's forecast is one read, project_forecast. The fake client logs every request. Invented answers only.
type Reply = { data: unknown; error: unknown };
const server = vi.hoisted((): { calls: Array<{ name: string; args: unknown }>; tables: string[]; answers: Record<string, unknown>; reply: ((name: string) => Reply | null) | null } => ({
  calls: [],
  tables: [],
  answers: {},
  reply: null,
}));

vi.mock("./lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: unknown) => {
      server.calls.push({ name, args });
      return Promise.resolve(server.reply?.(name) ?? { data: server.answers[name] ?? null, error: null });
    },
    from: (table: string) => {
      server.tables.push(table);
      return { select: () => Promise.resolve({ data: [], error: null }) };
    },
  }),
}));
vi.mock("./wait-for-session", () => ({ waitForAccessToken: () => Promise.resolve() }));

const today = israelToday();
const month = nextMonthKey(today);
const PROJECT = "project-1";

let latest: ReturnType<typeof useProjectNextMonth> | null = null;

function Probe({ currency = "USD", enabled = true, withCategories = false, forMonth, id = PROJECT }: { currency?: string; enabled?: boolean; withCategories?: boolean; forMonth?: string; id?: string }) {
  latest = useProjectNextMonth(id, currency, undefined, enabled, forMonth, withCategories);
  return null;
}

function calls(name: string) {
  return server.calls.filter((call) => call.name === name);
}

/** A client as the page has it: the company's currency already read (the page reads it before the forecast), the app's freshness. */
function pageClient(company: string | null = "USD") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: QUERY_STALE_MS } } });
  if (company != null) client.setQueryData(["company-currency", "off"], company);
  return client;
}

beforeEach(() => {
  server.calls.length = 0;
  server.tables.length = 0;
  server.reply = null;
  server.answers = { project_forecast: sampleProjectForecastAnswer(), list_categories: [] };
  latest = null;
});

describe("the project page's forecast is one read (FLOW-1315)", () => {
  it("sends project_forecast once, with the day and no currency for a project in the company's, and no other forecast read", async () => {
    renderWithProviders(<Probe />, { route: "/", client: pageClient() });
    await waitFor(() => { expect(latest?.forecast).not.toBeNull(); });
    expect(server.calls.map((call) => call.name)).toEqual(["project_forecast"]);
    expect(calls("project_forecast")[0]?.args).toEqual({ p_project: PROJECT, p_month: month, p_today: today });
    // None of the six reads the page made before: the charges, the category months, the edits, the overrides, the loans and the categories.
    expect(server.tables).toEqual([]);
    const expected = projectForecastOf(sampleProjectForecastAnswer(), PROJECT);
    expect(latest?.forecast).toEqual(expected?.forecast);
    expect(latest?.income).toEqual(expected?.income);
    expect(latest?.overrides).toEqual([]);
    expect(latest?.pending).toBe(false);
    expect(latest?.failed).toBe(false);
    expect(latest?.general).toBe(false);
    expect(latest?.currency).toBe("USD");
  });

  it("asks for a project's own currency when its figures are not in the company's, and only then", async () => {
    server.answers.project_forecast = { ...sampleProjectForecastAnswer(), currency: "ILS" };
    renderWithProviders(<Probe currency="ILS" />, { route: "/", client: pageClient("USD") });
    await waitFor(() => { expect(latest?.forecast).not.toBeNull(); });
    expect(calls("project_forecast")[0]?.args).toEqual({ p_project: PROJECT, p_month: month, p_today: today, p_currency: "ILS" });
  });

  it("names no currency while the company's is unknown, so the card's read is never for a guessed one", async () => {
    renderWithProviders(<Probe currency="ILS" />, { route: "/", client: pageClient(null) });
    await waitFor(() => { expect(calls("project_forecast")).toHaveLength(1); });
    expect(calls("project_forecast")[0]?.args).toEqual({ p_project: PROJECT, p_month: month, p_today: today });
  });

  it("does not draw an answer in another currency than the page's, which came while the company's was unknown: it stays pending", async () => {
    server.answers.mcp_company_loan_currency = "USD";
    renderWithProviders(<Probe currency="ILS" />, { route: "/", client: pageClient(null) });
    await waitFor(() => { expect(calls("project_forecast").length).toBeGreaterThan(0); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    // The answer is in dollars (the company's), the page's figures are shekels: nothing is drawn.
    expect(latest?.forecast).toBeNull();
    expect(latest?.pending).toBe(true);
  });

  it("reads a month of the forecast when asked (?month=), and nothing while it is not enabled", async () => {
    const later = nextMonthKey(`${month}-15`);
    const view = renderWithProviders(<Probe enabled={false} />, { route: "/", client: pageClient() });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(server.calls).toEqual([]);
    expect(latest?.forecast).toBeNull();
    view.rerender(<Probe forMonth={later} />);
    await waitFor(() => { expect(latest?.forecast).not.toBeNull(); });
    expect(calls("project_forecast")[0]?.args).toMatchObject({ p_month: later });
    expect(latest?.month).toBe(later);
  });

  it("the overhead project's page is the same read: its answer says general, in the company's currency", async () => {
    server.answers.project_forecast = { ...sampleProjectForecastAnswer(), general: true, currency: "ILS" };
    renderWithProviders(<Probe currency="USD" />, { route: "/", client: pageClient("ILS") });
    await waitFor(() => { expect(latest?.forecast).not.toBeNull(); });
    expect(latest?.general).toBe(true);
    expect(latest?.currency).toBe("ILS");
    expect(server.calls.map((call) => call.name)).toEqual(["project_forecast"]);
  });

  it("gives the edit page its history with the uncategorized row's id as null, its charges and, when asked, the company's categories", async () => {
    server.answers.list_categories = [{ id: "power", name: "חשמל", kind: "expense", hidden: false, is_default: true, loan_part: null, excluded_from_pnl: false }];
    renderWithProviders(<Probe withCategories />, { route: "/", client: pageClient() });
    await waitFor(() => { expect(latest?.pending).toBe(false); });
    expect(latest?.history?.categories.map((category) => category.id)).toEqual(["repairs", "power", null]);
    expect(latest?.charges.map((charge) => [charge.category_id, charge.typical_amount_minor, charge.pace])).toEqual([["power", 9_500n, "month"]]);
    expect(latest?.categories.map((category) => category.id)).toEqual(["power"]);
    expect(server.calls.map((call) => call.name).sort()).toEqual(["list_categories", "project_forecast"]);
  });

  it("a read with no forecast (no company, another company's project) is no forecast, not a failure", async () => {
    server.answers.project_forecast = null;
    renderWithProviders(<Probe />, { route: "/", client: pageClient() });
    await waitFor(() => { expect(latest?.pending).toBe(false); });
    expect(latest?.forecast).toBeNull();
    expect(latest?.failed).toBe(false);
  });

  it("shows the usual failed state when the read fails, and its retry reads again", async () => {
    server.reply = () => ({ data: null, error: { message: "boom" } });
    renderWithProviders(<Probe />, { route: "/", client: pageClient() });
    await waitFor(() => { expect(latest?.failed).toBe(true); });
    expect(latest?.forecast).toBeNull();
    expect(latest?.pending).toBe(false);
    server.reply = null;
    act(() => { latest?.refetch(); });
    await waitFor(() => { expect(latest?.forecast).not.toBeNull(); });
    expect(latest?.failed).toBe(false);
    expect(calls("project_forecast")).toHaveLength(2);
  });

  it("an answer with an amount outside 2^53 - 1 fails the read instead of drawing a rounded figure", async () => {
    server.answers.project_forecast = { ...sampleProjectForecastAnswer(), income_minor: 2 ** 53 };
    renderWithProviders(<Probe />, { route: "/", client: pageClient() });
    await waitFor(() => { expect(latest?.failed).toBe(true); });
    expect(latest?.forecast).toBeNull();
  });

  it("a sample (a story, the dev fixture) is built from its reads with the builders, and sends no request", () => {
    function Sampled() {
      latest = useProjectNextMonth("juniper-ct", "USD", JUNIPER_NEXT);
      return null;
    }
    renderWithProviders(<Sampled />, { route: "/", client: pageClient() });
    expect(latest?.forecast?.rows.length).toBeGreaterThan(0);
    expect(latest?.income).not.toBeNull();
    expect(latest?.pending).toBe(false);
    expect(server.calls).toEqual([]);
  });
});
