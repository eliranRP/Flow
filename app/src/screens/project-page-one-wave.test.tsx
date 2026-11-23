import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { israelToday } from "../ui/date-math";
import { ToastProvider } from "../ui/toast";
import { ProjectDetailScreen } from "./flow-screens";

type Reply = { data: unknown; error: { message: string } | null };

const server = vi.hoisted(() => ({
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  tables: [] as string[],
  /** FLOW-1270: no read answers, so a read that waits for another's answer never starts. */
  answer: false,
  project: {
    id: "a", name: "וילה רעננה", status: "active", state_label: "פעיל", budget_agorot: null, is_overhead: false,
    income_agorot: 20_000_000, direct_agorot: 10_000_000, shared_agorot: 0, profit_agorot: 10_000_000, categories: [], transactions: [],
    loans: [],
  },
}));

function cashMonths() {
  return {
    basis: "paid", base_currency: "ILS",
    months: [{ month: `${israelToday().slice(0, 7)}-01`, by_currency: [{ currency: "ILS", in_minor: 20_000_000, out_minor: 10_000_000, net_minor: 10_000_000, profit_minor: 10_000_000, excluded_count: 0, excluded_in_minor: 0, excluded_out_minor: 0, not_in_profit_categories: [] }] }],
  };
}

const lineRow = {
  transaction_id: "t1", part: null, description: "חשבונית קבלן", supplier_name: "קבלן א", project_name: null, category_name: null,
  doc_date: `${israelToday().slice(0, 7)}-03`, cash_month_date: `${israelToday().slice(0, 7)}-01`, currency: "ILS", amount_minor: 10_000_000, side: "out",
};

function rpc(name: string, args: Record<string, unknown>): Promise<Reply> {
  server.rpcCalls.push({ name, args });
  if (!server.answer) return new Promise(() => undefined);
  const data = name === "get_project" ? server.project
    : name === "project_cash_months" ? cashMonths()
      : name === "mcp_company_loan_currency" ? "ILS"
        : name === "project_cash_month_lines" ? { rows: args.p_side === "in_profit" ? [lineRow] : [], has_more: false }
          : null;
  return Promise.resolve({ data, error: null });
}

vi.mock("../lib/supabase", () => {
  const table = (name: string) => {
    server.tables.push(name);
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "limit", "order", "in"]) chain[method] = () => chain;
    const data = name === "companies" ? { overhead_project_id: null, overhead: null } : [];
    chain.maybeSingle = () => (server.answer ? Promise.resolve({ data, error: null }) : new Promise<Reply>(() => undefined));
    chain.then = (resolve: (reply: Reply) => unknown) => (server.answer ? resolve({ data, error: null }) : undefined);
    return chain;
  };
  return { getSupabase: () => ({ from: table, rpc: (name: string, args: Record<string, unknown> = {}) => rpc(name, args) }) };
});

function renderLive() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, ...render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/projects/a"]}>
          <Routes><Route path="/projects/:projectId" element={<ProjectDetailScreen />} /></Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  ) };
}

afterEach(() => {
  server.rpcCalls.length = 0;
  server.tables.length = 0;
  server.answer = false;
});

const names = () => server.rpcCalls.map((call) => call.name);
const month = israelToday().slice(0, 7);

describe("the project page's first view in one wave (FLOW-1270)", () => {
  it("starts every first-view read at mount, with no read answered", async () => {
    renderLive();
    // Nothing has answered: not get_project, not project_cash_months, not the company's currency.
    await vi.waitFor(() => {
      expect(server.rpcCalls.filter((call) => call.name === "get_project")).toHaveLength(2);
      for (const name of [
        "project_cash_months", "project_recurring_changes", "projects_cash_month",
        "list_utility_payers", "forecast_overrides_for",
      ]) expect(names()).toContain(name);
      expect(server.rpcCalls.filter((call) => call.name === "project_cash_month_lines").map((call) => call.args.p_side).sort()).toEqual(["in_profit", "not_in_profit"]);
    });
    // The forecast card's reads stay after the page's figures (decision 0271): none started before get_project answered.
    for (const name of ["expected_months", "project_category_months", "project_forecast_edits_for", "list_categories"]) expect(names()).not.toContain(name);
    expect(server.tables).not.toContain("companies");
    // The month's lines are for the current month, in the company's books currency, which the server fills in.
    for (const call of server.rpcCalls.filter((item) => item.name === "project_cash_month_lines")) {
      expect(call.args).toMatchObject({ p_project: "a", p_month: `${month}-01` });
      expect(call.args).not.toHaveProperty("p_currency");
    }
    // One of each, and the utilities' payers carry only the project id.
    expect(server.rpcCalls.find((call) => call.name === "list_utility_payers")?.args).toEqual({ p_project_id: "a" });
    expect(names().filter((name) => name === "list_utility_payers")).toHaveLength(1);
    // The bills not refunded are asked for only once a utility is the tenant's (the payers' answer).
    expect(names()).not.toContain("list_utility_refunds");
  });

  it("draws the same figures and lines once the reads answer", async () => {
    server.answer = true;
    const { client } = renderLive();
    expect(await screen.findByRole("heading", { name: "וילה רעננה" })).toBeInTheDocument();
    // A money figure: the project's profit (10,000,000 agorot) in the band and the cash overview.
    expect((await screen.findAllByText("₪100,000")).length).toBeGreaterThan(0);
    // The forecast's reads start once the project's own read has landed.
    await vi.waitFor(() => { for (const name of ["expected_months", "project_category_months", "project_forecast_edits_for", "list_categories"]) expect(names()).toContain(name); });
    expect(await screen.findByText("קבלן א")).toBeInTheDocument();
    // The lines were read once for the cash read's own month: the answer's month matches the one asked for at mount.
    // Cold (no saved company currency) the read starts with the currency still null; when the currency lands the key
    // is the books currency's and the lines are read once more under it: two reads of each side, no more.
    // Once the currency is known the read sits under the key the month's profit page reads (project-month-profit-screen.tsx):
    // going there reuses these lines.
    await vi.waitFor(() => {
      expect(client.getQueryCache().find({ queryKey: ["breakdown-lines", "project-cash-month", "off", "a", month, "ILS"] })?.state.data).toBeDefined();
    });
    expect(names().filter((name) => name === "project_cash_month_lines")).toHaveLength(4);
  });
});
