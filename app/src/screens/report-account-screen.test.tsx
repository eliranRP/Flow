import { fireEvent, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  REPORT_ACCOUNT_EQUITY,
  REPORT_ACCOUNT_EQUITY_2025,
  REPORT_ACCOUNT_EQUITY_ALL,
  REPORT_ACCOUNT_LOAN,
  REPORT_ACCOUNT_QUIET,
} from "../dev/report-account-sample";
import { REPORTS_BALANCE, REPORTS_TODAY } from "../dev/reports-sample";
import { renderWithProviders } from "../test-render";
import { ReportAccountScreen } from "./report-account-screen";
import { ReportsScreen } from "./reports-screen";

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

const PROJECT = "a0000000-0000-4000-8000-000000000161";
const ROUTE = `/reports/account?kind=balance&scope=project&project=${PROJECT}&account=l-loan&cur=USD`;

/** The read's JSON: amounts as numbers, as PostgREST sends them. */
function wire(page: typeof REPORT_ACCOUNT_LOAN, rows: typeof page.rows = page.rows, hasMore = page.has_more) {
  return {
    ...page,
    project_id: page.project_id,
    currencies: page.currencies.map((c) => ({ ...c, opening_minor: Number(c.opening_minor), movement_minor: Number(c.movement_minor), balance_minor: Number(c.balance_minor) })),
    rows: rows.map((r) => ({ ...r, amount_minor: Number(r.amount_minor), line_amount_minor: Number(r.line_amount_minor) })),
    has_more: hasMore,
  };
}

describe("the balance sheet", () => {
  it("opens an account's movements from its row, keeping the date and the project", () => {
    renderWithProviders(<ReportsScreen sample={{ today: REPORTS_TODAY, balance: REPORTS_BALANCE }} />, { route: "/reports?kind=balance&asof=last_month" });
    const loan = screen.getByRole("link", { name: /קרן הלוואה|Loan principal/ });
    expect(loan.getAttribute("href")).toBe("/reports/account?kind=balance&asof=last_month&account=l-loan&cur=USD");
    // The running profit is not an account.
    expect(screen.queryByRole("link", { name: /רווח שנצבר/ })).toBeNull();
  });
});

describe("ReportAccountScreen", () => {
  it("shows the balance, the year's opening and payments, the movements by month and the loan page", () => {
    renderWithProviders(<ReportAccountScreen sample={{ today: "2026-10-31", page: REPORT_ACCOUNT_LOAN }} />, { route: ROUTE });
    const summary = document.querySelector(".ui-rep-summary")?.textContent ?? "";
    expect(summary).toContain("יתרה היום");
    expect(summary).toContain("$150,000");
    expect(summary).toContain("התחייבות · Cedar St");
    expect(screen.getByText(/יתרה ב־.*1\/1\/2026/)).toBeInTheDocument();
    expect(screen.getByText("שולם השנה")).toBeInTheDocument();
    expect(screen.getByText("10 תשלומים")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "אוקטובר 2026" })).toBeInTheDocument();
    const first = screen.getAllByRole("link", { name: /Example Mortgage Co/ })[0];
    expect(first?.getAttribute("href")).toBe(`/transactions/${REPORT_ACCOUNT_LOAN.rows[0]?.transaction_id ?? ""}`);
    // The loan part leads the hint, so a narrow row keeps it; the title is the party alone.
    expect(first?.querySelector(".ui-row-title")?.textContent).toBe("Example Mortgage Co");
    expect(first?.querySelector(".ui-row-hint")?.textContent).toBe("קרן · 01/10 · Cedar St");
    expect(first?.querySelector(".ui-row-tagline")?.textContent).toBe("מתוך תשלום $1,350");
    expect(screen.getByRole("link", { name: /לדף ההלוואה/ }).getAttribute("href")).toBe("/loans/d0000000-0000-4000-8000-000000000165");
  });

  it("says when the year has no movement, and links no loan for another account", () => {
    renderWithProviders(<ReportAccountScreen sample={{ today: "2026-10-31", page: REPORT_ACCOUNT_QUIET }} />, { route: ROUTE });
    expect(screen.getByText("אין תנועות מתחילת 2026.")).toBeInTheDocument();
    expect(screen.getByText("שינוי השנה")).toBeInTheDocument();
    // No movement: no "0" on the section or the change row.
    expect(screen.getByRole("button", { name: /תנועות/ }).textContent).not.toContain("0");
    expect(screen.queryByText(/^0 /)).toBeNull();
    expect(screen.queryByRole("link", { name: /הלוואה/ })).toBeNull();
  });

  it("says when the account is not found", () => {
    renderWithProviders(<ReportAccountScreen sample={{ today: "2026-10-31", page: null }} />, { route: ROUTE });
    expect(screen.getByText("החשבון לא נמצא")).toBeInTheDocument();
  });

  it("reads the account for the report's date, project and currency, and the next page on request", async () => {
    rpc.impl = (name, args) => {
      if (name !== "get_account_lines") return Promise.resolve({ data: null, error: { message: "down" } });
      const offset = (args as { p_offset: number }).p_offset;
      return Promise.resolve({ data: offset === 0 ? wire(REPORT_ACCOUNT_LOAN) : wire(REPORT_ACCOUNT_LOAN, [], false), error: null });
    };
    renderWithProviders(<ReportAccountScreen />, { route: ROUTE });
    await waitFor(() => { expect(document.querySelector(".ui-rep-summary")?.textContent).toContain("$150,000"); });
    expect(rpc.calls[0]?.args).toMatchObject({ p_account_id: "l-loan", p_project_id: PROJECT, p_currency: "USD", p_offset: 0 });
    expect((rpc.calls[0]?.args as { p_as_of: string }).p_as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    fireEvent.click(screen.getByRole("button", { name: "עוד 7 תנועות" }));
    await waitFor(() => { expect(rpc.calls).toHaveLength(2); });
    expect(rpc.calls[1]?.args).toMatchObject({ p_offset: 50 });
  });

  it("offers a retry when the read fails", async () => {
    renderWithProviders(<ReportAccountScreen />, { route: ROUTE });
    expect(await screen.findByRole("button", { name: "נסו שוב" })).toBeInTheDocument();
    expect(screen.getByText("החשבון לא נטען")).toBeInTheDocument();
  });
});

/** The router's search, a movement opened, and Back the way the browser's would go. */
function Probe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="search">{location.pathname + location.search}</output>
      <button type="button" onClick={() => { void navigate("/transactions/t1"); }}>open a movement</button>
      <button type="button" onClick={() => { void navigate(-1); }}>browser back</button>
    </>
  );
}

const EQUITY_ROUTE = "/reports/account?kind=balance&account=q-partner&cur=USD";

describe("ReportAccountScreen: the period (FLOW-171)", () => {
  it("this year: the opening on 1 January, the year's change, and the period choice on השנה", () => {
    renderWithProviders(<ReportAccountScreen sample={{ today: "2026-10-31", page: REPORT_ACCOUNT_EQUITY }} />, { route: EQUITY_ROUTE });
    expect(screen.getByRole("radio", { name: "השנה" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(/יתרה ב־.*1\/1\/2026/)).toBeInTheDocument();
    expect(screen.getByText("שינוי השנה")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "אוקטובר 2026" })).toBeInTheDocument();
    // The long Latin name breaks after its slash.
    expect(screen.getByRole("heading", { level: 1 }).innerHTML).toBe("Partner A – Contributions/<wbr>Distributions");
  });

  it("from the start: no opening row, the change since the start, and the months under a heading per year", () => {
    renderWithProviders(<ReportAccountScreen sample={{ today: "2026-10-31", page: REPORT_ACCOUNT_EQUITY_ALL }} />, { route: `${EQUITY_ROUTE}&span=all` });
    expect(screen.getByRole("radio", { name: "מההתחלה" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByText(/יתרה ב־/)).toBeNull();
    expect(screen.getByText("שינוי מההתחלה")).toBeInTheDocument();
    expect(screen.getByText("4 תנועות")).toBeInTheDocument();
    const years = screen.getAllByRole("region").filter((region) => /^\d{4}$/.test(region.getAttribute("aria-label") ?? ""));
    expect(years.map((region) => region.getAttribute("aria-label"))).toEqual(["2026", "2025"]);
    const y2025 = years[1];
    expect(y2025?.querySelector(".ui-rep-account-year-count")?.textContent).toBe("3 תנועות");
    // Under a year's heading a month is named alone; its region keeps the year for a screen reader.
    expect([...(y2025?.querySelectorAll("h3") ?? [])].map((h) => h.textContent)).toEqual(["דצמבר", "יוני", "פברואר"]);
    expect(screen.getByRole("region", { name: "דצמבר 2025" })).toBeInTheDocument();
  });

  it("says when the account has no movement at all", () => {
    renderWithProviders(<ReportAccountScreen sample={{ today: "2026-10-31", page: { ...REPORT_ACCOUNT_EQUITY_ALL, rows: [], currencies: [] } }} />, { route: `${EQUITY_ROUTE}&span=all` });
    expect(screen.getByText("אין תנועות בחשבון.")).toBeInTheDocument();
  });

  it("keeps the period in the URL and reads from the start under its own key; Back from a movement keeps it", async () => {
    rpc.impl = (name, args) => {
      if (name !== "get_account_lines") return Promise.resolve({ data: null, error: { message: "down" } });
      const all = (args as { p_from_start?: boolean }).p_from_start === true;
      return Promise.resolve({ data: wire(all ? REPORT_ACCOUNT_EQUITY_ALL : REPORT_ACCOUNT_EQUITY), error: null });
    };
    const ui = (
      <Routes>
        <Route path="/reports/account" element={<><ReportAccountScreen /><Probe /></>} />
        <Route path="*" element={<Probe />} />
      </Routes>
    );
    renderWithProviders(ui, { route: EQUITY_ROUTE });
    await waitFor(() => { expect(screen.getByText("שינוי השנה")).toBeInTheDocument(); });
    expect(rpc.calls[0]?.args).not.toHaveProperty("p_from_start");
    fireEvent.click(screen.getByRole("radio", { name: "מההתחלה" }));
    await waitFor(() => { expect(screen.getByText("שינוי מההתחלה")).toBeInTheDocument(); });
    expect(screen.getByTestId("search").textContent).toBe("/reports/account?kind=balance&account=q-partner&cur=USD&span=all");
    expect(rpc.calls.at(-1)?.args).toMatchObject({ p_account_id: "q-partner", p_from_start: true, p_offset: 0 });
    fireEvent.click(screen.getByRole("button", { name: "open a movement" }));
    await waitFor(() => { expect(screen.getByTestId("search").textContent).toBe("/transactions/t1"); });
    fireEvent.click(screen.getByRole("button", { name: "browser back" }));
    await waitFor(() => { expect(screen.getByText("שינוי מההתחלה")).toBeInTheDocument(); });
    expect(screen.getByRole("radio", { name: "מההתחלה" }).getAttribute("aria-checked")).toBe("true");
    // Back on the year: its page is cached under its own key, so the from-start read never replaced it.
    fireEvent.click(screen.getByRole("radio", { name: "השנה" }));
    await waitFor(() => { expect(screen.getByText("שינוי השנה")).toBeInTheDocument(); });
    expect(screen.getByTestId("search").textContent).toBe("/reports/account?kind=balance&account=q-partner&cur=USD");
  });

  it("switching the period replaces the history entry: Back leaves the account page", async () => {
    rpc.impl = (name, args) => {
      if (name !== "get_account_lines") return Promise.resolve({ data: null, error: { message: "down" } });
      const all = (args as { p_from_start?: boolean }).p_from_start === true;
      return Promise.resolve({ data: wire(all ? REPORT_ACCOUNT_EQUITY_ALL : REPORT_ACCOUNT_EQUITY), error: null });
    };
    const ui = (
      <MemoryRouter initialEntries={["/reports?kind=balance", EQUITY_ROUTE]} initialIndex={1}>
        <Routes>
          <Route path="/reports/account" element={<><ReportAccountScreen /><Probe /></>} />
          <Route path="*" element={<Probe />} />
        </Routes>
      </MemoryRouter>
    );
    renderWithProviders(ui, { memoryRouter: false });
    await waitFor(() => { expect(screen.getByText("שינוי השנה")).toBeInTheDocument(); });
    fireEvent.click(screen.getByRole("radio", { name: "מההתחלה" }));
    await waitFor(() => { expect(screen.getByTestId("search").textContent).toBe(`${EQUITY_ROUTE}&span=all`); });
    fireEvent.click(screen.getByRole("button", { name: "browser back" }));
    await waitFor(() => { expect(screen.getByTestId("search").textContent).toBe("/reports?kind=balance"); });
  });

  it("a balance sheet dated in 2025 reads that year: the date goes to the read and the choice names the year", async () => {
    rpc.impl = (name) => Promise.resolve(name === "get_account_lines" ? { data: wire(REPORT_ACCOUNT_EQUITY_2025), error: null } : { data: null, error: { message: "down" } });
    renderWithProviders(<ReportAccountScreen />, { route: `${EQUITY_ROUTE}&asof=custom&date=2025-12-31` });
    await waitFor(() => { expect(screen.getByText("שינוי ב־2025")).toBeInTheDocument(); });
    expect(rpc.calls[0]?.args).toMatchObject({ p_account_id: "q-partner", p_as_of: "2025-12-31" });
    expect(rpc.calls[0]?.args).not.toHaveProperty("p_from_start");
    expect(screen.getByRole("radio", { name: "שנת 2025" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(/יתרה ב־.*1\/1\/2025/)).toBeInTheDocument();
    expect(screen.getByText(/יתרה ב־.*31\/12\/2025/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "פברואר 2025" })).toBeInTheDocument();
  });
});

describe("the balance sheet's dated rows (FLOW-171)", () => {
  it("opens an account from a sheet dated at the end of last year, keeping that date", () => {
    renderWithProviders(<ReportsScreen sample={{ today: REPORTS_TODAY, balance: REPORTS_BALANCE }} />, { route: "/reports?kind=balance&asof=custom&date=2025-12-31" });
    const loan = screen.getByRole("link", { name: /קרן הלוואה|Loan principal/ });
    expect(loan.getAttribute("href")).toBe("/reports/account?kind=balance&asof=custom&date=2025-12-31&account=l-loan&cur=USD");
  });
});
