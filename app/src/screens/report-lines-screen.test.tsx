import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test-render";
import { HomeReportsCard } from "./home-reports-card";
import { lineMatches, lineText, linesByMonth, linesByProject, ReportLinesScreen, reportLinesArgs, searchPath, type ReportLinesSample } from "./report-lines-screen";
import { REPORTS_BALANCE, REPORTS_STATEMENT } from "../dev/reports-sample";

const rpc = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: unknown }>,
  impl: (_name: string, _args?: unknown): Promise<{ data: unknown; error: { message: string } | null }> =>
    Promise.resolve({ data: null, error: { message: "down" } }),
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: unknown) => {
      rpc.calls.push({ name, args });
      return rpc.impl(name, args);
    },
  }),
}));

beforeEach(() => {
  rpc.calls = [];
  rpc.impl = () => Promise.resolve({ data: null, error: { message: "down" } });
});

function line(id: string, date: string, dollars: number, project: string | null, supplier = "Northside Hardware") {
  return {
    transaction_id: `b0000000-0000-4000-8000-00000000${id}`,
    part: null,
    description: supplier,
    supplier_name: supplier,
    project_name: project,
    category_name: "תיקונים ותחזוקה",
    doc_date: date,
    currency: "USD",
    amount_minor: BigInt(dollars * 100),
    shared: false,
  };
}

const ROWS: ReportLinesSample["rows"] = [
  line("0001", "2026-10-18", 1_250, "Cedar St", "Quick Fix Plumbing"),
  line("0002", "2026-10-09", 400, "Maple Ave"),
  line("0003", "2026-09-22", 980, "Oak Ridge", "Bright Electric"),
  line("0004", "2026-09-11", 200, "Cedar St"),
];

const ROUTE = "/reports/lines?side=expense&category=c-repairs&name=%D7%AA%D7%99%D7%A7%D7%95%D7%A0%D7%99%D7%9D&from=2026-01-01&to=2026-10-31&cur=USD&period=year";

describe("the drill-down's helpers", () => {
  it("reads its choices and falls back on a bad currency", () => {
    const args = reportLinesArgs(new URLSearchParams("side=income&category=c1&cur=usd"));
    expect(args.side).toBe("income");
    expect(args.currency).toBe("ILS");
    expect(reportLinesArgs(new URLSearchParams("")).side).toBe("expense");
  });

  it("groups lines by month, newest first, and totals them by project", () => {
    expect(linesByMonth(ROWS).map((group) => [group.title, group.rows.length])).toEqual([["אוקטובר 2026", 2], ["ספטמבר 2026", 2]]);
    expect(linesByProject(ROWS)).toEqual([
      { name: "Cedar St", total: 145_000n },
      { name: "Oak Ridge", total: 98_000n },
      { name: "Maple Ave", total: 40_000n },
    ]);
  });
});

describe("ReportLinesScreen", () => {
  it("shows the total, the split by project and each line opening its transaction", () => {
    renderWithProviders(<ReportLinesScreen sample={{ rows: ROWS }} />, { route: ROUTE });
    expect(screen.getByRole("heading", { name: "תיקונים" })).toBeInTheDocument();
    expect(document.querySelector(".ui-rep-summary")?.textContent).toContain("−$2,830");
    expect(screen.getByRole("button", { name: /לפי פרויקט/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: /Quick Fix Plumbing/ }).getAttribute("href")).toBe(`/transactions/${ROWS[0]?.transaction_id ?? ""}`);
  });

  it("reads one project's lines by its id, page by page, and names the project", async () => {
    const wire = (row: ReturnType<typeof line>) => ({ ...row, amount_minor: Number(row.amount_minor) });
    rpc.impl = (name) => {
      if (name !== "get_breakdown_lines") return Promise.resolve({ data: null, error: { message: "down" } });
      return Promise.resolve({ data: { rows: [wire(line("0013", "2026-09-30", 700, "Cedar St")), wire(line("0014", "2026-09-29", 200, "Cedar St"))], has_more: true, total_minor: 150_000, count: 5 }, error: null });
    };
    renderWithProviders(<ReportLinesScreen />, { route: `${ROUTE}&scope=project&project=a0000000-0000-4000-8000-000000000161&pname=Cedar+St` });
    // The summary is the whole group's, from the read, not the loaded page's $900.
    await waitFor(() => { expect(document.querySelector(".ui-rep-summary")?.textContent).toContain("−$1,500"); });
    expect(screen.getByText("5 תנועות")).toBeInTheDocument();
    expect(rpc.calls).toHaveLength(1);
    expect(rpc.calls[0]?.args).toMatchObject({ p_project_id: "a0000000-0000-4000-8000-000000000161", p_offset: 0, p_group_key: "c-repairs" });
    expect(screen.getByText(/2026.* · Cedar St$/)).toBeInTheDocument();
    // One project: no split by project, and the next page only on request.
    expect(screen.queryByRole("button", { name: /לפי פרויקט/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "עוד תנועות" }));
    await waitFor(() => { expect(rpc.calls).toHaveLength(2); });
    expect(rpc.calls[1]?.args).toMatchObject({ p_project_id: "a0000000-0000-4000-8000-000000000161", p_offset: 100 });
  });

  it("leaves out the split by project while the summary is the whole group's and pages remain", async () => {
    const wire = (row: ReturnType<typeof line>) => ({ ...row, amount_minor: Number(row.amount_minor) });
    rpc.impl = () => Promise.resolve({ data: { rows: [wire(line("0013", "2026-09-30", 700, "Cedar St")), wire(line("0014", "2026-09-29", 200, "Oak Ridge"))], has_more: true, total_minor: 150_000, count: 5 }, error: null });
    renderWithProviders(<ReportLinesScreen />, { route: ROUTE });
    await waitFor(() => { expect(document.querySelector(".ui-rep-summary")?.textContent).toContain("−$1,500"); });
    expect(screen.queryByRole("button", { name: /לפי פרויקט/ })).toBeNull();
  });

  it("reads the whole company without a project id", async () => {
    rpc.impl = () => Promise.resolve({ data: { rows: [], has_more: false }, error: null });
    renderWithProviders(<ReportLinesScreen />, { route: ROUTE });
    await waitFor(() => { expect(rpc.calls).toHaveLength(1); });
    expect(rpc.calls[0]?.args).not.toHaveProperty("p_project_id");
  });

  it("offers more lines when the read has more", () => {
    renderWithProviders(<ReportLinesScreen sample={{ rows: ROWS, hasMore: true }} />, { route: ROUTE });
    fireEvent.click(screen.getByRole("button", { name: "עוד תנועות" }));
    expect(screen.getByText("4 תנועות ועוד")).toBeInTheDocument();
  });
});

describe("HomeReportsCard", () => {
  it("opens the P&L with this year's net profit and the balance sheet with today's equity", () => {
    renderWithProviders(<HomeReportsCard today="2026-10-31" search="" sample={{ statement: REPORTS_STATEMENT, balance: REPORTS_BALANCE }} />);
    const pnl = screen.getByRole("link", { name: /רווח והפסד/ });
    expect(pnl.getAttribute("href")).toBe("/reports");
    expect(pnl.textContent).toContain("$29,000");
    const balance = screen.getByRole("link", { name: /מאזן/ });
    expect(balance.getAttribute("href")).toBe("/reports?kind=balance");
    expect(balance.textContent).toContain("$285,000");
  });

  it("keeps the preview flag on its links and shows a dash before the reads", () => {
    renderWithProviders(<HomeReportsCard today="2026-10-31" search="?preview=1" sample={{}} />);
    expect(screen.getByRole("link", { name: /מאזן/ }).getAttribute("href")).toBe("/reports?kind=balance&preview=1");
    expect(document.querySelectorAll(".ui-home-rep-figure-empty")).toHaveLength(2);
  });

  it("says when its reads failed, with a retry, and keeps both ways in", async () => {
    renderWithProviders(<HomeReportsCard today="2026-10-31" search="" />);
    expect(await screen.findByRole("button", { name: "נסו שוב" })).toBeInTheDocument();
    expect(screen.getByText("לא הצלחנו לטעון.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /רווח והפסד/ })).toBeInTheDocument();
  });
});

const MANY: ReportLinesSample["rows"] = [
  ...ROWS,
  line("0005", "2026-08-17", 4, "Oak Ridge", "CodeBox"),
  line("0006", "2026-08-12", 41, null, "LOI Properties LLC"),
  line("0007", "2026-08-06", 51, null, "Anytime Mailbox"),
];

describe("the drill-down's search", () => {
  it("matches the supplier, project, date or amount, every word", () => {
    const row = line("0099", "2026-09-05", 1_388, "Cedar St", "Anytime Mailbox");
    expect(lineMatches(row, "")).toBe(true);
    expect(lineMatches(row, "anytime")).toBe(true);
    expect(lineMatches(row, "mailbox cedar")).toBe(true);
    expect(lineMatches(row, "05/09")).toBe(true);
    expect(lineMatches(row, "$1,388")).toBe(true);
    expect(lineMatches(row, "1388.00")).toBe(true);
    expect(lineMatches(row, "mailbox maple")).toBe(false);
    expect(lineMatches(row, "−$1,388")).toBe(true);
    expect(lineMatches(row, "-1388")).toBe(true);
    expect(lineMatches({ ...row, description: "only in the description" }, "description")).toBe(true);
    expect(lineMatches(line("0098", "2026-09-05", 10, null), "בלי פרויקט")).toBe(true);
  });

  it("filters the lines, says how many match, and hides the split while it searches", () => {
    renderWithProviders(<ReportLinesScreen sample={{ rows: MANY }} />, { route: ROUTE });
    const field = screen.getByRole("searchbox", { name: "חיפוש בתנועות" });
    fireEvent.change(field, { target: { value: "northside" } });
    expect(screen.getByText("2 תנועות מתאימות")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Northside Hardware/ })).toHaveLength(2);
    expect(screen.queryByRole("link", { name: /Quick Fix Plumbing/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /לפי פרויקט/ })).toBeNull();
    fireEvent.change(field, { target: { value: "nothing like it" } });
    expect(screen.getByText("אין תנועות שמתאימות לחיפוש")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "לחיפוש בכל התנועות" })).toHaveAttribute("href", "/search?q=nothing+like+it&category=c-repairs");
    fireEvent.change(field, { target: { value: "" } });
    expect(screen.getByRole("button", { name: /לפי פרויקט/ })).toBeInTheDocument();
  });

  it("titles a line with its description when only the description matched, the supplier in the hint (FLOW-167), and links the app's search", () => {
    const row = { ...line("0099", "2026-09-05", 1_388, "Cedar St", "Anytime Mailbox"), description: "Annual renewal" };
    const supplier = { title: "Anytime Mailbox", full: null, hint: "05/09 · Cedar St", wrap: false };
    expect(lineText(row, "")).toEqual(supplier);
    expect(lineText(row, "cedar")).toEqual(supplier);
    expect(lineText(row, "renewal")).toEqual({ title: "Annual renewal", full: "Annual renewal", hint: "05/09 · Anytime Mailbox", wrap: true });
    // A line with no supplier is titled by its description; a search wraps it too, so the word stays in view.
    expect(lineText({ ...row, supplier_name: null }, "renewal")).toEqual({ title: "Annual renewal", full: "Annual renewal", hint: "05/09 · Cedar St", wrap: true });
    expect(lineText({ ...row, supplier_name: null }, "")).toEqual({ title: "Annual renewal", full: null, hint: "05/09 · Cedar St", wrap: false });
    // FLOW-169: a word that matched the project keeps the project in the hint, before the supplier.
    expect(lineText(row, "renewal cedar")).toEqual({ title: "Annual renewal", full: "Annual renewal", hint: "05/09 · Cedar St · Anytime Mailbox", wrap: true });
    expect(lineText(row, "cedar renewal").hint).toBe("05/09 · Cedar St · Anytime Mailbox");
    expect(searchPath(" rent ", "none", "")).toBe("/search?q=rent&category=none");
    expect(searchPath("rent", "c1", "?preview=empty")).toBe("/search?preview=empty&q=rent&category=c1");
  });

  it("shows no search on a short list", () => {
    renderWithProviders(<ReportLinesScreen sample={{ rows: ROWS }} />, { route: ROUTE });
    expect(screen.queryByRole("searchbox", { name: "חיפוש בתנועות" })).toBeNull();
  });

  it("searches every page of the period, not just the loaded one", async () => {
    const wire = (row: ReportLinesSample["rows"][number]) => ({ ...row, amount_minor: Number(row.amount_minor) });
    rpc.impl = (name, args) => {
      if (name !== "get_breakdown_lines") return Promise.resolve({ data: null, error: { message: "down" } });
      const offset = (args as { p_offset: number }).p_offset;
      return Promise.resolve(offset === 0
        ? { data: { rows: MANY.map(wire), has_more: true, total_minor: 1_234_500, count: 42 }, error: null }
        : { data: { rows: [wire(line("0020", "2026-07-02", 77, "Maple Ave", "Distant Supplier"))], has_more: false, total_minor: 1_234_500, count: 42 }, error: null });
    };
    renderWithProviders(<ReportLinesScreen />, { route: ROUTE });
    const field = await screen.findByRole("searchbox", { name: "חיפוש בתנועות" });
    expect(rpc.calls).toHaveLength(1);
    fireEvent.change(field, { target: { value: "distant" } });
    expect(await screen.findByRole("link", { name: /Distant Supplier/ })).toBeInTheDocument();
    expect(rpc.calls).toHaveLength(2);
    await waitFor(() => { expect(screen.getByText("תנועה אחת מתאימה")).toBeInTheDocument(); });
    // The summary stays the category's whole total while the search narrows the list (FLOW-165).
    expect(document.querySelector(".ui-rep-summary")?.textContent).toContain("−$12,345");
    expect(screen.getByText("42 תנועות")).toBeInTheDocument();
  });
});

describe("the drill-down's search, when a page fails", () => {
  it("stops reading, says the list is partial and offers a retry", async () => {
    const wire = (row: ReportLinesSample["rows"][number]) => ({ ...row, amount_minor: Number(row.amount_minor) });
    rpc.impl = (_name, args) => (args as { p_offset: number }).p_offset === 0
      ? Promise.resolve({ data: { rows: MANY.map(wire), has_more: true }, error: null })
      : Promise.resolve({ data: null, error: { message: "down" } });
    renderWithProviders(<ReportLinesScreen />, { route: ROUTE });
    const field = await screen.findByRole("searchbox", { name: "חיפוש בתנועות" });
    fireEvent.change(field, { target: { value: "northside" } });
    expect(await screen.findByRole("button", { name: "נסו שוב" })).toBeInTheDocument();
    expect(rpc.calls).toHaveLength(2);
    expect(screen.getByText(/חלק מהתנועות לא נטענו/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ניקוי" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /עוד תנועות/ })).toBeNull();
  });

  it("goes back to reading while the retry runs, and finds the line once the page answers", async () => {
    const wire = (row: ReportLinesSample["rows"][number]) => ({ ...row, amount_minor: Number(row.amount_minor) });
    const page: { answer?: () => void } = {};
    rpc.impl = (_name, args) => {
      if ((args as { p_offset: number }).p_offset === 0) return Promise.resolve({ data: { rows: MANY.map(wire), has_more: true }, error: null });
      if (rpc.calls.length === 2) return Promise.resolve({ data: null, error: { message: "down" } });
      return new Promise((resolve) => { page.answer = () => { resolve({ data: { rows: [wire(line("0100", "2026-07-02", 77, null, "Late Page Supply"))], has_more: false }, error: null }); }; });
    };
    renderWithProviders(<ReportLinesScreen />, { route: ROUTE });
    fireEvent.change(await screen.findByRole("searchbox", { name: "חיפוש בתנועות" }), { target: { value: "late page" } });
    fireEvent.click(await screen.findByRole("button", { name: "נסו שוב" }));
    expect(await screen.findByText("מחפשים בכל התנועות…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "נסו שוב" })).toBeNull();
    await waitFor(() => { expect(page.answer).toBeDefined(); });
    page.answer?.();
    expect(await screen.findByText("תנועה אחת מתאימה")).toBeInTheDocument();
    expect(rpc.calls).toHaveLength(3);
  });
});
