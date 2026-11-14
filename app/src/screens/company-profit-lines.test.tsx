import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test-render";
import { CompanyProfitScreen } from "./company-profit-screen";

// FLOW-1194: the by-category order reads a category's lines when its row scrolls near (or on a tap), once; the date and
// amount orders read them all in big pages; the search field asks the server. Invented data only.
type Calls = { rpc: Array<{ name: string; args: Record<string, unknown> | undefined }>; lines: Record<string, unknown>; search: unknown };
const calls = vi.hoisted((): Calls => ({ rpc: [], lines: {}, search: null }));

vi.mock("../ui/date-math", async (importOriginal) => ({ ...(await importOriginal<typeof import("../ui/date-math")>()), israelToday: () => "2026-10-20" }));
vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: Record<string, unknown>) => {
      calls.rpc.push({ name, args });
      return Promise.resolve({ data: answer(name, args), error: null });
    },
    from: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { overhead_project_id: null, overhead: null }, error: null }) }) }),
  }),
}));
vi.mock("../wait-for-session", () => ({ waitForAccessToken: () => Promise.resolve() }));

const SALARY = "00000000-0000-4000-8000-0000000000c1";
const INSURANCE = "00000000-0000-4000-8000-0000000000c2";

function breakdown(direction: "income" | "expense", groups: Array<{ key: string; name: string; amount: number; count: number }>) {
  return {
    direction, basis: "cash", group_by: "category", from: "2026-07-01", to: "2026-07-31",
    totals: [], excluded: [], review_count: 0,
    groups: groups.map((group) => ({ currency: "USD", amount_minor: group.amount, count: group.count, key: group.key, name: group.name, shared: false, projects: 1 })),
  };
}

function line(id: string, description: string) {
  return { transaction_id: id, part: null, description, supplier_name: null, project_name: "בית הדקל", category_name: null, doc_date: "2026-07-10", currency: "USD", amount_minor: 20000, shared: false };
}

function answer(name: string, args: Record<string, unknown> | undefined): unknown {
  if (name === "get_dashboard") {
    return {
      company_id: null, name: null, vat_registered: false, basis: "cash", from: "2026-07-01", to: "2026-07-31",
      income_agorot: 0, direct_agorot: 0, shared_agorot: 0, overhead_agorot: 0, expense_agorot: 0, net_profit_agorot: 0,
      prev_income_agorot: null, prev_expense_agorot: null, prev_net_agorot: null, active_projects: 0, review_count: 0, projects: [],
      by_currency: [{ currency: "USD", income_minor: 0, direct_minor: 0, shared_minor: 0, overhead_minor: 0, expense_minor: 50000, net_profit_minor: -50000, count: 2 }], base_currency: "USD",
    };
  }
  if (name === "get_breakdown") {
    if (args?.p_group_by === "project") return breakdown(args.p_direction === "income" ? "income" : "expense", []);
    return args?.p_direction === "income"
      ? breakdown("income", [])
      : { ...breakdown("expense", [{ key: SALARY, name: "שכר", amount: 30000, count: 1 }, { key: INSURANCE, name: "ביטוח", amount: 20000, count: 1 }]), excluded_groups: [{ currency: "USD", amount_minor: 5000, count: 1, key: "k1", name: "פיקדון", projects: 1, loan_part: null }] };
  }
  if (name === "mcp_company_loan_currency") return "USD";
  if (name === "get_breakdown_lines") return calls.lines[String(args?.p_group_key)] ?? { rows: [], has_more: false };
  if (name === "search_transactions") return calls.search;
  return null;
}

const lineReads = () => calls.rpc.filter((call) => call.name === "get_breakdown_lines");
const keysRead = () => lineReads().filter((call) => call.args?.p_excluded !== true).map((call) => call.args?.p_group_key);

/** An IntersectionObserver whose nodes report only when the test says so (`see`). */
const watching: Array<{ target: Element; report: () => void }> = [];
function stubObserver() {
  vi.stubGlobal("IntersectionObserver", class {
    private readonly onSee: IntersectionObserverCallback;
    constructor(onSee: IntersectionObserverCallback) { this.onSee = onSee; }
    observe(target: Element) { watching.push({ target, report: () => { this.onSee([{ isIntersecting: true, target } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver); } }); }
    unobserve() {}
    disconnect() {}
  });
}

/** The category row (its box) a test scrolls into view. */
function see(name: string) {
  const entry = watching.find((item) => item.target.classList.contains("ui-pcat") && item.target.textContent.includes(name));
  if (entry == null) throw new Error(`no row ${name}`);
  act(() => { entry.report(); });
}

beforeEach(() => {
  calls.rpc = [];
  calls.lines = {
    [SALARY]: { rows: [line("t-salary", "משכורת לדוגמה")], has_more: false },
    [INSURANCE]: { rows: [line("t-insurance", "פוליסה לדוגמה")], has_more: false },
  };
  calls.search = { total: 1, expenses: [{ id: "t-found", description: "חשבון מצאנו", doc_date: "2026-07-12", amount_net: -12345, direction: "expense", currency: "USD", project_id: null, category_id: INSURANCE, project_name: null, category_name: "ביטוח", supplier_name: "ספק לדוגמה", customer_name: null, waiting_review: false, kept_out: false, split_parts: 0, loan_matched: false }] };
  watching.length = 0;
  stubObserver();
});

afterEach(() => { vi.unstubAllGlobals(); });

async function enterCategories() {
  renderWithProviders(<CompanyProfitScreen />, { route: "/profit?month=2026-07&by=category" });
  await screen.findByText("שכר");
}

describe("CompanyProfitScreen, the by-category order loads lines on scroll (FLOW-1194)", () => {
  it("entering the order reads no lines", async () => {
    await enterCategories();
    expect(calls.rpc.some((call) => call.name === "get_breakdown" && call.args?.p_group_by === "category")).toBe(true);
    expect(lineReads()).toEqual([]);
  });

  it("scrolling one category into view reads its lines once, and only its own", async () => {
    await enterCategories();
    see("שכר");
    await waitFor(() => { expect(keysRead()).toEqual([SALARY]); });
    see("שכר");
    fireEvent.click(screen.getByRole("button", { name: /שכר/ }));
    expect(await screen.findByText("משכורת לדוגמה")).toBeInTheDocument();
    expect(keysRead()).toEqual([SALARY]);
  });

  it("a tap before the row scrolled in reads its lines on the tap, with a loading row", async () => {
    await enterCategories();
    expect(keysRead()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /ביטוח/ }));
    expect(screen.getAllByRole("status").some((node) => node.textContent === "טוען…")).toBe(true);
    expect(await screen.findByText("פוליסה לדוגמה")).toBeInTheDocument();
    expect(keysRead()).toEqual([INSURANCE]);
  });
});

describe("CompanyProfitScreen, the date and amount orders read every category (FLOW-1194)", () => {
  it("the date order reads every counted category without a scroll, once each, and no kept-out lines", async () => {
    renderWithProviders(<CompanyProfitScreen />, { route: "/profit?month=2026-07&by=date" });
    expect(await screen.findByText("משכורת לדוגמה")).toBeInTheDocument();
    expect(await screen.findByText("פוליסה לדוגמה")).toBeInTheDocument();
    expect(keysRead().sort()).toEqual([SALARY, INSURANCE]);
    expect(lineReads().some((call) => call.args?.p_excluded === true)).toBe(false);
  });
});

describe("CompanyProfitScreen, the search asks the server (FLOW-1194)", () => {
  it("finds a line of a category that never loaded, scoped to the month", async () => {
    await enterCategories();
    fireEvent.change(screen.getByRole("searchbox", { name: "חיפוש בתנועות" }), { target: { value: "מצאנו" } });
    expect(await screen.findByText("ספק לדוגמה")).toBeInTheDocument();
    const read = calls.rpc.find((call) => call.name === "search_transactions");
    expect(read?.args).toMatchObject({ p_query: "מצאנו", p_from: "2026-07-01", p_to: "2026-07-31" });
    expect(lineReads()).toEqual([]);
  });
});
