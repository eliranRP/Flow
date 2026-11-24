import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../ui/toast";
import { ProjectDetailScreen } from "./flow-screens";

type Reply = { data: unknown; error: { message: string } | null };

const server = vi.hoisted(() => ({
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  tables: [] as string[],
  /** The lifetime read (no period) stays out until a test lets it go. */
  releaseLifetime: (): void => undefined,
  /** FLOW-1230: the lifetime read answers at once, and the page's own (period) read stays out until a test lets it go. */
  holdPeriod: false,
  releasePeriod: (): void => undefined,
  /** The company read (/companies) stays out until a test lets it go. */
  holdCompanies: false,
  releaseCompanies: (): void => undefined,
  project: {
    id: "a", name: "וילה רעננה", status: "active", state_label: "פעיל", budget_agorot: null, is_overhead: false,
    income_agorot: 20_000_000, direct_agorot: 10_000_000, shared_agorot: 0, profit_agorot: 10_000_000, categories: [], transactions: [],
    // FLOW-1240: the project has no loans; the forecast takes them from this answer.
    loans: [],
  },
}));

const cashMonths = {
  basis: "paid", base_currency: "ILS",
  months: [{ month: "2026-10-01", by_currency: [{ currency: "ILS", in_minor: 20_000_000, out_minor: 10_000_000, net_minor: 10_000_000, profit_minor: 10_000_000, excluded_count: 0, excluded_in_minor: 0, excluded_out_minor: 0, not_in_profit_categories: [] }] }],
};

function rpc(name: string, args: Record<string, unknown>): Promise<Reply> {
  server.rpcCalls.push({ name, args });
  if (name === "get_project" && args.p_from != null && server.holdPeriod) {
    return new Promise((resolve) => { server.releasePeriod = () => { resolve({ data: server.project, error: null }); }; });
  }
  if (name === "get_project" && args.p_from == null && !server.holdPeriod) {
    return new Promise((resolve) => { server.releaseLifetime = () => { resolve({ data: server.project, error: null }); }; });
  }
  const data = name === "get_project" ? server.project : name === "project_cash_months" ? cashMonths : name === "mcp_company_loan_currency" ? "ILS" : null;
  return Promise.resolve({ data, error: null });
}

vi.mock("../lib/supabase", () => {
  const table = (name: string) => {
    server.tables.push(name);
    const overhead = server.project.is_overhead ? { overhead_project_id: "a", overhead: { id: "a", name: server.project.name } } : { overhead_project_id: null, overhead: null };
    const data = name === "companies" ? overhead : [];
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "limit", "order", "in"]) chain[method] = () => chain;
    chain.maybeSingle = () => (name === "companies" && server.holdCompanies
      ? new Promise<Reply>((resolve) => { server.releaseCompanies = () => { resolve({ data, error: null }); }; })
      : Promise.resolve({ data, error: null }));
    chain.then = (resolve: (reply: Reply) => unknown) => resolve({ data, error: null });
    return chain;
  };
  return { getSupabase: () => ({ from: table, rpc: (name: string, args: Record<string, unknown> = {}) => rpc(name, args) }) };
});

function renderLive() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/projects/a"]}>
          <Routes><Route path="/projects/:projectId" element={<ProjectDetailScreen />} /></Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

// FLOW-1315: the card's forecast is one read. None of the six reads it made before is sent.
const FORECAST_RPCS = ["project_forecast"];
const OLD_FORECAST_RPCS = ["expected_months", "project_category_months", "project_forecast_edits_for", "company_next_month_inputs"];
afterEach(() => {
  server.rpcCalls.length = 0;
  server.tables.length = 0;
  server.holdCompanies = false;
  server.holdPeriod = false;
  server.project.is_overhead = false;
});

const names = () => server.rpcCalls.map((call) => call.name);
/** FLOW-1240: the forecast's loans come from get_project, so neither loans table is ever read on the project path. */
const loanTablesRead = () => server.tables.filter((name) => name === "loans" || name === "loan_balances");

describe("the project page's forecast reads (FLOW-1229)", () => {
  it("start once the project's own read has landed, without waiting for the lifetime read or the company read", async () => {
    // Both reads stay out: the lifetime get_project and /companies.
    server.holdCompanies = true;
    renderLive();
    expect(await screen.findByRole("heading", { name: "וילה רעננה" })).toBeInTheDocument();
    await vi.waitFor(() => {
      for (const name of FORECAST_RPCS) expect(names()).toContain(name);
    });
    for (const name of OLD_FORECAST_RPCS) expect(names()).not.toContain(name);
    expect(names().filter((name) => name === "project_forecast")).toHaveLength(1);
    // While the lifetime read is pending the row shows its loading bar and no figure.
    const row = screen.getByRole("link", { name: /^צפוי לחודש הבא/ });
    expect(row.querySelector(".ui-skeleton-w-sm")).not.toBeNull();
    expect(row.querySelector(".ui-project-row-figure")).toBeNull();
    expect(loanTablesRead()).toEqual([]);
    await act(async () => { server.releaseCompanies(); server.releaseLifetime(); await Promise.resolve(); });
  });

  it("keeps the figure out until the lifetime read lands, though the forecast's reads are all in", async () => {
    renderLive();
    expect(await screen.findByRole("heading", { name: "וילה רעננה" })).toBeInTheDocument();
    await vi.waitFor(() => { for (const name of FORECAST_RPCS) expect(names()).toContain(name); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    const row = screen.getByRole("link", { name: /^צפוי לחודש הבא/ });
    expect(row.querySelector(".ui-project-row-figure")).toBeNull();
    expect(row.querySelector(".ui-skeleton-w-sm")).not.toBeNull();
    expect(loanTablesRead()).toEqual([]);
  });

  it("the overhead project starts the same one read: the database builds its general costs, so no company read is waited for", async () => {
    server.project.is_overhead = true;
    server.holdCompanies = true;
    renderLive();
    expect(await screen.findByRole("heading", { name: "וילה רעננה" })).toBeInTheDocument();
    await vi.waitFor(() => { expect(names()).toContain("project_forecast"); });
    for (const name of OLD_FORECAST_RPCS) expect(names()).not.toContain(name);
    expect(server.rpcCalls.find((call) => call.name === "project_forecast")?.args).toMatchObject({ p_project: "a" });
    // Still loading: nothing is drawn from the hint.
    const row = screen.getByRole("link", { name: /^צפוי לחודש הבא/ });
    expect(row.querySelector(".ui-project-row-figure")).toBeNull();
    await act(async () => { server.releaseCompanies(); server.releaseLifetime(); await Promise.resolve(); });
  });

  it("start when the lifetime read lands first, with the page's own read still out (FLOW-1230)", async () => {
    // The same get_project answered twice: whichever lands first starts the reads.
    server.holdPeriod = true;
    renderLive();
    await vi.waitFor(() => {
      for (const name of FORECAST_RPCS) expect(names()).toContain(name);
    });
    // The page itself still waits for its own read: nothing of the project is drawn yet.
    expect(screen.queryByRole("heading", { name: "וילה רעננה" })).not.toBeInTheDocument();
    await act(async () => { server.releasePeriod(); await Promise.resolve(); });
    expect(await screen.findByRole("heading", { name: "וילה רעננה" })).toBeInTheDocument();
  });

  it("the overhead project, lifetime read first: the same one read starts (FLOW-1230, FLOW-1315)", async () => {
    server.project.is_overhead = true;
    server.holdPeriod = true;
    server.holdCompanies = true;
    renderLive();
    await vi.waitFor(() => { expect(names()).toContain("project_forecast"); });
    for (const name of OLD_FORECAST_RPCS) expect(names()).not.toContain(name);
    await act(async () => { server.releaseCompanies(); server.releasePeriod(); await Promise.resolve(); });
  });
});
