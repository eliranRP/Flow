import type { ExpectedParty, ProjectCategoryMonths } from "@flow/shared";
import { describe, expect, it } from "vitest";
import {
  companyExpenseNote,
  companyForecastCaption,
  companyIncomeNote,
  companyNextMonthForecast,
  type CategoryMonthsRow,
  type CompanyForecastEdit,
  type CompanyNextMonthInputs,
} from "./company-next-month";
import { JUNIPER_NEXT, JUNIPER_NEXT_EDITED, JUNIPER_NEXT_LOAN } from "./dev/project-next-month-sample";
import type { ForecastLoan } from "./project-next-loans";
import { applyForecastEdits, nextMonthForecast, type NextMonthRow } from "./project-next-month";

/**
 * FLOW-143: the company's next month is every project's צפי page summed, edits included, plus the general costs
 * (charges, loans and averages with no project). Invented figures, USD cents, today 11/10/2026.
 */

const TODAY = "2026-10-11";
const JUNIPER = "juniper-ct";
const BIRCH = "birch-ct";
const CATEGORIES = JUNIPER_NEXT.categories ?? [];

function rowsOf(months: ProjectCategoryMonths | null | undefined): CategoryMonthsRow[] {
  return (months?.categories ?? []).map(({ id, name, currency, months_minor }) => ({ id, name, currency, months_minor }));
}

const LOAN = JUNIPER_NEXT_LOAN.loans?.[0] as ForecastLoan;
// A second rental: the first one's charges and months moved to it, so the two projects' figures differ.
const birchRecurring: ExpectedParty[] = JUNIPER_NEXT.expected.recurring.map((party) => ({ ...party, party_id: `b-${party.party_id}`, project_id: BIRCH }));
// The general costs: a payroll charge and the loan with no project, and the accountant's average.
const payroll: ExpectedParty = { ...(JUNIPER_NEXT.expected.recurring[4] as ExpectedParty), direction: "expense", party_id: "s-payroll", name: "משכורות", typical_amount_minor: -645_000n, project_id: null, category_id: "c-7" };
const generalLoan: ForecastLoan = { ...LOAN, id: "l-office", projectId: null };
const accounting: CategoryMonthsRow = { id: "c-4", name: "הנהלת חשבונות", currency: "USD", months_minor: [86_500, 86_500, 86_500, 86_500, 86_500, 86_500] };

const junEdits = (JUNIPER_NEXT_EDITED.edits ?? []).map((edit): CompanyForecastEdit => ({ ...edit, project_id: JUNIPER }));
const INPUTS: CompanyNextMonthInputs = {
  month: "2026-11",
  projects: [
    { project_id: JUNIPER, categories: rowsOf(JUNIPER_NEXT_LOAN.categoryMonths) },
    { project_id: BIRCH, categories: rowsOf(JUNIPER_NEXT.categoryMonths) },
  ],
  general: [accounting],
  edits: junEdits,
};
const RECURRING = [...JUNIPER_NEXT_LOAN.expected.recurring, ...birchRecurring, payroll];
const LOANS = [LOAN, generalLoan];

function company(inputs: CompanyNextMonthInputs = INPUTS, recurring: readonly ExpectedParty[] = RECURRING, loans: readonly ForecastLoan[] = LOANS) {
  return companyNextMonthForecast({ currency: "USD", today: TODAY, recurring, loans, categories: CATEGORIES, inputs });
}

/** A project's צפי page, built from the project's own reads as useNextMonthForecast builds it. */
function projectPage(projectId: string, recurring: readonly ExpectedParty[], months: ProjectCategoryMonths | null | undefined, loans: readonly ForecastLoan[], edits: CompanyForecastEdit[] = []) {
  return applyForecastEdits(nextMonthForecast({ projectId, currency: "USD", today: TODAY, recurring, categoryMonths: months, loans, categories: CATEGORIES }), edits);
}

describe("companyNextMonthForecast", () => {
  it("is the sum of every project's צפי page, with its edits, and the general costs", () => {
    const juniper = projectPage(JUNIPER, JUNIPER_NEXT_LOAN.expected.recurring, JUNIPER_NEXT_LOAN.categoryMonths, [LOAN], junEdits);
    const birch = projectPage(BIRCH, birchRecurring, JUNIPER_NEXT.categoryMonths, []);
    const result = company();
    const general = result.parts.find((part) => part.projectId == null)?.forecast;
    if (general == null) throw new Error("no general part");
    expect(result.incomeMinor).toBe(juniper.incomeMinor + birch.incomeMinor + general.incomeMinor);
    expect(result.expenseMinor).toBe(juniper.expenseMinor + birch.expenseMinor + general.expenseMinor);
    expect(result.netMinor).toBe(result.incomeMinor - result.expenseMinor);
    // Each project's part is exactly its page.
    expect(result.parts.find((part) => part.projectId === JUNIPER)?.forecast).toEqual(juniper);
    expect(result.parts.find((part) => part.projectId === BIRCH)?.forecast).toEqual(birch);
    // The edits count: the repairs change and the added line are in, power and water is out.
    expect(juniper.rows.find((row) => row.key === "avg:repairs")?.minor).toBe(-120_000n);
    expect(juniper.rows.some((row) => row.kind === "added")).toBe(true);
    expect(juniper.rows.some((row) => row.key === "avg:power")).toBe(false);
    // Birch's own rows carry no Juniper edit.
    expect(birch.rows.some((row) => row.kind === "added")).toBe(false);
  });

  it("builds the general costs from the charges, loans and months with no project", () => {
    const general = company().parts.find((part) => part.projectId == null)?.forecast;
    const keys = general?.rows.map((row: NextMonthRow) => row.key) ?? [];
    expect(keys).toContain("rec:expense:s-payroll");
    expect(keys).toContain("avg:c-4");
    // The office loan's interest and escrow, as the loan page has its November payment.
    const project = projectPage(JUNIPER, [], null, [LOAN]);
    const loanRows = general?.rows.filter((row) => row.kind === "loan") ?? [];
    expect(loanRows.map((row) => row.minor)).toEqual(project.rows.filter((row) => row.kind === "loan").map((row) => row.minor));
    expect(general?.rows.find((row) => row.key === "avg:c-4")?.minor).toBe(-86_500n);
  });

  it("adds the figures in invented round numbers", () => {
    const small = company(
      { month: "2026-11", projects: [{ project_id: BIRCH, categories: [] }], general: [accounting], edits: [{ id: "e-1", project_id: BIRCH, kind: "add", row_key: null, category_id: "rent", category_name: "שכירות", direction: "income", amount_minor: 200_000, pace: "once", start_month: "2026-11" }] },
      [payroll],
      [],
    );
    expect(small.incomeMinor).toBe(200_000n);
    expect(small.expenseMinor).toBe(645_000n + 86_500n);
    expect(small.netMinor).toBe(200_000n - 731_500n);
    expect(small.rows.map((row) => row.projectId)).toEqual([BIRCH, null, null]);
  });

  it("counts a project known only by its edit, and leaves out a project with nothing expected", () => {
    const result = company({ ...INPUTS, projects: [...INPUTS.projects, { project_id: "empty", categories: [] }], edits: [...junEdits, { id: "e-new", project_id: "new", kind: "add", row_key: null, category_id: "rent", category_name: "שכירות", direction: "income", amount_minor: 100_000, pace: "once", start_month: "2026-11" }] });
    expect(result.parts.map((part) => part.projectId)).toEqual([BIRCH, JUNIPER, "new", null]);
  });

  it("is in the company's currency only", () => {
    const shekels = companyNextMonthForecast({ currency: "ILS", today: TODAY, recurring: RECURRING, loans: LOANS, categories: CATEGORIES, inputs: { ...INPUTS, edits: [] } });
    expect(shekels.rows).toEqual([]);
    expect(shekels.incomeMinor).toBe(0n);
  });
});

describe("the company card's captions", () => {
  it("names the projects and the general costs", () => {
    const part = (projectId: string | null) => ({ projectId, forecast: JUNIPER_NEXT_LOAN as never });
    expect(companyForecastCaption({ parts: [part("a"), part("b"), part(null)] })).toBe("2 פרויקטים וכללי");
    expect(companyForecastCaption({ parts: [part("a"), part(null)] })).toBe("פרויקט אחד וכללי");
    expect(companyForecastCaption({ parts: [part("a"), part("b")] })).toBe("2 פרויקטים");
    expect(companyForecastCaption({ parts: [part(null)] })).toBe("כללי");
    expect(companyForecastCaption(company())).toBe("2 פרויקטים וכללי");
  });

  it("names rent and other income apart when both are expected, else the project card's caption", () => {
    const rent = (key: string): NextMonthRow => ({ key, kind: "recurring", direction: "income", name: key, date: null, minor: 100n, categoryId: "rent", wasMinor: null, pace: null });
    const other = (key: string): NextMonthRow => ({ ...rent(key), kind: "added", categoryId: "other-income" });
    const cost: NextMonthRow = { ...rent("cost"), direction: "expense", minor: -50n };
    const withProject = (rows: NextMonthRow[]) => ({ rows: rows.map((row) => ({ ...row, projectId: null })) });
    expect(companyIncomeNote(withProject([rent("a"), rent("b"), other("c"), other("d"), cost]), CATEGORIES)).toBe("2 שכירויות ו־2 הכנסות");
    expect(companyIncomeNote(withProject([rent("a"), other("c")]), CATEGORIES)).toBe("שכירות אחת והכנסה אחת");
    expect(companyIncomeNote(withProject([rent("a"), rent("b")]), CATEGORIES)).toBe("2 שכירויות קבועות");
    expect(companyIncomeNote(withProject([cost]), CATEGORIES)).toBe("אין הכנסה צפויה");
    expect(companyIncomeNote(company(), CATEGORIES)).toBe("4 שכירויות קבועות");
  });

  it("sets next month's expenses against this month's so far", () => {
    expect(companyExpenseNote({ expenseMinor: 100n }, "2026-10", 2_506_000n, "USD")).toBe("מול $25,060 באוקטובר");
    expect(companyExpenseNote({ expenseMinor: 0n }, "2026-10", 2_506_000n, "USD")).toBe("אין הוצאות צפויות");
  });
});
