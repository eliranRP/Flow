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
  project: {
    id: "a", name: "וילה רעננה", status: "active", state_label: "פעיל", budget_agorot: null, is_overhead: false,
    income_agorot: 20_000_000, direct_agorot: 10_000_000, shared_agorot: 0, profit_agorot: 10_000_000, categories: [], transactions: [],
  },
}));

const cashMonths = {
  basis: "paid", base_currency: "ILS",
  months: [{ month: "2026-10-01", by_currency: [{ currency: "ILS", in_minor: 20_000_000, out_minor: 10_000_000, net_minor: 10_000_000, profit_minor: 10_000_000, excluded_count: 0, excluded_in_minor: 0, excluded_out_minor: 0, not_in_profit_categories: [] }] }],
};

function rpc(name: string, args: Record<string, unknown>): Promise<Reply> {
  server.rpcCalls.push({ name, args });
  if (name === "get_project" && args.p_from == null) {
    return new Promise((resolve) => { server.releaseLifetime = () => { resolve({ data: server.project, error: null }); }; });
  }
  const data = name === "get_project" ? server.project : name === "project_cash_months" ? cashMonths : null;
  return Promise.resolve({ data, error: null });
}

vi.mock("../lib/supabase", () => {
  const table = (name: string) => {
    server.tables.push(name);
    const overhead = server.project.is_overhead ? { overhead_project_id: "a", overhead: { id: "a", name: server.project.name } } : { overhead_project_id: null, overhead: null };
    const data = name === "companies" ? overhead : [];
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "limit", "order", "in"]) chain[method] = () => chain;
    chain.maybeSingle = () => Promise.resolve({ data, error: null });
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

const FORECAST_RPCS = ["expected_months", "project_category_months", "project_forecast_edits_for", "forecast_overrides_for"];

afterEach(() => {
  server.rpcCalls.length = 0;
  server.tables.length = 0;
});

describe("the project page's forecast reads (FLOW-1229)", () => {
  it("start once the project's own read has landed, without waiting for the lifetime read or the company read", async () => {
    renderLive();
    expect(await screen.findByRole("heading", { name: "וילה רעננה" })).toBeInTheDocument();
    // The lifetime read (every period) is still out, and the forecast's reads have gone out all the same.
    await vi.waitFor(() => {
      const names = server.rpcCalls.map((call) => call.name);
      for (const name of FORECAST_RPCS) expect(names).toContain(name);
      expect(server.tables).toContain("loans");
    });
    // The company read runs beside them, not before them.
    expect(server.tables).toContain("companies");
    await act(async () => { server.releaseLifetime(); await Promise.resolve(); });
  });

  it("keeps the project's own forecast reads off for the overhead project, whose forecast is the company's", async () => {
    server.project.is_overhead = true;
    try {
      renderLive();
      expect(await screen.findByRole("heading", { name: "וילה רעננה" })).toBeInTheDocument();
      await vi.waitFor(() => { expect(server.tables).toContain("companies"); });
      expect(server.rpcCalls.map((call) => call.name)).not.toContain("expected_months");
    } finally {
      server.project.is_overhead = false;
    }
  });
});
