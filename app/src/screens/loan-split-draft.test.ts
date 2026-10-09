import { describe, expect, it } from "vitest";
import type { LoanPayment } from "./loan-detail-data";
import type { LoanChoice } from "./loan-match-api";
import { checkExact, exactParts, scheduleParts, schedulePlan, toSaveParts } from "./loan-split-draft";

// 100,000.00 at 6% over 360 months: 599.55 a month, the first row 500.00 interest.
const loan: LoanChoice = {
  id: "loan-1",
  name: "הלוואת דוגמה",
  currency: "ILS",
  principalMinor: 10_000_000,
  annualRatePpm: 60_000,
  termMonths: 360,
  startDate: "2026-02-01",
  paymentMinor: 59_955,
  escrowMinor: 0,
  balanceMinor: 10_000_000n,
};
const line = { transactionId: "txn-1", docDate: "2026-04-01", lineMinor: 180_000n, currency: "ILS" };

function paid(date: string, interest: bigint, principal: bigint): LoanPayment {
  return { transactionId: `p-${date}`, docDate: date, needsReview: false, interestMinor: interest, escrowMinor: 0n, principalMinor: principal, feesMinor: 0n, totalMinor: interest + principal, parts: 3 };
}

describe("loan split editor math (FLOW-106)", () => {
  it("covers one installment by the line's date, and several from the first unpaid row", () => {
    const one = schedulePlan(loan, [], line, 1);
    expect(one?.dates).toBe("01/04/2026");
    expect(one?.maxCount).toBe(12);
    const three = schedulePlan(loan, [], line, 3);
    expect(three?.dates).toBe("01/02–01/04/2026");
    expect(three == null ? null : three.sum.interestMinor + three.sum.principalMinor).toBe(179_865n);
    const after = schedulePlan(loan, [paid("2026-02-01", 50_000n, 9_955n)], line, 2);
    expect(after?.dates).toBe("01/03–01/04/2026");
  });

  it("takes fees off the top, and refuses fees above the line", () => {
    const plan = schedulePlan(loan, [], line, 3);
    if (plan == null) throw new Error("plan");
    const parts = scheduleParts(plan, 180_000n, 135n);
    expect(parts?.map((part) => part.part)).toEqual(["interest", "escrow", "principal", "fees"]);
    expect(parts?.reduce((sum, part) => sum + part.amountMinor, 0n)).toBe(180_000n);
    expect(scheduleParts(plan, 180_000n, 180_001n)).toBeNull();
  });

  it("gives a demand loan its accrued interest and one installment", () => {
    const demand = { ...loan, kind: "demand" as const, termMonths: null, paymentMinor: null };
    const plan = schedulePlan(demand, [], { ...line, docDate: "2026-03-03" }, 5);
    expect(plan?.sum.interestMinor).toBe(49_315n);
    expect(plan?.maxCount).toBe(1);
    expect(plan?.dates).toBeNull();
    expect(schedulePlan(demand, [], { ...line, docDate: "2026-01-01" }, 1)).toBeNull();
  });

  it("checks exact parts against the line, and sends fees only above 0 with their category", () => {
    expect(checkExact({ principal: "1,000", interest: "500" }, 180_000n)).toEqual({ totalMinor: 150_000n, leftMinor: 30_000n, invalid: false });
    expect(checkExact({ principal: "2,000" }, 180_000n).leftMinor).toBe(-20_000n);
    expect(checkExact({ principal: "abc" }, 180_000n).invalid).toBe(true);
    const parts = exactParts({ principal: "1,000", interest: "500", escrow: "", fees: "300" }, schedulePlan(loan, [], line, 1));
    expect(parts.map((part) => [part.part, part.amountMinor])).toEqual([["interest", 50_000n], ["escrow", 0n], ["principal", 100_000n], ["fees", 30_000n]]);
    expect(toSaveParts(parts, "cat-fees").at(-1)).toEqual({ part: "fees", amount_minor: 30_000, scheduled_minor: 30_000, category_id: "cat-fees" });
    expect(exactParts({ principal: "1,800", fees: "0" }, null).map((part) => part.part)).toEqual(["interest", "escrow", "principal"]);
  });
});
