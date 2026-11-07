import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import { barShare, hintFigures, reportHint, rowShare } from "./reports-parts";
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
    // The board's two rows carry no sign: the word says which is income (V3-Report, FLOW-1054).
    expect(band()?.textContent).toContain("הכנסות$96,000");
    expect(band()?.textContent).not.toContain("+$96,000");
    expect(band()?.textContent).toContain("$67,000");
    expect(screen.getByRole("button", { name: "השנה · 2026" })).toHaveAttribute("aria-haspopup", "dialog");
  });

  it("writes each row's share of its group as a percent under its name: costs of a group of several, none on income", () => {
    renderPnl();
    const mortgage = screen.getByRole("link", { name: /ריבית משכנתא/ });
    expect(mortgage.querySelector(".ui-rep-hint-text")?.textContent).toMatch(/^\d{1,3}% מהקבוצה$/);
    const income = screen.getByRole("heading", { name: "הכנסות" }).closest("section");
    expect(income?.querySelector(".ui-rep-hint-text")).toBeNull();
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
    expect(cedar.querySelector(".ui-rep-hint-full")?.textContent).toBe("הכנסות $30,000 · הוצאות $17,000");
    expect(cedar.querySelector(".ui-rep-hint-short")?.textContent).toBe("הכנסות $30K · הוצאות $17K");
    // A screen reader reads the full figures once: the short line is hidden from it.
    expect(cedar.querySelector(".ui-rep-hint-short")).toHaveAttribute("aria-hidden", "true");
    expect(cedar.querySelector(".ui-rep-hint-text")?.firstChild?.textContent).toMatch(/^\d{1,3}%$/);
    // The general expenses are one row alone: no percent.
    expect(screen.getByRole("heading", { name: "כלליות · לא פרויקט" }).closest("section")?.querySelector(".ui-rep-hint-text")?.textContent).not.toContain("%");
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

  it("in a month's drill, the pill picks another month and stays in the drill (FLOW-1092)", async () => {
    renderPnl({ drilled: REPORTS_OCTOBER }, "/reports/pnl?view=month&month=2026-10");
    fireEvent.click(screen.getByRole("button", { name: "אוקטובר 2026" }));
    const sheet = screen.getByRole("dialog", { name: "חודש" });
    expect(within(sheet).getByRole("radio", { name: "אוקטובר 2026" })).toBeChecked();
    fireEvent.click(within(sheet).getByRole("radio", { name: "יולי 2026" }));
    await waitFor(() => { expect(where()).toBe("/reports/pnl?view=month&month=2026-07"); });
    expect(screen.getByRole("heading", { level: 1, name: "יולי 2026" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "חזרה ללפי חודש" })).toBeInTheDocument();
  });

  it("in a month's drill, the pill's chevrons step to the next month either way, none past the last", () => {
    renderPnl({ drilled: REPORTS_OCTOBER }, "/reports/pnl?view=month&month=2026-10");
    // October is the newest month: no later one.
    expect(screen.getByRole("button", { name: "חודש הבא" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: "חודש קודם" }));
    expect(where()).toBe("/reports/pnl?view=month&month=2026-09");
    expect(screen.getByRole("heading", { level: 1, name: "ספטמבר 2026" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "חודש הבא" }));
    expect(where()).toBe("/reports/pnl?view=month&month=2026-10");
  });

  it("in a month's drill, the compact bar names the month once; a project's drill keeps its period after it", () => {
    const view = renderPnl({ drilled: REPORTS_OCTOBER }, "/reports/pnl?view=month&month=2026-10");
    expect(document.querySelector(".ui-rep-bar-title")?.textContent).toBe("אוקטובר 2026");
    view.unmount();
    renderPnl({ drilled: REPORTS_CEDAR }, `/reports/pnl?view=project&project=${CEDAR}`);
    expect(document.querySelector(".ui-rep-bar-title")?.textContent).toMatch(/^Cedar St · \S/);
  });

  it("a month opened from the list, stepped to another month, still goes back to that list (FLOW-1092)", () => {
    function KeyProbe() {
      return <output data-testid="key">{useLocation().key}</output>;
    }
    renderWithProviders(<><PnlReportScreen sample={{ ...PNL, drilled: REPORTS_OCTOBER }} /><LocationProbe /><KeyProbe /></>, { route: "/reports/pnl?view=month" });
    const listKey = screen.getByTestId("key").textContent;
    fireEvent.click(screen.getByRole("link", { name: /אוקטובר 2026/ }));
    expect(where()).toBe("/reports/pnl?view=month&month=2026-10");
    fireEvent.click(screen.getByRole("button", { name: "חודש קודם" }));
    expect(where()).toBe("/reports/pnl?view=month&month=2026-09");
    fireEvent.click(screen.getByRole("button", { name: "חזרה ללפי חודש" }));
    // Back to the list's own history entry, not a new one on top of it.
    expect(where()).toBe("/reports/pnl?view=month");
    expect(screen.getByTestId("key").textContent).toBe(listKey);
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

describe("barShare", () => {
  it("is a row's whole percent of its group, a loss by its size, never past 100", () => {
    expect(barShare(1_890_000n, 4_720_000n)).toBe(40);
    expect(barShare(-120_000n, 1_000_000n)).toBe(12);
    expect(barShare(500n, -1_000n)).toBe(50);
    expect(barShare(2_000n, 1_000n)).toBe(100);
    expect(barShare(1_000n, 0n)).toBe(0);
  });
});

describe("rowShare", () => {
  it("says under 1% for a small non-zero row, 0% for a zero row (FLOW-1083)", () => {
    expect(rowShare(1_000n, 1_000_000n)).toBe("under-1");
    expect(rowShare(-1_000n, 1_000_000n)).toBe("under-1");
    expect(rowShare(0n, 1_000_000n)).toBe(0);
    expect(rowShare(1_000n, 0n)).toBe(0);
    expect(rowShare(400_000n, 1_000_000n)).toBe(40);
  });

  it("writes the hint: a $10 row of a $10,000 group reads פחות מ־1%, a zero row 0%", () => {
    const { container: small } = render(<>{reportHint(undefined, rowShare(1_000n, 1_000_000n))}</>);
    expect(small.textContent).toBe("פחות מ־1% מהקבוצה");
    const { container: zero } = render(<>{reportHint("הכנסות $0", rowShare(0n, 1_000_000n))}</>);
    expect(zero.textContent).toBe("0% · הכנסות $0");
  });
});

describe("reportHint", () => {
  it("writes a line with figures in full and short, the short one hidden from a screen reader (FLOW-1082)", () => {
    const { container } = render(<>{reportHint(hintFigures([["הכנסות", 3_000_000n], ["הוצאות", 1_700_000n]], "USD"), 37)}</>);
    expect(container.querySelector(".ui-rep-hint-full")?.textContent).toBe("הכנסות $30,000 · הוצאות $17,000");
    expect(container.querySelector(".ui-rep-hint-short")?.textContent).toBe("הכנסות $30K · הוצאות $17K");
    expect(container.querySelector(".ui-rep-hint-short")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector(".ui-rep-hint-text")?.textContent.startsWith("37% · ")).toBe(true);
    const { container: plain } = render(<>{reportHint("מזומן ושאר החשבונות")}</>);
    expect(plain.textContent).toBe("מזומן ושאר החשבונות");
    expect(plain.querySelector(".ui-rep-hint-short")).toBeNull();
  });

  it("keeps an amount under $1,000 whole and writes millions short", () => {
    expect(hintFigures([["הכנסות", 100_000n], ["הוצאות", 99_000n]], "USD").short).toBe("הכנסות $1K · הוצאות $990");
    expect(hintFigures([["שווי", 123_456_700n]], "USD").short).toBe("שווי $1.23M");
  });
});
