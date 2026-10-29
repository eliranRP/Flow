import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../test-render";
import { HomeReportsCard } from "./home-reports-card";
import { linesByMonth, linesByProject, ReportLinesScreen, reportLinesArgs, type ReportLinesSample } from "./report-lines-screen";
import { REPORTS_BALANCE, REPORTS_STATEMENT } from "../dev/reports-sample";

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

  it("keeps one project's lines when the report was on one project", () => {
    renderWithProviders(<ReportLinesScreen sample={{ rows: ROWS }} />, { route: `${ROUTE}&pname=Cedar+St` });
    expect(screen.queryByRole("link", { name: /Bright Electric/ })).toBeNull();
    expect(document.querySelector(".ui-rep-summary")?.textContent).toContain("−$1,450");
    // One project: no split.
    expect(screen.queryByRole("button", { name: /לפי פרויקט/ })).toBeNull();
  });

  it("offers more lines when the read has more", () => {
    renderWithProviders(<ReportLinesScreen sample={{ rows: ROWS, hasMore: true }} />, { route: ROUTE });
    fireEvent.click(screen.getByRole("button", { name: "עוד תנועות" }));
    expect(screen.getByText("4 תנועות ועוד")).toBeInTheDocument();
  });
});

describe("HomeReportsCard", () => {
  it("opens the P&L with this year's net profit and the balance sheet with today's equity", () => {
    renderWithProviders(<HomeReportsCard today="2026-10-31" search="" enabled={false} sample={{ statement: REPORTS_STATEMENT, balance: REPORTS_BALANCE }} />);
    const pnl = screen.getByRole("link", { name: /רווח והפסד/ });
    expect(pnl.getAttribute("href")).toBe("/reports");
    expect(pnl.textContent).toContain("$29,000");
    const balance = screen.getByRole("link", { name: /מאזן/ });
    expect(balance.getAttribute("href")).toBe("/reports?kind=balance");
    expect(balance.textContent).toContain("$285,000");
  });

  it("keeps the preview flag on its links and shows a dash before the reads", () => {
    renderWithProviders(<HomeReportsCard today="2026-10-31" search="?preview=1" enabled={false} />);
    expect(screen.getByRole("link", { name: /מאזן/ }).getAttribute("href")).toBe("/reports?kind=balance&preview=1");
    expect(document.querySelectorAll(".ui-home-rep-figure-empty")).toHaveLength(2);
  });
});
