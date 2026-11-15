import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { QUERY_STALE_MS } from "../query-client";
import { renderWithProviders } from "../test-render";
import { CompanyProfitScreen } from "./company-profit-screen";

// FLOW-1194: the by-category order reads a category's lines when its row scrolls near (or on a tap), once; the search
// field asks the server. FLOW-1207: the date and amount orders read a direction's every line in one paged read (no group
// key, pages of 200), where they read each category's lines before (pages of 40). Invented data only.
type Calls = { rpc: Array<{ name: string; args: Record<string, unknown> | undefined }>; lines: Record<string, unknown>; search: unknown; failing: string[]; disconnects: number; income: boolean; inFlight: number; maxInFlight: number };
const calls = vi.hoisted((): Calls => ({ rpc: [], lines: {}, search: null, failing: [], disconnects: 0, income: false, inFlight: 0, maxInFlight: 0 }));

vi.mock("../ui/date-math", async (importOriginal) => ({ ...(await importOriginal<typeof import("../ui/date-math")>()), israelToday: () => "2026-10-20" }));
vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: Record<string, unknown>) => {
      calls.rpc.push({ name, args });
      if (name === "get_breakdown_lines" && calls.failing.includes(String(args?.p_group_key))) return Promise.resolve({ data: null, error: new Error("down") });
      if (name === "get_breakdown_lines" && args?.p_group_key === null) {
        // The one-direction read is slow enough for two pages asked together to overlap.
        calls.inFlight += 1;
        calls.maxInFlight = Math.max(calls.maxInFlight, calls.inFlight);
        return new Promise((resolve) => { setTimeout(() => { calls.inFlight -= 1; resolve({ data: answer(name, args), error: null }); }, 5); });
      }
      return Promise.resolve({ data: answer(name, args), error: null });
    },
    from: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { overhead_project_id: null, overhead: null }, error: null }) }) }),
  }),
}));
vi.mock("../wait-for-session", () => ({ waitForAccessToken: () => Promise.resolve() }));

const SALARY = "00000000-0000-4000-8000-0000000000c1";
const INSURANCE = "00000000-0000-4000-8000-0000000000c2";
const RENT = "00000000-0000-4000-8000-0000000000c3";

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
      ? breakdown("income", calls.income ? [{ key: RENT, name: "שכירות", amount: 70000, count: 1 }] : [])
      : { ...breakdown("expense", [{ key: SALARY, name: "שכר", amount: 30000, count: 1 }, { key: INSURANCE, name: "ביטוח", amount: 20000, count: 1 }]), excluded_groups: [{ currency: "USD", amount_minor: 5000, count: 1, key: "k1", name: "פיקדון", projects: 1, loan_part: null }] };
  }
  if (name === "mcp_company_loan_currency") return "USD";
  if (name === "get_profit_months") {
    const row = { currency: "USD", income_minor: 150000, expense_minor: 120000, profit_minor: 30000 };
    return { basis: "cash", from: "2006-10-01", to: "2026-10-20", by_currency: [row], months: [{ month: "2026-10", from: "2026-10-01", to: "2026-10-20", open: true, by_currency: [row] }] };
  }
  if (name === "get_breakdown_lines" && args?.p_excluded === true) return { rows: [{ ...line("t-kept", "פיקדון לדוגמה"), category_id: "k1" }], has_more: false };
  if (name === "get_breakdown_lines" && args?.p_group_key === null) {
    // The server's one read of the direction: every category's rows, newest first (a tie in the server's own order,
    // here the last category first), each naming its group.
    const keys = args.p_direction === "expense" ? [INSURANCE, SALARY] : [RENT];
    const all = keys.flatMap((key): Array<Record<string, unknown>> => (calls.lines[key] as { rows: Array<Record<string, unknown>> }).rows.map((row) => ({ ...row, group_key: key })))
      .sort((a, b) => String(b.doc_date).localeCompare(String(a.doc_date)));
    const offset = Number(args.p_offset);
    const limit = Number(args.p_limit);
    return { rows: all.slice(offset, offset + limit), has_more: all.length > offset + limit, count: all.length };
  }
  if (name === "get_breakdown_lines") return calls.lines[String(args?.p_group_key)] ?? { rows: [], has_more: false };
  if (name === "search_transactions") return calls.search;
  return null;
}

const lineReads = () => calls.rpc.filter((call) => call.name === "get_breakdown_lines");
const keysRead = () => lineReads().filter((call) => call.args?.p_excluded !== true).map((call) => call.args?.p_group_key);
/** The texts, in the order they sit on the page. */
const textsInOrder = (...texts: string[]) =>
  texts.map((text) => screen.getByText(text)).sort((a, b) => (a.compareDocumentPosition(b) === 4 ? -1 : 1)).map((node) => node.textContent);

/** An IntersectionObserver whose nodes report only when the test says so (`see`). */
const watching: Array<{ target: Element; report: () => void }> = [];
function stubObserver() {
  vi.stubGlobal("IntersectionObserver", class {
    private readonly onSee: IntersectionObserverCallback;
    constructor(onSee: IntersectionObserverCallback) { this.onSee = onSee; }
    observe(target: Element) { watching.push({ target, report: () => { this.onSee([{ isIntersecting: true, target } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver); } }); }
    unobserve() {}
    disconnect() { calls.disconnects += 1; }
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
    [RENT]: { rows: [{ ...line("t-rent", "שכירות לדוגמה"), doc_date: "2026-07-02" }], has_more: false },
  };
  calls.search = { total: 1, expenses: [{ id: "t-found", description: "חשבון מצאנו", doc_date: "2026-07-12", amount_net: -12345, direction: "expense", currency: "USD", project_id: null, category_id: INSURANCE, project_name: null, category_name: "ביטוח", supplier_name: "ספק לדוגמה", customer_name: null, waiting_review: false, kept_out: false, split_parts: 0, loan_matched: false }] };
  calls.failing = [];
  calls.income = false;
  calls.inFlight = 0;
  calls.maxInFlight = 0;
  calls.disconnects = 0;
  watching.length = 0;
  stubObserver();
});

afterEach(() => { vi.unstubAllGlobals(); });

async function enterCategories() {
  const view = renderWithProviders(<CompanyProfitScreen />, { route: "/profit?month=2026-07&by=category" });
  await screen.findByText("שכר");
  return view;
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

describe("CompanyProfitScreen, the date and amount orders read every line in one call (FLOW-1207)", () => {
  // Before: one read per counted category (here 2: p_group_key SALARY and INSURANCE, p_limit 40 each). After: one per
  // direction with a counted category (here 1: the expense direction, p_group_key null, p_limit 200).
  it("the date order sends one paged read, with no group key, instead of one per category, and no kept-out read", async () => {
    renderWithProviders(<CompanyProfitScreen />, { route: "/profit?month=2026-07&by=date" });
    expect(await screen.findByText("משכורת לדוגמה")).toBeInTheDocument();
    expect(await screen.findByText("פוליסה לדוגמה")).toBeInTheDocument();
    expect(lineReads()).toHaveLength(1);
    expect(lineReads()[0]?.args).toMatchObject({ p_direction: "expense", p_group_by: "category", p_group_key: null, p_currency: "USD", p_excluded: false, p_limit: 200, p_offset: 0, p_from: "2026-07-01", p_to: "2026-07-31" });
  });

  it("the amount order sends the same one read", async () => {
    renderWithProviders(<CompanyProfitScreen />, { route: "/profit?month=2026-07&by=amount" });
    expect(await screen.findByText("משכורת לדוגמה")).toBeInTheDocument();
    expect(lineReads()).toHaveLength(1);
    expect(lineReads()[0]?.args).toMatchObject({ p_group_key: null, p_limit: 200 });
  });

  it("two lines of one day and one size keep the category order, whatever order the server gave them", async () => {
    renderWithProviders(<CompanyProfitScreen />, { route: "/profit?month=2026-07&by=date" });
    await screen.findByText("פוליסה לדוגמה");
    // SALARY is listed before INSURANCE (the breakdown's order); the server answered INSURANCE first.
    expect(textsInOrder("משכורת לדוגמה", "פוליסה לדוגמה")).toEqual(["משכורת לדוגמה", "פוליסה לדוגמה"]);
  });

  const manyLines = (count: number) => Array.from({ length: count }, (_, index) => ({ ...line(`t-s${String(index)}`, `משכורת ${String(index)}`), doc_date: "2026-07-05" }));

  it("a direction with more lines than a page reads the next page, and shows every line", async () => {
    calls.lines[SALARY] = { rows: manyLines(201), has_more: false };
    renderWithProviders(<CompanyProfitScreen />, { route: "/profit?month=2026-07&by=date" });
    expect(await screen.findByText("משכורת 200")).toBeInTheDocument();
    expect(lineReads().map((call) => [call.args?.p_offset, call.args?.p_limit])).toEqual([[0, 200], [200, 200]]);
    expect(screen.getByText("פוליסה לדוגמה")).toBeInTheDocument();
  });

  it("401 lines are 3 reads (offsets 0, 200, 400): the first says how many follow, and those are asked together", async () => {
    calls.lines[SALARY] = { rows: manyLines(400), has_more: false };
    renderWithProviders(<CompanyProfitScreen />, { route: "/profit?month=2026-07&by=date" });
    expect(await screen.findByText("משכורת 399")).toBeInTheDocument();
    expect(lineReads().map((call) => call.args?.p_offset).sort()).toEqual([0, 200, 400]);
    expect(calls.maxInFlight).toBe(2);
    expect(screen.getByText("פוליסה לדוגמה")).toBeInTheDocument();
  });

  it("income and expense are one read each, and both directions' lines show", async () => {
    calls.income = true;
    renderWithProviders(<CompanyProfitScreen />, { route: "/profit?month=2026-07&by=date" });
    expect(await screen.findByText("שכירות לדוגמה")).toBeInTheDocument();
    expect(await screen.findByText("פוליסה לדוגמה")).toBeInTheDocument();
    expect(lineReads().map((call) => call.args?.p_direction).sort()).toEqual(["expense", "income"]);
    expect(lineReads().every((call) => call.args?.p_group_key === null)).toBe(true);
  });

  it("a failed read keeps the month's figures, shows the list's own failure line, and the retry brings the lines", async () => {
    calls.failing = ["null"];
    renderWithProviders(<CompanyProfitScreen />, { route: "/profit?month=2026-07&by=date" });
    expect(await screen.findByText("לא הצלחנו לטעון את התנועות.")).toBeInTheDocument();
    // The page stays: its title and order chips are drawn, and the page failure is not.
    expect(screen.getByRole("radio", { name: "לפי קטגוריה" })).toBeInTheDocument();
    expect(screen.queryByText(/לא נטען/)).toBeNull();
    calls.failing = [];
    fireEvent.click(screen.getByRole("button", { name: "נסו שוב" }));
    expect(await screen.findByText("פוליסה לדוגמה")).toBeInTheDocument();
    expect(screen.queryByText("לא הצלחנו לטעון את התנועות.")).toBeNull();
    expect(lineReads().map((call) => call.args?.p_group_key)).toEqual([null, null]);
  });

  it("while the one read is in flight the list shows the loading row", async () => {
    renderWithProviders(<CompanyProfitScreen />, { route: "/profit?month=2026-07&by=date" });
    await screen.findByRole("radio", { name: "לפי קטגוריה" });
    expect(screen.getAllByRole("status").some((node) => node.textContent === "טוען…")).toBe(true);
    expect(await screen.findByText("פוליסה לדוגמה")).toBeInTheDocument();
    expect(screen.queryAllByRole("status").some((node) => node.textContent === "טוען…")).toBe(false);
  });

  it("a seeded category's rows equal what the keyed read returns, field for field and in order", async () => {
    calls.lines[INSURANCE] = { rows: [{ ...line("t-i1", "ראשון"), doc_date: "2026-07-09" }, { ...line("t-i2", "שני"), doc_date: "2026-07-03", amount_minor: 5 }], has_more: false };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: QUERY_STALE_MS } } });
    renderWithProviders(<CompanyProfitScreen />, { route: "/profit?month=2026-07&by=date", client });
    await screen.findByText("ראשון");
    const seeded = client.getQueriesData<unknown[]>({ queryKey: ["breakdown-lines", "company-profit"] }).find(([key]) => key.includes(INSURANCE))?.[1];
    // The keyed read of the same category, in its own cache.
    cleanup();
    const keyed = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: QUERY_STALE_MS } } });
    renderWithProviders(<CompanyProfitScreen />, { route: "/profit?month=2026-07&by=category", client: keyed });
    fireEvent.click(await screen.findByRole("button", { name: /ביטוח/ }));
    await screen.findByText("ראשון");
    const read = keyed.getQueriesData<unknown[]>({ queryKey: ["breakdown-lines", "company-profit"] }).find(([key]) => key.includes(INSURANCE))?.[1];
    expect(seeded).toHaveLength(2);
    expect(seeded).toEqual(read);
  });

  it("the category order after the date order shows those lines at once, with no new read", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: QUERY_STALE_MS } } });
    renderWithProviders(<CompanyProfitScreen />, { route: "/profit?month=2026-07&by=date", client });
    await screen.findByText("פוליסה לדוגמה");
    expect(lineReads()).toHaveLength(1);
    fireEvent.click(screen.getByRole("radio", { name: "לפי קטגוריה" }));
    fireEvent.click(await screen.findByRole("button", { name: /ביטוח/ }));
    expect(await screen.findByText("פוליסה לדוגמה")).toBeInTheDocument();
    expect(screen.queryAllByRole("status").some((node) => node.textContent === "טוען…")).toBe(false);
    expect(lineReads()).toHaveLength(1);
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

describe("CompanyProfitScreen, more on lines and search (FLOW-1194)", () => {
  it("a failed category read shows a line with a retry, and the retry reads that category again", async () => {
    calls.failing = [INSURANCE];
    await enterCategories();
    fireEvent.click(screen.getByRole("button", { name: /ביטוח/ }));
    expect(await screen.findByText("לא הצלחנו לטעון את התנועות.")).toBeInTheDocument();
    calls.failing = [];
    fireEvent.click(screen.getByRole("button", { name: "נסו שוב" }));
    expect(await screen.findByText("פוליסה לדוגמה")).toBeInTheDocument();
    expect(keysRead()).toEqual([INSURANCE, INSURANCE]);
  });

  it("a kept-out category reads its direction's kept-out lines once, on a tap", async () => {
    await enterCategories();
    expect(lineReads()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /פיקדון/ }));
    expect(await screen.findByText("פיקדון לדוגמה")).toBeInTheDocument();
    expect(lineReads().map((call) => call.args?.p_excluded)).toEqual([true]);
  });

  it("clearing the search brings the category list back", async () => {
    await enterCategories();
    fireEvent.change(screen.getByRole("searchbox", { name: "חיפוש בתנועות" }), { target: { value: "מצאנו" } });
    expect(await screen.findByText("ספק לדוגמה")).toBeInTheDocument();
    expect(screen.queryByText("שכר")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "ניקוי" }));
    expect(await screen.findByText("שכר")).toBeInTheDocument();
    expect(screen.queryByText("ספק לדוגמה")).toBeNull();
  });

  it("a search with no match says so, with a way to clear it", async () => {
    calls.search = { total: 0, expenses: [] };
    await enterCategories();
    fireEvent.change(screen.getByRole("searchbox", { name: "חיפוש בתנועות" }), { target: { value: "אאא" } });
    expect(await screen.findByText("לא מצאנו ״אאא״")).toBeInTheDocument();
    // A screen reader hears the empty result: it sits in a live region.
    expect(screen.getByText("לא מצאנו ״אאא״").closest("[role=status]")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "ניקוי החיפוש" }));
    expect(await screen.findByText("שכר")).toBeInTheDocument();
  });

  it("a typed amount reads twice, not three times: the overlap read only corrects the total and months, which this page does not draw", async () => {
    await enterCategories();
    fireEvent.change(screen.getByRole("searchbox", { name: "חיפוש בתנועות" }), { target: { value: "8940" } });
    expect(await screen.findByText("ספק לדוגמה")).toBeInTheDocument();
    const reads = calls.rpc.filter((call) => call.name === "search_transactions");
    expect(reads.map((call) => call.args)).toEqual([
      expect.objectContaining({ p_query: "8940" }),
      expect.objectContaining({ p_amount_min: 894000, p_amount_max: 894099 }),
    ]);
  });

  it("the search's live region is on the page while the search is still loading", async () => {
    calls.search = new Promise(() => undefined);
    await enterCategories();
    fireEvent.change(screen.getByRole("searchbox", { name: "חיפוש בתנועות" }), { target: { value: "אאא" } });
    await waitFor(() => { expect(calls.rpc.some((call) => call.name === "search_transactions")).toBe(true); });
    expect(document.querySelector(".ui-cp-found-status[role=status]")).not.toBeNull();
    expect(screen.queryByText("לא מצאנו ״אאא״")).toBeNull();
  });

  it("the search is for the month view: the year view has no field and keeps its own list", async () => {
    await enterCategories();
    fireEvent.change(screen.getByRole("searchbox", { name: "חיפוש בתנועות" }), { target: { value: "מצאנו" } });
    expect(await screen.findByText("ספק לדוגמה")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "2026" }));
    await waitFor(() => { expect(screen.queryByRole("searchbox", { name: "חיפוש בתנועות" })).toBeNull(); });
    expect(screen.queryByText("ספק לדוגמה")).toBeNull();
    await waitFor(() => { expect(document.querySelector(".ui-cp-period-list, .ui-cp-list, .ui-lines-group")).not.toBeNull(); });
  });

  it("every row's observer is disconnected when the page goes", async () => {
    const view = await enterCategories();
    const rows = watching.filter((item) => item.target.classList.contains("ui-pcat")).length;
    expect(rows).toBeGreaterThan(0);
    const before = calls.disconnects;
    view.unmount();
    expect(calls.disconnects - before).toBeGreaterThanOrEqual(rows);
  });
});
