import { describe, expect, it } from "vitest";
import { SAMPLE_AMORTIZING, SAMPLE_BALLOON, SAMPLE_DEMAND, SAMPLE_INTEREST_ONLY, SAMPLE_PAID_OFF } from "../dev/loan-detail-sample";
import { loanOutlook } from "./loan-outlook";
import { type LoanListEntry, loanListSummary } from "./loan-list-summary";
import { LOAN_REFUSALS, loanDeleteConsequence, loanFailure, loanRefusalOf, loanRefusalPlace, loanRefusalText } from "./loan-copy";
import { type LoanPayment } from "./loan-detail-data";
import { type LoanChoice } from "./loan-match-api";
import { checkExact, exactParts, scheduleParts, schedulePlan, toSaveParts } from "./loan-split-draft";

// --- loan-list-summary.test.ts

// FLOW-139: the Loans list's summary card. Invented loans from the dev sample; the expected
// figures are the sample set's literal values at TODAY, so a change to the maths shows here.

const TODAY = "2026-10-16";
const USD = "USD";

function entry(loan: typeof SAMPLE_AMORTIZING, today = TODAY): LoanListEntry {
  return { loan, outlook: loanOutlook(loan, today) };
}

describe("loanListSummary", () => {
  it("counts only open loans and sums their balances", () => {
    const summary = loanListSummary([entry(SAMPLE_AMORTIZING), entry(SAMPLE_INTEREST_ONLY), entry(SAMPLE_PAID_OFF), entry(SAMPLE_DEMAND)], USD);
    expect(summary.openCount).toBe(3);
    expect(summary.totalBalanceMinor).toBe(42_528_904n);
  });

  it("sums each open loan's next payment part by part, as the monthly line", () => {
    const summary = loanListSummary([entry(SAMPLE_AMORTIZING), entry(SAMPLE_INTEREST_ONLY), entry(SAMPLE_BALLOON)], USD);
    expect(summary.monthlyParts).toEqual({ principal: 406_915n, interest: 327_742n, escrow: 36_300n });
    expect(summary.monthlyMinor).toBe(770_957n);
  });

  it("sums the next twelve payments of every open loan", () => {
    const summary = loanListSummary([entry(SAMPLE_AMORTIZING), entry(SAMPLE_INTEREST_ONLY), entry(SAMPLE_BALLOON)], USD);
    expect(summary.twelveMonthsMinor).toBe(28_597_734n);
  });

  it("names the earliest next payment and its loan", () => {
    const summary = loanListSummary([entry(SAMPLE_AMORTIZING), entry(SAMPLE_INTEREST_ONLY), entry(SAMPLE_BALLOON)], USD);
    expect(summary.next).toEqual({ lenderName: "משכנתא דוגמה", dueDate: "2026-11-01", amountMinor: 524_000n });
  });

  it("returns no next payment when no open loan has an outlook", () => {
    const summary = loanListSummary([entry(SAMPLE_PAID_OFF), entry(SAMPLE_DEMAND)], USD);
    expect(summary.next).toBeNull();
    expect(summary.monthlyMinor).toBe(0n);
    expect(summary.twelveMonthsMinor).toBe(0n);
  });

  it("leaves out a loan in another currency, since those amounts do not add", () => {
    const ils = { ...SAMPLE_AMORTIZING, currency: "ILS" as const };
    const summary = loanListSummary([entry(SAMPLE_AMORTIZING), entry(ils)], USD);
    expect(summary.openCount).toBe(1);
    expect(summary.totalBalanceMinor).toBe(17_650_000n);
  });
});
// --- loan-copy.test.ts

const migrations = import.meta.glob<string>("../../../supabase/migrations/*.sql", { query: "?raw", import: "default", eager: true });

/** The body of the newest definition of a function. */
function latestBody(pattern: RegExp): string {
  const names = Object.keys(migrations).sort().reverse();
  for (const name of names) {
    const sql = migrations[name] ?? "";
    const start = sql.search(pattern);
    if (start < 0) continue;
    const body = sql.slice(start);
    const open = body.indexOf("$$");
    const close = body.indexOf("$$", open + 2);
    return body.slice(open, close);
  }
  throw new Error(`not found: ${pattern.source}`);
}

function raised(body: string): string[] {
  return [...new Set([...body.matchAll(/raise exception '([^']+)'/g)].map((match) => match[1] ?? ""))];
}

describe("loan refusal copy (FLOW-106 §5)", () => {
  it("has Hebrew for every reason save_loan_split, delete_loan and restore_loan raise", () => {
    const reasons = [
      ...raised(latestBody(/create (or replace )?function public\.save_loan_split\(/)),
      ...raised(latestBody(/create (or replace )?function public\.delete_loan\(/)),
      ...raised(latestBody(/create (or replace )?function public\.restore_loan\(/)),
      ...raised(latestBody(/create (or replace )?function private\.loan_restore\(/)),
    ];
    expect(reasons.length).toBeGreaterThan(10);
    const known: readonly string[] = LOAN_REFUSALS;
    const missing = [...new Set(reasons)].filter((reason) => !known.includes(reason));
    expect(missing, `no Hebrew copy for: ${missing.join(", ")}`).toEqual([]);
  });

  it("has Hebrew for every loan reason mcp_refused passes through", () => {
    const body = latestBody(/create (or replace )?function private\.mcp_refused\(/);
    const list = /when p_message in \(([\s\S]*?)\) then p_message/.exec(body)?.[1] ?? "";
    const reasons = [...list.matchAll(/'([^']+)'/g)].map((match) => match[1] ?? "");
    const loanish = reasons.filter((reason) => /loan|closed_on|payment|fees|rate before|later payment|fit the loan/.test(reason));
    expect(loanish.length).toBeGreaterThan(10);
    for (const reason of loanish) {
      const copy = loanRefusalOf(new Error(reason));
      expect(copy, `no Hebrew copy for mcp_refused reason: ${reason}`).not.toBeNull();
    }
  });

  it("writes every reason in Hebrew without the code", () => {
    for (const reason of LOAN_REFUSALS) {
      const copy = loanRefusalText(reason);
      expect(copy).toMatch(/[֐-׿]/);
      expect(copy).not.toContain(reason);
    }
  });

  it("names the date, the target and the amounts when it knows them", () => {
    expect(loanRefusalText("loan_closed", { closedOn: "2025-11-30" })).toBe("ההלוואה נסגרה ב־30/11/2025. אפשר לשייך רק תשלומים עד התאריך הזה.");
    expect(loanRefusalText("a loan uses this category for a part the other category cannot take", { target: "עלויות סגירה" }))
      .toBe("הלוואה משתמשת בקטגוריה הזו, ו־עלויות סגירה לא מתאימה לאותו חלק. החליפו קודם את הקטגוריה בהלוואה.");
    expect(loanRefusalText("rate before the loan start", { startDate: "2026-03-01" })).toBe("התאריך לפני תחילת ההלוואה (01/03/2026).");
    expect(loanRefusalText("loan_split_sum", { currency: "USD", lineMinor: 400_000n, missingMinor: 5_000n })).toBe("החלקים צריכים להסתכם ב־$4,000. חסרים $50.");
    expect(loanRefusalText("loan_split_sum", { currency: "USD", overMinor: 1_250n })).toBe("עוברים את השורה ב־$12.50.");
  });

  it("reads the reason from a trigger, a check or an RPC message", () => {
    expect(loanRefusalOf(new Error("loan_payments_after_close"))).toBe("loan_payments_after_close");
    expect(loanRefusalOf(new Error('new row for relation "loans" violates check constraint "loans_kind_chk"'))).toBe("loans_kind_chk");
    expect(loanRefusalOf(new Error('new row for relation "loans" violates check constraint "loans_closed_chk"'))).toBe("loans_closed_chk");
    expect(loanRefusalOf(new Error("loan closed"))).toBe("loan closed");
    expect(loanRefusalOf(new Error("loan cannot be restored"))).toBe("loan cannot be restored");
    expect(loanRefusalOf(Object.assign(new Error("permission denied"), { code: "42501" }))).toBe("forbidden");
    expect(loanRefusalOf(new Error("Failed to fetch"))).toBeNull();
  });

  it("puts each refusal where plan §5 says", () => {
    expect(loanRefusalPlace("loan_payments_after_close")).toBe("status");
    expect(loanRefusalPlace("loan_category_not_allowed")).toBe("category");
    expect(loanRefusalPlace("loan_payment_below_interest")).toBe("kind");
    expect(loanRefusalPlace("rate before the loan start")).toBe("rate");
    expect(loanRefusalPlace("fees category required")).toBe("editor");
    expect(loanRefusalPlace("forbidden")).toBe("toast");
  });

  it("is final for a refusal and offers ניסיון חוזר for a dropped connection", () => {
    expect(loanFailure(Object.assign(new Error("denied"), { code: "42501" }))).toEqual({ message: "אין הרשאה לעדכן הלוואה.", retry: false });
    expect(loanFailure(new Error("Failed to fetch"))).toEqual({ message: "השינוי לא נשמר", retry: true });
  });

  it("says what a delete takes, and counts the payments it sends back (FLOW-962)", () => {
    expect(loanDeleteConsequence(0)).toBe("לוח התשלומים, הצפי ושינויי הריבית שלה יימחקו. אין לה תשלומים משויכים.");
    expect(loanDeleteConsequence(1)).toBe("לוח התשלומים, הצפי ושינויי הריבית שלה יימחקו. התשלום שכבר שויך יישאר בתנועות ויחזור לקטגוריה שלו.");
    expect(loanDeleteConsequence(3)).toBe("לוח התשלומים, הצפי ושינויי הריבית שלה יימחקו. 3 התשלומים שכבר שויכו יישארו בתנועות ויחזרו לקטגוריה שלהם.");
  });
});
// --- loan-split-draft.test.ts

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