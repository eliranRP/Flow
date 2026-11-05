import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import {
  REPORTS_BALANCE,
  REPORTS_BALANCE_SUSPENSE,
  REPORTS_BY_PROJECT,
  REPORTS_CEDAR,
  REPORTS_EMPTY,
  REPORTS_MONTHS,
  REPORTS_OCTOBER,
  REPORTS_PROJECT_IDS,
  REPORTS_PROJECT_SHEETS,
  REPORTS_STATEMENT,
  REPORTS_TODAY,
} from "../dev/reports-sample";
import { renderWithProviders } from "../test-render";
import { BalanceReportScreen, type BalanceSample } from "./reports-balance-screen";
import { ReportsHubScreen, ReportsScreen } from "./reports-hub-screen";
import { PnlReportScreen, reportLinesPath, type PnlSample } from "./reports-screen";

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>;
}

const CEDAR = REPORTS_PROJECT_IDS.cedar;
const PNL: PnlSample = { today: REPORTS_TODAY, statement: REPORTS_STATEMENT, byProject: REPORTS_BY_PROJECT, months: REPORTS_MONTHS };
const BALANCE: BalanceSample = { today: REPORTS_TODAY, balance: REPORTS_BALANCE, projects: REPORTS_BY_PROJECT, projectSheets: REPORTS_PROJECT_SHEETS };

function renderPnl(sample: Partial<PnlSample> = {}, route = "/reports/pnl") {
  return renderWithProviders(<><PnlReportScreen sample={{ ...PNL, ...sample }} /><LocationProbe /></>, { route });
}

function renderBalance(sample: Partial<BalanceSample> = {}, route = "/reports/balance") {
  return renderWithProviders(<><BalanceReportScreen sample={{ ...BALANCE, ...sample }} /><LocationProbe /></>, { route });
}

const where = () => screen.getByTestId("where").textContent;
const band = () => document.querySelector(".ui-rep-band");

beforeEach(() => {
  window.localStorage.clear();
});

describe("/reports", () => {
  it("is the hub: a card for each report, then the three breakdowns", () => {
    renderWithProviders(<ReportsHubScreen sample={{ today: REPORTS_TODAY, statement: REPORTS_STATEMENT, byProject: REPORTS_BY_PROJECT, months: REPORTS_MONTHS, balance: REPORTS_BALANCE }} />, { route: "/reports" });
    const pnl = screen.getByRole("link", { name: /רווח והפסד.*\$29,000/ });
    expect(pnl).toHaveAttribute("href", "/reports/pnl?view=category");
    expect(screen.getByRole("link", { name: /מאזן.*\$285,000/ })).toHaveAttribute("href", "/reports/balance?view=assets");
    expect(screen.getByRole("link", { name: /רווח והפסד לפי פרויקט/ })).toHaveAttribute("href", "/reports/pnl?view=project");
    expect(screen.getByRole("link", { name: /רווח והפסד לפי חודש/ })).toHaveAttribute("href", "/reports/pnl?view=month");
    expect(screen.getByRole("link", { name: /מאזן לפי פרויקט/ })).toHaveAttribute("href", "/reports/balance?view=project");
    expect(screen.getByText("הרווחי ביותר: Cedar St · +$13,000")).toBeInTheDocument();
    // The mini charts are decoration: the figures are written beside them.
    for (const chart of document.querySelectorAll(".ui-rep-hub-bars, .ui-rep-hub-split")) expect(chart).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps each card on its own read: a failed balance read keeps the P&L card and shows a retry line", () => {
    renderWithProviders(<ReportsHubScreen sample={{ today: REPORTS_TODAY, statement: REPORTS_STATEMENT, byProject: REPORTS_BY_PROJECT, months: REPORTS_MONTHS, failed: ["balance"] }} />, { route: "/reports" });
    expect(screen.getByRole("link", { name: /רווח והפסד.*\$29,000/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /מאזן.*\$285,000/ })).toBeNull();
    expect(screen.queryByText("הדוחות לא נטענו")).toBeNull();
    expect(screen.getAllByRole("button", { name: "נסו שוב" })).toHaveLength(1);
  });

  it("shows a retry line for a failed months or by-project read, and keeps the cards", () => {
    renderWithProviders(<ReportsHubScreen sample={{ today: REPORTS_TODAY, statement: REPORTS_STATEMENT, balance: REPORTS_BALANCE, failed: ["months", "byProject"] }} />, { route: "/reports" });
    expect(screen.getByRole("link", { name: /רווח והפסד.*\$29,000/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /מאזן.*\$285,000/ })).toBeInTheDocument();
    expect(document.querySelector(".ui-rep-hub-bars")).toBeNull();
    expect(screen.getAllByRole("button", { name: "נסו שוב" })).toHaveLength(2);
  });

  it("fails as a whole only when both reports failed", () => {
    renderWithProviders(<ReportsHubScreen sample={{ today: REPORTS_TODAY, failed: ["statement", "balance"] }} />, { route: "/reports" });
    expect(screen.getByText("הדוחות לא נטענו")).toBeInTheDocument();
  });

  it("keeps its period in the URL and hands it to the reports", async () => {
    renderWithProviders(<><ReportsHubScreen sample={{ today: REPORTS_TODAY, statement: REPORTS_STATEMENT, balance: REPORTS_BALANCE }} /><LocationProbe /></>, { route: "/reports" });
    fireEvent.click(screen.getByRole("button", { name: "השנה · 2026" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "תקופה" })).getByRole("radio", { name: /חודש שעבר/ }));
    await waitFor(() => { expect(where()).toBe("/reports?period=last_month"); });
    expect(screen.getByRole("link", { name: /רווח והפסד לפי חודש/ })).toHaveAttribute("href", "/reports/pnl?view=month&period=last_month");
  });

  it("sends an old link on with its state: the balance sheet, and the project band's דוחות", () => {
    const routes = (
      <Routes>
        <Route path="/reports" element={<ReportsScreen />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    );
    const first = renderWithProviders(routes, { route: "/reports?kind=balance&asof=last_month" });
    expect(where()).toBe("/reports/balance?view=assets&asof=last_month");
    first.unmount();
    renderWithProviders(routes, { route: `/reports?scope=project&project=${CEDAR}&preview=empty` });
    expect(where()).toBe(`/reports/pnl?view=project&project=${CEDAR}&preview=empty`);
  });
});

describe("the P&L", () => {
  it("leads the band with the net profit, its margin, income and expenses, and the period pill", () => {
    renderPnl();
    expect(screen.getByRole("heading", { level: 1, name: "רווח והפסד" })).toBeInTheDocument();
    expect(band()?.textContent).toContain("$29,000");
    expect(band()?.textContent).toContain("30% מההכנסות");
    expect(band()?.textContent).toContain("+$96,000");
    expect(band()?.textContent).toContain("$67,000");
    expect(screen.getByRole("button", { name: "השנה · 2026" })).toHaveAttribute("aria-haspopup", "dialog");
  });

  it("lists the categories under one-line heads with their totals, a row opening its lines", () => {
    renderPnl();
    expect(screen.getByRole("heading", { name: "הוצאות הנכסים" }).closest(".ui-group-head-line")?.textContent).toContain("$47,200");
    const link = screen.getByRole("link", { name: /ריבית משכנתא/ });
    const params = new URLSearchParams(link.getAttribute("href")?.split("?")[1]);
    expect(params.get("category")).toBe("c-mortgage");
    expect(params.get("lfrom")).toBe("2026-01-01");
    expect(params.get("lto")).toBe("2026-10-31");
    expect(params.get("view")).toBeNull();
    expect(screen.getByRole("heading", { name: "לא נספר ברווח" })).toBeInTheDocument();
  });

  it("shows what was left out of the report as a card that hides", () => {
    renderPnl();
    expect(screen.getByRole("link", { name: /2 תנועות לא נכללו/ })).toHaveAttribute("href", "/review");
    fireEvent.click(screen.getByRole("button", { name: "הסתרה: 2 תנועות לא נכללו · לבדיקה" }));
    return waitFor(() => { expect(screen.queryByRole("link", { name: /2 תנועות לא נכללו/ })).toBeNull(); });
  });

  it("picks the view in the URL", async () => {
    renderPnl();
    fireEvent.click(screen.getByRole("radio", { name: "פרויקט" }));
    await waitFor(() => { expect(where()).toBe("/reports/pnl?view=project"); });
  });

  it("by project: a row per project, the general expenses in their own group, adding up to the band", () => {
    renderPnl({}, "/reports/pnl?view=project");
    const cedar = screen.getByRole("link", { name: /Cedar St/ });
    expect(cedar.textContent).toContain("+$13,000");
    expect(cedar.textContent).toContain("הכנסות $30,000 · הוצאות $17,000");
    expect(cedar).toHaveAttribute("href", `/reports/pnl?view=project&project=${CEDAR}`);
    expect(screen.getByRole("heading", { name: "כלליות · לא פרויקט" }).closest(".ui-group-head-line")?.textContent).toContain("−$5,800");
    expect(document.querySelector(".ui-rep-total-strong")?.textContent).toContain("$29,000");
  });

  it("drills a project on the same screen: its name and net in the band, its categories, the way back and on", () => {
    renderPnl({ drilled: REPORTS_CEDAR }, `/reports/pnl?view=project&project=${CEDAR}`);
    expect(screen.getByRole("heading", { level: 1, name: "Cedar St" })).toBeInTheDocument();
    expect(band()?.textContent).toContain("$13,000");
    expect(band()?.textContent).toContain("מתוך רווח נקי $29,000");
    expect(screen.queryByRole("radiogroup", { name: "תצוגה" })).toBeNull();
    expect(screen.getByRole("heading", { name: "הוצאות" }).closest(".ui-group-head-line")?.textContent).toContain("$17,000");
    expect(screen.getByRole("link", { name: /לדף הפרויקט/ })).toHaveAttribute("href", `/projects/${CEDAR}`);
    const lines = new URLSearchParams(screen.getByRole("link", { name: /מס רכוש/ }).getAttribute("href")?.split("?")[1]);
    expect(lines.get("project")).toBe(CEDAR);
    fireEvent.click(screen.getByRole("button", { name: "חזרה ללפי פרויקט" }));
    expect(where()).toBe("/reports/pnl?view=project");
  });

  it("drills the general expenses from the by-project read, with no project page to go on to", () => {
    renderPnl({}, "/reports/pnl?project=overhead");
    expect(screen.getByRole("heading", { level: 1, name: "הוצאות כלליות" })).toBeInTheDocument();
    expect(screen.getByText("ייעוץ משפטי")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /לדף הפרויקט/ })).toBeNull();
  });

  it("by month: a row per month, and a month drills into its own P&L with its lines one tap on", () => {
    const view = renderPnl({}, "/reports/pnl?view=month");
    expect(screen.getByRole("link", { name: /אוקטובר 2026/ })).toHaveAttribute("href", "/reports/pnl?view=month&month=2026-10");
    view.unmount();
    renderPnl({ drilled: REPORTS_OCTOBER }, "/reports/pnl?view=month&month=2026-10");
    expect(screen.getByRole("heading", { level: 1, name: "אוקטובר 2026" })).toBeInTheDocument();
    expect(band()?.textContent).toContain("$3,800");
    expect(screen.getByRole("link", { name: /תנועות החודש/ })).toHaveAttribute("href", "/search?period=custom&from=2026-10-01&to=2026-10-31");
    expect(screen.getByRole("button", { name: "חזרה ללפי חודש" })).toBeInTheDocument();
  });

  it("says when the project is not found, and goes back to the projects", () => {
    renderPnl({ drilled: null }, `/reports/pnl?project=${REPORTS_PROJECT_IDS.maple}`);
    fireEvent.click(screen.getByRole("button", { name: "לפי פרויקט" }));
    expect(where()).toBe("/reports/pnl?view=project");
  });

  it("says when the period has no lines, with one way out", () => {
    renderPnl({ statement: REPORTS_EMPTY });
    expect(screen.getByText("אין תנועות בתקופה הזאת")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "שיתוף הדוח" })).toBeNull();
  });

  it("keeps the band with a retry when the read fails", () => {
    renderPnl({ phase: { kind: "error", offline: false } });
    expect(screen.getByText("הדוח לא נטען")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "נסו שוב" })).toBeInTheDocument();
  });

  it("picks a preset period and writes it in the URL", async () => {
    renderPnl({}, "/reports/pnl?view=month");
    fireEvent.click(screen.getByRole("button", { name: "השנה · 2026" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "תקופה" })).getByRole("radio", { name: /חודש שעבר/ }));
    await waitFor(() => { expect(where()).toBe("/reports/pnl?view=month&period=last_month"); });
  });
});

describe("the balance sheet", () => {
  it("leads with equity, says it balances, and lists the assets", () => {
    renderBalance();
    // From 100K the band's figure is short, as on Home.
    expect(band()?.textContent).toContain("$285K");
    expect(band()?.textContent).toContain("מאוזן");
    expect(band()?.textContent).toContain("$814,500");
    expect(screen.getByRole("heading", { name: "נכסים" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /פחת שנצבר/ }).textContent).toContain("−$14,000");
    expect(document.querySelector(".ui-rep-warning")).toBeNull();
  });

  it("lists liabilities and equity, with the running profit", () => {
    renderBalance({}, "/reports/balance?view=liabilities");
    expect(screen.getByText("קרן הלוואה")).toBeInTheDocument();
    expect(screen.getByText("רווח שנצבר")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /קרן הלוואה/ })).toHaveAttribute("href", "/reports/account?view=liabilities&account=l-loan&cur=USD");
  });

  it("warns about Suspense with its amount and a way to fix it", () => {
    renderBalance({ balance: REPORTS_BALANCE_SUSPENSE });
    const warning = document.querySelector(".ui-rep-warning");
    if (!(warning instanceof HTMLElement)) throw new Error("no warning");
    expect(warning.textContent).toContain("$1,250");
    expect(within(warning).getByRole("link", { name: "סידור הקטגוריות" })).toHaveAttribute("href", "/settings/categories");
    expect(band()?.textContent).not.toContain("מאוזן");
  });

  it("by project: each property's equity and the rest, adding up to the band, a property drilling in", () => {
    renderBalance({}, "/reports/balance?view=project");
    const oak = screen.getByRole("link", { name: /Oak Ridge/ });
    expect(oak.textContent).toContain("$95,700");
    expect(oak).toHaveAttribute("href", `/reports/balance?view=project&project=${REPORTS_PROJECT_IDS.oak}`);
    expect(screen.getByText("בנק ושאר").closest(".ui-row")?.textContent).toContain("$39,000");
    expect(screen.queryByText("Riverside Commons Phase Two Townhomes")).toBeNull();
  });

  it("drills a property into its own assets and liabilities, its equity in the band", () => {
    const oak = REPORTS_PROJECT_SHEETS.find((sheet) => sheet.project_id === REPORTS_PROJECT_IDS.oak);
    renderBalance(oak == null ? {} : { drilled: oak }, `/reports/balance?view=project&project=${REPORTS_PROJECT_IDS.oak}`);
    expect(screen.getByRole("heading", { level: 1, name: "Oak Ridge" })).toBeInTheDocument();
    expect(band()?.textContent).toContain("$95,700");
    expect(screen.getByRole("heading", { name: "התחייבויות" }).closest(".ui-group-head-line")?.textContent).toContain("$145,300");
    fireEvent.click(screen.getByRole("button", { name: "חזרה ללפי פרויקט" }));
    expect(where()).toBe("/reports/balance?view=project");
  });

  it("says in the date sheet that every date counts from the start (FLOW-170)", () => {
    renderBalance();
    fireEvent.click(screen.getByRole("button", { name: "היום" }));
    const group = screen.getByRole("radiogroup", { name: "נכון לתאריך" });
    const note = screen.getByText("המאזן כולל את כל התנועות מההתחלה ועד התאריך שבוחרים");
    expect(group).toHaveAttribute("aria-describedby", note.id);
  });
});

describe("reportLinesPath", () => {
  it("keeps one project's id and name, and the report's own period", () => {
    const path = reportLinesPath({ from: "2026-10-01", to: "2026-10-31" }, "expense", { id: "c-tax", name: "מס רכוש" }, "?view=month&period=custom&from=2026-01-01&to=2026-06-30&month=2026-10", "USD", { id: CEDAR, name: "Cedar St" });
    const params = new URLSearchParams(path.split("?")[1]);
    expect(params.get("lfrom")).toBe("2026-10-01");
    expect(params.get("from")).toBe("2026-01-01");
    expect(params.get("project")).toBe(CEDAR);
    expect(params.get("pname")).toBe("Cedar St");
  });
});
