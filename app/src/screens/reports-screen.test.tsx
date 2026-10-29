import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { createBrowserRouter, RouterProvider, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import {
  REPORTS_BALANCE,
  REPORTS_BALANCE_SUSPENSE,
  REPORTS_BY_PROJECT,
  REPORTS_EMPTY,
  REPORTS_PROJECT_IDS,
  REPORTS_STATEMENT,
  REPORTS_TODAY,
} from "../dev/reports-sample";
import { renderWithProviders } from "../test-render";
import { ReportsScreen, reportLinesPath, type ReportsSample } from "./reports-screen";

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>;
}

function renderReports(sample: Partial<ReportsSample> = {}, route = "/reports") {
  return renderWithProviders(
    <>
      <ReportsScreen sample={{ today: REPORTS_TODAY, statement: REPORTS_STATEMENT, balance: REPORTS_BALANCE, projects: REPORTS_BY_PROJECT, ...sample }} />
      <LocationProbe />
    </>,
    { route },
  );
}

const where = () => screen.getByTestId("where").textContent;

beforeEach(() => {
  window.localStorage.clear();
});

describe("ReportsScreen · the P&L", () => {
  it("leads with the net profit and its margin, then income, expenses and the bottom line", () => {
    renderReports();
    expect(screen.getByRole("heading", { name: "דוחות" })).toBeInTheDocument();
    const summary = document.querySelector(".ui-rep-summary");
    expect(summary?.textContent).toContain("רווח נקי");
    expect(summary?.textContent).toContain("$29,000");
    expect(summary?.textContent).toContain("30% מההכנסות");
    expect(screen.getByRole("button", { name: /הכנסות/ })).toHaveAttribute("aria-expanded", "true");
    expect(within(screen.getByRole("region", { name: "הוצאות" })).getAllByRole("button")[0]).toHaveAttribute("aria-expanded", "true");
    const bottom = [...document.querySelectorAll(".ui-rep-total-strong")].map((node) => node.textContent);
    expect(bottom.some((text) => text.includes("רווח נקי") && text.includes("$29,000"))).toBe(true);
    expect(screen.getByText("2 תנועות ממתינות לבדיקה ולא נכללו")).toBeInTheDocument();
  });

  it("shows costs with a minus and keeps each sub-category under its parent", () => {
    renderReports();
    const parent = screen.getByRole("button", { name: /הוצאות הנכסים/ });
    expect(parent.textContent).toContain("−$47,200");
    expect(screen.getByRole("link", { name: /ריבית משכנתא/ }).textContent).toContain("−$18,900");
  });

  it("collapses a section and keeps its total on the header, and remembers it", () => {
    const view = renderReports();
    const income = screen.getByRole("button", { name: /הכנסות/ });
    fireEvent.click(income);
    expect(income).toHaveAttribute("aria-expanded", "false");
    expect(income.textContent).toContain("$96,000");
    expect(screen.queryByRole("link", { name: /שכירות/ })).toBeNull();
    view.unmount();
    renderReports();
    expect(screen.getByRole("button", { name: /הכנסות/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("closes every section with כיווץ הכל and opens them with פתיחת הכל", () => {
    renderReports();
    fireEvent.click(screen.getByRole("button", { name: "כיווץ הכל" }));
    expect(screen.queryByRole("link", { name: /שכירות/ })).toBeNull();
    expect(screen.getByRole("button", { name: /הכנסות/ })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "פתיחת הכל" }));
    expect(screen.getByRole("link", { name: /שכירות/ })).toBeInTheDocument();
  });

  it("opens a category's lines with the period and the currency", () => {
    renderReports();
    const href = screen.getByRole("link", { name: /תיקונים ותחזוקה/ }).getAttribute("href") ?? "";
    expect(href.startsWith("/reports/lines?")).toBe(true);
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("category")).toBe("c-repairs");
    expect(params.get("side")).toBe("expense");
    expect(params.get("from")).toBe("2026-01-01");
    expect(params.get("to")).toBe(REPORTS_TODAY);
    expect(params.get("cur")).toBe("USD");
  });

  it("lists the kept-out categories with their accounts, closed into one section", () => {
    renderReports();
    const kept = screen.getByRole("button", { name: /לא נספר ברווח/ });
    expect(kept.textContent).toContain("2 קטגוריות");
    // The account's name when it differs from the category's, else its type.
    expect(screen.getAllByText("התחייבות", { selector: ".ui-rep-row-meta" })).toHaveLength(1);
    expect(screen.getAllByText("נכס", { selector: ".ui-rep-row-meta" })).toHaveLength(1);
  });

  it("shows a card per project by project, closed, with the full report one tap away", () => {
    renderReports({ statement: REPORTS_BY_PROJECT }, "/reports?scope=by_project");
    const card = screen.getByRole("button", { name: /Cedar St/ });
    expect(card).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(card);
    const more = screen.getByRole("link", { name: "הדוח המלא של Cedar St" });
    expect(more.getAttribute("href")).toBe(`/reports?scope=project&project=${REPORTS_PROJECT_IDS.cedar}`);
  });

  it("says when the period has no lines, with one way out", () => {
    renderReports({ statement: REPORTS_EMPTY });
    expect(screen.getByText("אין תנועות בתקופה הזאת")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "בחירת תקופה אחרת" }));
    expect(screen.getByRole("dialog", { name: "תקופה" })).toBeInTheDocument();
  });

  it("says when the project is not found, and goes back to every project", () => {
    renderReports({ statement: null }, `/reports?scope=project&project=${REPORTS_PROJECT_IDS.cedar}`);
    expect(screen.getByText("הפרויקט לא נמצא")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "כל הפרויקטים" }));
    expect(where()).toBe("/reports");
  });

  it("shows the failed state with a retry", () => {
    renderReports({ phase: { kind: "error", offline: false } });
    expect(screen.getByText("הדוח לא נטען")).toBeInTheDocument();
  });
});

describe("ReportsScreen · the sheets", () => {
  it("picks a preset period and writes it in the URL", async () => {
    renderReports();
    fireEvent.click(screen.getByRole("button", { name: "השנה · 2026" }));
    const sheet = screen.getByRole("dialog", { name: "תקופה" });
    fireEvent.click(within(sheet).getByRole("radio", { name: /חודש שעבר/ }));
    await waitFor(() => { expect(where()).toBe("/reports?period=last_month"); });
  });

  it("turns the same sheet into a range, and shows it", async () => {
    renderReports();
    fireEvent.click(screen.getByRole("button", { name: "השנה · 2026" }));
    fireEvent.click(screen.getByRole("button", { name: "תאריכים אחרים" }));
    const sheet = screen.getByRole("dialog", { name: "תאריכים אחרים" });
    fireEvent.click(within(sheet).getByRole("button", { name: / 5 באוקטובר 2026$/ }));
    fireEvent.click(within(sheet).getByRole("button", { name: / 20 באוקטובר 2026$/ }));
    expect(within(sheet).getByText(/16 ימים/)).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "הצגת 05/10–20/10" }));
    await waitFor(() => { expect(where()).toBe("/reports?period=custom&from=2026-10-05&to=2026-10-20"); });
  });

  it("picks one project or every project by project", async () => {
    renderReports();
    fireEvent.click(screen.getByRole("button", { name: "כל הפרויקטים" }));
    const sheet = screen.getByRole("dialog", { name: "פרויקטים" });
    fireEvent.click(within(sheet).getByRole("radio", { name: /Maple Ave/ }));
    await waitFor(() => { expect(where()).toBe(`/reports?scope=project&project=${REPORTS_PROJECT_IDS.maple}`); });
  });

  it("keeps the pick in the browser's history once the sheet has stepped back over its entry", async () => {
    window.history.replaceState(null, "", "/reports");
    const router = createBrowserRouter([
      { path: "/reports", element: <ReportsScreen sample={{ today: REPORTS_TODAY, statement: REPORTS_STATEMENT, balance: REPORTS_BALANCE, projects: REPORTS_BY_PROJECT }} /> },
    ]);
    renderWithProviders(<RouterProvider router={router} />, { memoryRouter: false });
    fireEvent.click(screen.getByRole("button", { name: "השנה · 2026" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "תקופה" })).getByRole("radio", { name: /חודש שעבר/ }));
    await waitFor(() => { expect(router.state.location.search).toBe("?period=last_month"); });
    await waitFor(() => { expect(window.location.search).toBe("?period=last_month"); });
    expect(screen.queryByRole("dialog", { name: "תקופה" })).not.toBeInTheDocument();
    router.dispose();
  });
});

describe("ReportsScreen · the balance sheet", () => {
  it("leads with equity and says it balances", () => {
    renderReports({}, "/reports?kind=balance");
    const summary = document.querySelector(".ui-rep-summary");
    expect(summary?.textContent).toContain("הון עצמי");
    expect(summary?.textContent).toContain("$285,000");
    expect(summary?.textContent).toContain("מאוזן");
    expect(screen.getByText("קרן הלוואה")).toBeInTheDocument();
    expect(screen.getByText("רווח שנצבר")).toBeInTheDocument();
    expect(document.querySelector(".ui-rep-warning")).toBeNull();
  });

  it("warns about Suspense with its amount and a way to fix it", () => {
    renderReports({ balance: REPORTS_BALANCE_SUSPENSE }, "/reports?kind=balance");
    const warning = document.querySelector(".ui-rep-warning");
    if (!(warning instanceof HTMLElement)) throw new Error("no warning");
    expect(warning.textContent).toContain("$1,250");
    expect(within(warning).getByRole("link", { name: "סידור הקטגוריות" })).toHaveAttribute("href", "/settings/categories");
    expect(document.querySelector(".ui-rep-summary")?.textContent).not.toContain("מאוזן");
  });

  it("drops by project on the balance sheet", () => {
    renderReports({}, "/reports?scope=by_project");
    fireEvent.click(screen.getByRole("radio", { name: "מאזן" }));
    expect(where()).toBe("/reports?kind=balance");
  });
});

describe("reportLinesPath", () => {
  it("keeps one project's name so the lines stay on it", () => {
    const path = reportLinesPath(
      { kind: "pnl", period: { kind: "all" }, asOf: { kind: "today" }, scope: { kind: "project", id: REPORTS_PROJECT_IDS.cedar } },
      "income",
      { id: "c-rent", name: "שכירות" },
      REPORTS_TODAY,
      "",
      "USD",
      "Cedar St",
    );
    const params = new URLSearchParams(path.split("?")[1]);
    expect(params.get("pname")).toBe("Cedar St");
    expect(params.has("from")).toBe(false);
  });
});
