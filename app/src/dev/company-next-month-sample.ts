import type { CategoryRow, ExpectedParty } from "@flow/shared";
import type { CompanyNextMonthInputs, CategoryMonthsRow } from "../company-next-month";
import type { CompanyNextMonthSample } from "../company-next-month-query";

/**
 * FLOW-143 fixture: the company profit page's next month, on the company profit sample's five projects and its
 * general costs (invented names, USD cents), today 11/10/2026, so next month is November. Six rents on three
 * rentals and a recurring client job are expected in, and the flip's owner added a second income line by hand;
 * out, each project's recurring charges and six-month category averages, and the general costs (payroll, the
 * business insurance, the accountant's and the phone line's averages). The repairs average on the duplex is
 * edited down to $400.
 */

function charge(project: string | null, partyId: string, name: string, direction: "income" | "expense", dollars: number, day: number, categoryId: string): ExpectedParty {
  const minor = BigInt(dollars * 100);
  return {
    direction,
    party_id: partyId,
    name,
    currency: "USD",
    typical_amount_minor: direction === "expense" ? -minor : minor,
    typical_day: day,
    months_seen: 6,
    seen_this_month: true,
    project_id: project,
    category_id: categoryId,
    pace: "month",
    next_due_month: "2026-11",
    pays_loan: false,
  };
}

function months(id: string, name: string, dollars: number[]): CategoryMonthsRow {
  return { id, name, currency: "USD", months_minor: dollars.map((value) => value * 100) };
}

function category(id: string, name: string, kind: "expense" | "income" = "expense", loanPart: string | null = null): CategoryRow {
  return { id, name, kind, hidden: false, is_default: false, loan_part: loanPart };
}

const CATEGORIES: CategoryRow[] = [
  category("c-rent", "שכירות", "income"),
  category("c-client-work", "עבודות לקוח", "income"),
  category("c-other-income", "הכנסה אחרת", "income"),
  category("c-interest", "ריבית הלוואות", "expense", "interest"),
  category("c-tax", "מסים וביטוח"),
  category("c-repairs", "תיקונים ותחזוקה"),
  category("c-utilities", "חשמל ומים"),
  category("c-materials", "חומרים"),
  category("c-labour", "עבודה"),
  category("c-payroll", "שכר"),
  category("c-business-insurance", "ביטוח עסק"),
  category("c-accounting", "הנהלת חשבונות"),
  category("c-telecom", "תקשורת"),
];

const RECURRING: ExpectedParty[] = [
  charge("p1", "s-client", "לקוח עבודות", "income", 15_000, 7, "c-client-work"),
  charge("p2", "s-bank-2", "בנק הלוואות", "expense", 1_838, 1, "c-interest"),
  charge("p3", "s-tenant-a", "שוכרת א׳", "income", 1_850, 1, "c-rent"),
  charge("p3", "s-tenant-b", "שוכר ב׳", "income", 2_300, 3, "c-rent"),
  charge("p3", "s-bank-3", "בנק הלוואות", "expense", 1_180, 4, "c-interest"),
  charge("p3", "s-escrow-3", "נאמנות מסים", "expense", 280, 4, "c-tax"),
  charge("p4", "s-tenant-c", "שוכרת ג׳", "income", 1_850, 2, "c-rent"),
  charge("p4", "s-tenant-d", "שוכר ד׳", "income", 1_725, 9, "c-rent"),
  charge("p4", "s-bank-4", "בנק הלוואות", "expense", 920, 7, "c-interest"),
  charge("p4", "s-escrow-4", "נאמנות מסים", "expense", 363, 7, "c-tax"),
  charge("p5", "s-tenant-e", "שוכרת ה׳", "income", 2_100, 5, "c-rent"),
  charge("p5", "s-tenant-f", "שוכר ו׳", "income", 1_975, 6, "c-rent"),
  charge(null, "s-payroll", "משכורות", "expense", 6_450, 2, "c-payroll"),
  charge(null, "s-office-insurance", "ביטוח משרד", "expense", 612, 3, "c-business-insurance"),
];

const INPUTS: CompanyNextMonthInputs = {
  month: "2026-11",
  projects: [
    { project_id: "p1", categories: [] },
    // The flip started in June: its averages are over four months.
    { project_id: "p2", categories: [months("c-materials", "חומרים", [0, 0, 4_800, 4_200, 4_500, 4_500]), months("c-labour", "עבודה", [0, 0, 3_000, 3_600, 3_300, 3_300])] },
    { project_id: "p3", categories: [months("c-repairs", "תיקונים ותחזוקה", [520, 310, 0, 450, 600, 1_046])] },
    { project_id: "p4", categories: [months("c-utilities", "חשמל ומים", [142, 142, 142, 142, 142, 142]), months("c-repairs", "תיקונים ותחזוקה", [1_000, 1_200, 900, 1_475, 1_100, 1_405])] },
    { project_id: "p5", categories: [months("c-utilities", "חשמל ומים", [640, 640, 640, 640, 640, 640])] },
  ],
  general: [months("c-accounting", "הנהלת חשבונות", [865, 865, 865, 865, 865, 865]), months("c-telecom", "תקשורת", [84, 84, 84, 84, 84, 84])],
  edits: [
    { id: "e-repairs", project_id: "p3", kind: "change", row_key: "avg:c-repairs", category_id: null, direction: null, amount_minor: 40_000, pace: "once", start_month: "2026-11" },
    { id: "e-deposit", project_id: "p2", kind: "add", row_key: null, category_id: "c-other-income", category_name: "הכנסה אחרת", direction: "income", amount_minor: 480_000, pace: "once", start_month: "2026-11" },
  ],
};

/** The reads but the company's months, which the profit sample adds (its October is the page's own month). */
export const COMPANY_NEXT_READS: Omit<CompanyNextMonthSample, "months"> = {
  recurring: RECURRING,
  loans: [],
  categories: CATEGORIES,
  inputs: INPUTS,
};
