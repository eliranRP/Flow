import { describe, expect, it } from "vitest";
import { SAMPLE_AMORTIZING, SAMPLE_CLOSED, SAMPLE_INTEREST_ONLY } from "../dev/loan-detail-sample";
import type { LoanDetail, LoanPayment } from "./loan-detail-data";
import { loanMonthRange, loanPaidCard, loanPaidParts, loansMonth, loansPaid, paidMoney, percentOf } from "./loans-paid";

const TODAY = "2026-10-17";

function pay(docDate: string, parts: { principal?: bigint; interest?: bigint; escrow?: bigint; fees?: bigint }): LoanPayment {
  const principalMinor = parts.principal ?? 0n;
  const interestMinor = parts.interest ?? 0n;
  const escrowMinor = parts.escrow ?? 0n;
  const feesMinor = parts.fees ?? 0n;
  return { transactionId: `txn-${docDate}`, docDate, needsReview: false, principalMinor, interestMinor, escrowMinor, feesMinor, totalMinor: principalMinor + interestMinor + escrowMinor + feesMinor, parts: 3 };
}

/** $100,000 lent, $90,000 left: $10,000 paid off since the start, $1,000 of it this year. */
const LOAN: LoanDetail = { ...SAMPLE_AMORTIZING, id: "loan-a", name: "אלון", principalMinor: 10_000_000n, balanceMinor: 9_000_000n, startDate: "2025-03-01" };
const PAYMENTS = [
  pay("2026-02-01", { principal: 50_000n, interest: 40_000n, escrow: 10_000n }),
  pay("2026-01-01", { principal: 50_000n, interest: 40_000n, escrow: 10_000n }),
  pay("2025-12-01", { principal: 50_000n, interest: 41_000n, escrow: 10_000n }),
];

describe("loanPaidParts", () => {
  it("counts the principal since the start as the original less today's balance, and the rest from the splits", () => {
    expect(loanPaidParts(LOAN, PAYMENTS, "all", "2026")).toEqual({
      totals: { principal: 1_000_000n, interest: 121_000n, escrow: 30_000n, fees: 0n },
      payments: 3,
    });
  });

  it("counts this year's principal from the year's payments", () => {
    expect(loanPaidParts(LOAN, PAYMENTS, "year", "2026").totals).toEqual({ principal: 100_000n, interest: 80_000n, escrow: 20_000n, fees: 0n });
  });

  it("never counts a negative principal when the balance is above the original", () => {
    expect(loanPaidParts({ principalMinor: 100n, balanceMinor: 150n }, [], "all", "2026").totals.principal).toBe(0n);
  });
});

describe("loansPaid", () => {
  const BRIDGE: LoanDetail = { ...SAMPLE_INTEREST_ONLY, id: "loan-b", name: "גפן", currency: "USD", principalMinor: 5_000_000n, balanceMinor: 5_000_000n, startDate: "2026-04-01" };
  const entries = [
    { loan: LOAN, payments: PAYMENTS },
    { loan: BRIDGE, payments: [pay("2026-05-01", { interest: 30_000n })] },
    { loan: { ...SAMPLE_CLOSED, currency: "USD" as const, closedOn: "2026-08-31" }, payments: [pay("2026-08-01", { principal: 999_900n })] },
  ];

  it("sums the open loans since the start: the original debt, what is left and what was paid off", () => {
    const summary = loansPaid(entries, "USD", "all", TODAY);
    expect(summary.openCount).toBe(2);
    expect(summary.sub).toBe("2 פעילות · מאז 03/2025, ההלוואה הראשונה");
    expect(summary.startLabel).toBe("החוב בהתחלה");
    expect(summary.startMinor).toBe(15_000_000n);
    expect(summary.leftMinor).toBe(14_000_000n);
    expect(summary.repaidMinor).toBe(1_000_000n);
    expect(summary.repaidLabel).toBe("נפרע מהקרן · 7%");
    expect(summary.totals).toEqual({ principal: 1_000_000n, interest: 151_000n, escrow: 30_000n, fees: 0n });
    expect(summary.totalMinor).toBe(1_181_000n);
    expect(summary.note).toBe("הריבית היא מה שההלוואות עלו: $1,510 עד היום. נאמנות (escrow) הולכת למסים ולביטוח של הנכס.");
  });

  it("opens the year on the debt of 1 January: today's balance plus the principal paid this year", () => {
    const summary = loansPaid(entries, "USD", "year", TODAY);
    expect(summary.sub).toBe("2 פעילות · מ־01/01/2026 עד היום");
    expect(summary.startLabel).toBe("החוב ב־01/01/2026");
    expect(summary.startMinor).toBe(14_100_000n);
    expect(summary.repaidMinor).toBe(100_000n);
    expect(summary.repaidLabel).toBe("נפרע השנה מהקרן · 1%");
    expect(summary.totalLabel).toBe("שולם ב־2026");
    expect(summary.totalMinor).toBe(230_000n);
  });

  it("lists each open loan with what it paid and how much of its principal is paid off", () => {
    const summary = loansPaid(entries, "USD", "all", TODAY);
    expect(summary.loans.map((loan) => [loan.id, loan.paidMinor, loan.meta, loan.percent])).toEqual([
      ["loan-a", 1_151_000n, "נשאר $90,000 · נפרע 10%", 10],
      ["loan-b", 30_000n, "נשאר $50,000 · ריבית בלבד", 0],
    ]);
  });

  it("leaves a closed loan out of the sums and names it in one line", () => {
    const all = loansPaid(entries, "USD", "all", TODAY);
    expect(all.loans.some((loan) => loan.id === SAMPLE_CLOSED.id)).toBe(false);
    expect(all.closed).toEqual({ title: `נסגרה · ${SAMPLE_CLOSED.name}`, note: "נסגרה ב־08/2026 · לא בסכומים למעלה, אפשר לראות אותה ברשימת הנסגרות" });
    expect(loansPaid(entries, "USD", "year", TODAY).closed?.note).toBe("נסגרה ב־08/2026 · לא בסכומים למעלה");
  });

  it("shows a loan with no saved splits by its principal alone, and says so", () => {
    const summary = loansPaid([{ loan: LOAN, payments: [] }], "USD", "all", TODAY);
    expect(summary.loans[0]?.paidMinor).toBe(1_000_000n);
    expect(summary.loans[0]?.meta).toBe("נשאר $90,000 · נפרע 10% · רק קרן, אין פיצול");
  });

  it("leaves loans in another currency out", () => {
    expect(loansPaid(entries, "ILS", "all", TODAY).openCount).toBe(0);
  });
});

describe("loanPaidCard", () => {
  it("labels the period and notes what the interest cost", () => {
    expect(loanPaidCard(LOAN, PAYMENTS, "all", TODAY)).toMatchObject({ label: "שולם מאז 03/2025", totalMinor: 1_151_000n, note: "הריבית היא מה שההלוואה עלתה עד היום." });
    expect(loanPaidCard(LOAN, PAYMENTS, "year", TODAY)).toMatchObject({ label: "שולם ב־2026", totalMinor: 200_000n, note: "הריבית היא מה שההלוואה עלתה השנה." });
  });

  it("says so when nothing was attached, and shows the principal paid off alone", () => {
    expect(loanPaidCard(LOAN, [], "all", TODAY)).toMatchObject({ totalMinor: 1_000_000n, note: "אין עדיין תשלומים משויכים: רק הקרן שנפרעה, בלי ריבית ונאמנות." });
  });
});

describe("paidMoney and percentOf", () => {
  it("keeps cents only when there are some", () => {
    expect(paidMoney(551_250n, "USD")).toBe("$5,512.50");
    expect(paidMoney(8_720_000n, "USD")).toBe("$87,200");
  });

  it("rounds a share to whole percent, 0 with no whole", () => {
    expect(percentOf(6_350_000n, 24_000_000n)).toBe(26);
    expect(percentOf(1n, 0n)).toBe(0);
  });
});

// FLOW-1075: one month of the open loans' payments.
describe("loansMonth", () => {
  const OTHER: LoanDetail = { ...SAMPLE_INTEREST_ONLY, id: "loan-b", name: "ברוש", currency: LOAN.currency };
  const entries = [
    { loan: LOAN, payments: PAYMENTS },
    { loan: OTHER, payments: [pay("2026-02-15", { interest: 30_000n, fees: 5_000n }), pay("2026-01-15", { interest: 30_000n })] },
  ];

  it("sums the month's parts over the open loans and lists each payment, newest first", () => {
    const month = loansMonth(entries, LOAN.currency, "2026-02");
    expect(month.title).toBe("פברואר 2026");
    expect(month.totalLabel).toBe("שולם בפברואר 2026");
    expect(month.totals).toEqual({ principal: 50_000n, interest: 70_000n, escrow: 10_000n, fees: 5_000n });
    expect(month.totalMinor).toBe(135_000n);
    expect(month.payments.map((row) => [row.loanName, row.date])).toEqual([["ברוש", "15/02"], ["אלון", "01/02"]]);
    expect(month.payments[1]?.hint).toContain("נאמנות");
  });

  it("compares with the month before, naming the year when it changes", () => {
    expect(loansMonth(entries, LOAN.currency, "2026-02")).toMatchObject({ compareLabel: "לעומת ינואר", deltaMinor: 5_000n });
    expect(loansMonth(entries, LOAN.currency, "2026-01")).toMatchObject({ compareLabel: "לעומת דצמבר 2025", deltaMinor: 29_000n });
  });

  it("says so for a month with no payments", () => {
    const month = loansMonth(entries, LOAN.currency, "2026-05");
    expect(month.totalMinor).toBe(0n);
    expect(month.payments).toEqual([]);
    expect(month.note).toBe("אין תשלומים במאי 2026.");
  });

  it("steps from the first month with a payment to this month, opening on the latest month with one", () => {
    expect(loanMonthRange(entries, LOAN.currency, TODAY)).toEqual({ first: "2025-12", last: "2026-10", start: "2026-02" });
    expect(loanMonthRange([], LOAN.currency, TODAY)).toEqual({ first: "2026-10", last: "2026-10", start: "2026-10" });
  });

  it("leaves closed loans out", () => {
    const closed = { loan: { ...SAMPLE_CLOSED, currency: LOAN.currency }, payments: [pay("2026-02-20", { principal: 99_000n })] };
    expect(loansMonth([...entries, closed], LOAN.currency, "2026-02").totalMinor).toBe(135_000n);
  });
});
