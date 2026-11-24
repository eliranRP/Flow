import { loanOutlooksSchema } from "@flow/shared";
import { describe, expect, it } from "vitest";
import type { LoanDetailDbRow } from "./loan-detail-data";
import { type LoanListRow, withOutlooks } from "./loan-list";
import { loanListSummary } from "./loan-list-summary";
import { summaryEntries } from "./loan-summary-entries";

/** FLOW-1316: what the app makes of `loan_outlooks`: the list's rows, the band's figures, with invented loans. */

const next = (due: string, interest: number, principal: number, escrow = 0) => ({
  due_date: due,
  interest_minor: interest,
  escrow_minor: escrow,
  principal_minor: principal,
  amount_minor: interest + principal + escrow,
});

/** The answer as the database sends it: absent = null, a loan with neither a next payment nor a late date left out. */
const ANSWER = loanOutlooksSchema.parse([
  { loan_id: "a", next: next("2026-12-01", 16_000, 44_000, 5_000), ahead_minor: 780_000, to_end_minor: 5_000_000, end_date: "2034-11-01", late_on: "2026-11-01" },
  { loan_id: "b", next: next("2026-12-15", 8_000, 0), ahead_minor: 96_000, to_end_minor: 1_000_000, end_date: "2027-12-15" },
  // Late with nothing left to pay on a schedule that cannot be built: a late mark, no next payment.
  { loan_id: "d", late_on: "2026-11-10" },
  // USD: its figures never add to the shekel loans'.
  { loan_id: "u", next: next("2026-12-03", 1_000, 2_000), ahead_minor: 36_000 },
]);

const row = (id: string, over: Partial<LoanListRow> = {}): LoanListRow => ({
  id, name: `loan ${id}`, currency: "ILS", balanceMinor: 1_000_000n, flaggedParts: 0, projectId: null, projectName: null, kind: "amortizing", status: "open", closedOn: null, ...over,
});

const ROWS: LoanListRow[] = [
  row("a"),
  row("b", { kind: "interest_only" }),
  // Not in the answer: a demand loan, a closed one, and an open one with no schedule left.
  row("c", { kind: "demand" }),
  row("closed", { status: "closed", closedOn: "2026-01-01" }),
  row("d"),
  row("e"),
  row("u", { currency: "USD" }),
];

describe("withOutlooks", () => {
  const rows = withOutlooks(ROWS, ANSWER);
  const by = (id: string) => rows.find((item) => item.id === id);

  it("gives a loan its next payment with the sum of the parts, and its late mark", () => {
    expect(by("a")?.next).toEqual({ dueDate: "2026-12-01", amountMinor: 65_000n });
    expect(by("a")?.lateOn).toBe("2026-11-01");
    expect(by("b")?.next).toEqual({ dueDate: "2026-12-15", amountMinor: 8_000n });
    expect(by("b")?.lateOn).toBeUndefined();
  });

  it("gives a late loan with no next payment its late mark alone", () => {
    expect(by("d")?.next).toBeUndefined();
    expect(by("d")?.lateOn).toBe("2026-11-10");
  });

  it("leaves a loan the answer lacks without a next payment and a late mark, and keeps every row", () => {
    expect(rows.map((item) => item.id)).toEqual(ROWS.map((item) => item.id));
    for (const id of ["c", "closed", "e"]) {
      expect(by(id)).toEqual(ROWS.find((item) => item.id === id));
      expect(by(id)?.next).toBeUndefined();
      expect(by(id)?.lateOn).toBeUndefined();
    }
    expect(by("closed")?.status).toBe("closed");
    expect(by("c")?.kind).toBe("demand");
  });
});

describe("the band's figures", () => {
  const dbRow = (id: string, over: Partial<LoanDetailDbRow> = {}): LoanDetailDbRow => ({
    id, company_id: "c", name: `loan ${id}`, currency: "ILS", principal_minor: 2_000_000, annual_rate_ppm: 50_000, term_months: 120, start_date: "2024-01-01",
    payment_minor: 60_000, escrow_minor: 0, kind: "amortizing", interest_only_months: null, amortization_months: null, status: "open", closed_on: null,
    project_id: null, interest_category_id: null, escrow_category_id: null, principal_category_id: null, fees_category_id: null, ...over,
  });
  const balance = { balanceMinor: 1_000_000n, flaggedParts: 0 };
  const loans = [
    { row: dbRow("a"), balance },
    { row: dbRow("b"), balance },
    { row: dbRow("c", { kind: "demand", term_months: null, payment_minor: null }), balance },
    { row: dbRow("closed", { status: "closed" }), balance },
    { row: dbRow("d"), balance },
    { row: dbRow("u", { currency: "USD" }), balance },
  ];

  it("sums ahead_minor and the next payments' parts for the currency, and counts every open loan's balance", () => {
    const ils = loanListSummary(summaryEntries(loans, ANSWER), "ILS");
    expect(ils.twelveMonthsMinor).toBe(780_000n + 96_000n);
    expect(ils.monthlyParts).toEqual({ principal: 44_000n, interest: 24_000n, escrow: 5_000n });
    expect(ils.monthlyMinor).toBe(73_000n);
    expect(ils.openCount).toBe(4);
    expect(ils.totalBalanceMinor).toBe(4_000_000n);
    expect(ils.next).toEqual({ lenderName: "loan a", dueDate: "2026-12-01", amountMinor: 65_000n });
  });

  it("reads one currency at a time", () => {
    const usd = loanListSummary(summaryEntries(loans, ANSWER), "USD");
    expect(usd.twelveMonthsMinor).toBe(36_000n);
    expect(usd.openCount).toBe(1);
    expect(usd.next?.amountMinor).toBe(3_000n);
  });

  it("counts a loan the answer lacks, or holds only for a late mark, by its balance alone", () => {
    const none = loanListSummary(summaryEntries(loans, []), "ILS");
    expect(none.openCount).toBe(4);
    expect(none.twelveMonthsMinor).toBe(0n);
    expect(none.next).toBeNull();
    const lateOnly = loanListSummary(summaryEntries(loans, ANSWER.filter((outlook) => outlook.loan_id === "d")), "ILS");
    expect(lateOnly.monthlyMinor).toBe(0n);
  });
});

describe("the answer's shape", () => {
  it("reads amounts as minor units, from numbers or digit strings, and an empty answer", () => {
    const parsed = loanOutlooksSchema.parse([{ loan_id: "x", next: { ...next("2026-12-01", 1, 2), amount_minor: "3" }, ahead_minor: 1_000_000_000_000_000 }]);
    expect(parsed[0]?.next?.amount_minor).toBe(3n);
    expect(parsed[0]?.ahead_minor).toBe(1_000_000_000_000_000n);
    expect(loanOutlooksSchema.parse([])).toEqual([]);
  });

  it("refuses a fraction and a missing part of the next payment", () => {
    expect(loanOutlooksSchema.safeParse([{ loan_id: "x", ahead_minor: 1.5 }]).success).toBe(false);
    expect(loanOutlooksSchema.safeParse([{ loan_id: "x", next: { due_date: "2026-12-01" } }]).success).toBe(false);
  });
});
