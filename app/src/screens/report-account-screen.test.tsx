import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REPORT_ACCOUNT_LOAN, REPORT_ACCOUNT_QUIET } from "../dev/report-account-sample";
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
function wire(page: typeof REPORT_ACCOUNT_LOAN, rows = page.rows, hasMore = page.has_more) {
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
