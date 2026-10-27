import { formatAmountText } from "@flow/shared";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { cashMonthName } from "../cash";
import { COMPANY_PROFIT_SAMPLE } from "../dev/company-profit-sample";
import { applyForecastEdits, nextMonthForecast } from "../project-next-month";
import { renderWithProviders } from "../test-render";
import { CompanyProfitScreen } from "./company-profit-screen";

/** FLOW-143 (canvas note spec-fcwide, items 0 and 2): the company profit page's summary rows, next month's card and the chart. */

const NEXT = COMPANY_PROFIT_SAMPLE.next;
if (NEXT == null) throw new Error("the sample has no next month");
const november = cashMonthName("2026-11");

function renderPage(sample = COMPANY_PROFIT_SAMPLE) {
  return renderWithProviders(<CompanyProfitScreen sample={sample} />, { route: "/profit" });
}

/** What each project's צפי page shows, built one project at a time, plus the general costs: the card's sum. */
function perProjectTotals(): { income: bigint; expense: bigint } {
  const reads = NEXT ?? COMPANY_PROFIT_SAMPLE.next;
  if (reads == null) throw new Error("no reads");
  let income = 0n;
  let expense = 0n;
  for (const project of reads.inputs.projects) {
    const forecast = applyForecastEdits(nextMonthForecast({
      projectId: project.project_id,
      currency: "USD",
      today: COMPANY_PROFIT_SAMPLE.today,
      recurring: reads.recurring,
      categoryMonths: { project_id: project.project_id, today: "", this_month: "", months: [], categories: project.categories.map((row) => ({ ...row, group_name: null, this_month_minor: 0, months_seen: 0, expected_minor: null, typical_day: null, flag: null })) },
      loans: reads.loans,
      categories: reads.categories,
    }), reads.inputs.edits.filter((edit) => edit.project_id === project.project_id));
    income += forecast.incomeMinor;
    expense += forecast.expenseMinor;
  }
  // The general costs: payroll and the business insurance, the accountant's and the phone line's averages.
  return { income, expense: expense + 645_000n + 61_200n + 86_500n + 8_400n };
}

describe("the company profit summary (spec-fcwide, item 0)", () => {
  it("is four rows with dividers: income, counted expenses, the month's profit in bold, the year to date", () => {
    renderPage();
    const rows = [...document.querySelectorAll(".ui-cp-card .ui-pp-row")];
    expect(rows.map((row) => row.querySelector(".ui-pp-label")?.textContent)).toEqual(["הכנסות", "הוצאות שנספרות ברווח", "רווח אוקטובר", "רווח מתחילת השנה"]);
    expect(rows.map((row) => row.classList.contains("ui-pp-row-strong"))).toEqual([false, false, true, false]);
    expect(rows[0]?.querySelector(".ui-income")?.textContent).toMatch(/^\+\$24,877/);
    // October is a loss: the signal colour and the minus; the year to date is a profit with its plus.
    expect(rows[2]?.querySelector(".ui-loss")?.textContent).toMatch(/^−\$3,434/);
    expect(rows[3]?.textContent).toContain("+$36,274");
  });

  it("has no bars and no loose year-to-date line under the figure", () => {
    renderPage();
    expect(document.querySelector(".ui-cp-head .ui-pp-bar")).toBeNull();
    expect(screen.queryByText(/^מתחילת השנה/)).toBeNull();
  });
});

describe("the company's next month (spec-fcwide, item 2)", () => {
  it("sits under the summary and before the chips: the card, then the chart", () => {
    renderPage();
    const card = document.querySelector(".ui-cp-head .ui-fc-card");
    const chart = document.querySelector(".ui-cp-head .ui-fc-chart");
    const summary = document.querySelector(".ui-cp-card");
    const chips = document.querySelector(".ui-cp-head .ui-cp-chips");
    if (card == null || chart == null || summary == null || chips == null) throw new Error("missing a part");
    expect(summary.compareDocumentPosition(card)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(card.compareDocumentPosition(chart)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(chart.compareDocumentPosition(chips)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("the card has no link: its grey caption names the projects and the general costs; the net is רווח צפוי", () => {
    renderPage();
    const card = document.querySelector(".ui-cp-head .ui-fc-card");
    if (!(card instanceof HTMLElement)) throw new Error("no card");
    expect(card.tagName).toBe("DIV");
    expect(card.querySelector("a")).toBeNull();
    expect(within(card).getByText(november)).toBeInTheDocument();
    expect(within(card).getByText("5 פרויקטים וכללי")).toBeInTheDocument();
    expect(within(card).getByText("רווח צפוי")).toBeInTheDocument();
    expect(within(card).getByText("6 שכירויות ו־2 הכנסות")).toBeInTheDocument();
    expect(within(card).getByText(`מול ${formatAmountText(2_831_100n, "USD")} באוקטובר`)).toBeInTheDocument();
  });

  it("is the sum of every project's צפי page, the edits included, and the general costs", () => {
    renderPage();
    const { income, expense } = perProjectTotals();
    expect(income).toBe(3_160_000n);
    expect(expense).toBe(2_275_400n);
    const card = document.querySelector(".ui-cp-head .ui-fc-card");
    if (!(card instanceof HTMLElement)) throw new Error("no card");
    expect(card.textContent).toContain(formatAmountText(income, "USD"));
    expect(card.textContent).toContain(formatAmountText(expense, "USD"));
    expect(card.querySelector(".ui-fc-net")?.textContent).toContain(formatAmountText(income - expense, "USD", { plus: true, direction: "income" }));
  });

  it("the chart is the company's six months and the forecast, with no link under it", () => {
    renderPage();
    const chart = screen.getByRole("img", { name: /^הכנסות והוצאות של החברה, מאי עד אוקטובר\. מאי: .*\. צפי נובמבר: הכנסות \$31,600, הוצאות \$22,754$/ });
    expect(chart.querySelectorAll(".ui-fc-month-bars")).toHaveLength(7);
    expect(chart.querySelectorAll(".ui-fc-ahead")).toHaveLength(1);
    const section = chart.closest(".ui-fc-chart");
    expect(within(section as HTMLElement).getByText("הכנסות והוצאות לפי חודש · מאי עד אוקטובר וצפי")).toBeInTheDocument();
    expect(section?.querySelector("a")).toBeNull();
  });

  it("an earlier month shows its own figures only: no card and no chart", () => {
    renderPage({ ...COMPANY_PROFIT_SAMPLE, monthKey: "2026-09" });
    expect(document.querySelector(".ui-fc-block")).toBeNull();
    expect(document.querySelectorAll(".ui-cp-card .ui-pp-row")[2]?.textContent).toContain("רווח ספטמבר");
  });

  it("with nothing expected, the card hides and the chart keeps its months", () => {
    renderPage({ ...COMPANY_PROFIT_SAMPLE, next: { ...NEXT, recurring: [], inputs: { ...NEXT.inputs, projects: [], general: [], edits: [] } } });
    expect(document.querySelector(".ui-fc-card")).toBeNull();
    expect(screen.getByRole("img", { name: /^הכנסות והוצאות של החברה, מאי עד אוקטובר/ })).toBeInTheDocument();
  });
});
