import { describe, expect, it } from "vitest";
import type { LoanKind } from "@flow/shared";
import { SAMPLE_AMORTIZING, SAMPLE_DEMAND, SAMPLE_INTEREST_ONLY, SAMPLE_LOAN_CATEGORIES, sampleLoanStore } from "../dev/loan-detail-sample";
import {
  closeDateDefault,
  formatRatePpm,
  kindPatch,
  kindValue,
  lastPaymentDate,
  loanParts,
  partCategoryOptions,
  partCategoryValue,
  partDefaultLabel,
  rateInput,
  ratePpmOfInput,
  rateValue,
  readLoanPayments,
  readLoanRow,
  statusPill,
  statusToast,
  type LoanDetailDbRow,
} from "./loan-detail-data";
import { applyPatch, inversePatch, patchColumns } from "./loan-detail-store";
import { groupLoans, loanListHint, loanListHintParts, showsLoanBalance, sortLoans, type LoanListRow } from "./loan-list";

// FLOW-106 B / FLOW-110: the loan page's mappers and rules, without a screen.

function names(ids: readonly { name: string }[]): string[] {
  return ids.map((category) => category.name);
}

describe("partCategoryOptions follows private.loan_part_category_ok", () => {
  it.each([
    // Interest and escrow: any expense, counted or kept out (0166), not keyed to another part,
    // not the keyed default itself.
    ["interest", ["ריבית הלוואות גישור", "עמלות בנק", "עלויות סגירה", "הוצאות משרד", "קרן הלוואות שותפים"]],
    ["escrow", ["ריבית הלוואות גישור", "עמלות בנק", "עלויות סגירה", "הוצאות משרד", "קרן הלוואות שותפים"]],
    // Principal: kept out of the P&L.
    ["principal", ["עלויות סגירה", "קרן הלוואות שותפים"]],
    // Fees: any expense with no part, or the keyed interest category.
    ["fees", ["ריבית", "ריבית הלוואות גישור", "עמלות בנק", "עלויות סגירה", "הוצאות משרד", "קרן הלוואות שותפים"]],
  ] as const)("%s", (part, expected) => {
    expect(names(partCategoryOptions(SAMPLE_LOAN_CATEGORIES, part))).toEqual(expected);
  });

  it("never offers income, and keeps a hidden category only when the loan names it", () => {
    expect(names(partCategoryOptions(SAMPLE_LOAN_CATEGORIES, "fees"))).not.toContain("שכירות");
    expect(names(partCategoryOptions(SAMPLE_LOAN_CATEGORIES, "interest"))).not.toContain("ישנה");
    expect(names(partCategoryOptions(SAMPLE_LOAN_CATEGORIES, "interest", "cat-old"))).toContain("ישנה");
  });

  it("names the default row and the value", () => {
    expect(partDefaultLabel(SAMPLE_LOAN_CATEGORIES, "interest")).toBe("ברירת מחדל · ריבית");
    expect(partDefaultLabel(SAMPLE_LOAN_CATEGORIES, "fees")).toBe("בלי קבועה");
    expect(partDefaultLabel([], "principal")).toBe("ברירת מחדל");
    expect(partCategoryValue(SAMPLE_INTEREST_ONLY, SAMPLE_LOAN_CATEGORIES, "interest")).toBe("ריבית הלוואות גישור");
    expect(partCategoryValue(SAMPLE_INTEREST_ONLY, SAMPLE_LOAN_CATEGORIES, "principal")).toBe("ברירת מחדל · תשלומי הלוואה");
    expect(partCategoryValue(SAMPLE_INTEREST_ONLY, SAMPLE_LOAN_CATEGORIES, "fees")).toBe("לא נקבעה · נבחר בכל תשלום");
  });

  it("drops escrow for a demand loan", () => {
    expect(loanParts(SAMPLE_DEMAND)).toEqual(["interest", "principal", "fees"]);
    expect(loanParts(SAMPLE_AMORTIZING)).toEqual(["interest", "escrow", "principal", "fees"]);
  });
});

describe("rates", () => {
  it("formats ppm with at least two decimals and up to four", () => {
    expect(formatRatePpm(112_500)).toBe("11.25%");
    expect(formatRatePpm(60_000)).toBe("6%");
    expect(formatRatePpm(105_000)).toBe("10.5%");
    expect(formatRatePpm(0)).toBe("0%");
    expect(rateInput(60_000)).toBe("6");
    expect(formatRatePpm(8_250)).toBe("0.825%");
    expect(formatRatePpm(112_042)).toBe("11.2042%");
    expect(rateInput(112_500)).toBe("11.25");
  });

  it("reads a typed percent, and refuses what is not one", () => {
    expect(ratePpmOfInput("11.25")).toBe(112_500);
    expect(ratePpmOfInput(" 6 ")).toBe(60_000);
    expect(ratePpmOfInput("11.2042")).toBe(112_042);
    expect(ratePpmOfInput("11.20421")).toBeNull();
    expect(ratePpmOfInput("101")).toBeNull();
    expect(ratePpmOfInput("abc")).toBeNull();
  });

  it("shows the rate in force and where it comes from", () => {
    expect(rateValue(SAMPLE_INTEREST_ONLY, "2026-10-09")).toBe("11.25% · מ־01/09/2026");
    expect(rateValue(SAMPLE_INTEREST_ONLY, "2026-07-01")).toBe("10.75% · מ־01/06/2026");
    expect(rateValue(SAMPLE_INTEREST_ONLY, "2026-04-01")).toBe("10.5% · מההתחלה");
  });
});

describe("kinds", () => {
  it("names each kind with its months", () => {
    expect(kindValue(SAMPLE_AMORTIZING)).toBe("רגילה · 360 חודשים");
    expect(kindValue(SAMPLE_INTEREST_ONLY)).toBe("ריבית בלבד · 6 מתוך 24 חודשים");
    expect(kindValue({ kind: "balloon", termMonths: 60, interestOnlyMonths: null, amortizationMonths: 360 })).toBe("בלון · פריסה 360, נגמרת אחרי 60");
    expect(kindValue(SAMPLE_DEMAND)).toBe("לפי דרישה · ריבית יומית, 365 יום");
  });

  /** The same rule as loans_kind_chk, so a patch the sheet sends never trips it. */
  function passesKindCheck(patch: { kind: LoanKind; interest_only_months: number | null; amortization_months: number | null; term_months: number | null; payment_minor: number | null; escrow_minor: number }): boolean {
    switch (patch.kind) {
      case "amortizing":
        return patch.term_months != null && patch.payment_minor != null && patch.interest_only_months == null && patch.amortization_months == null;
      case "interest_only":
        return patch.term_months != null && patch.payment_minor != null && patch.interest_only_months != null
          && patch.interest_only_months >= 1 && patch.interest_only_months <= patch.term_months && patch.amortization_months == null;
      case "balloon":
        return patch.term_months != null && patch.payment_minor != null && patch.amortization_months != null
          && patch.amortization_months >= patch.term_months && patch.amortization_months <= 600 && patch.interest_only_months == null;
      case "demand":
        return patch.term_months == null && patch.payment_minor == null && patch.escrow_minor === 0
          && patch.interest_only_months == null && patch.amortization_months == null;
    }
  }

  it.each([
    ["amortizing", ""],
    ["interest_only", "24"],
    ["balloon", "360"],
    ["demand", ""],
  ] as const)("writes a %s patch that loans_kind_chk takes", (kind, months) => {
    const result = kindPatch(SAMPLE_AMORTIZING, { kind, months });
    expect(result.ok).toBe(true);
    if (result.ok) expect(passesKindCheck(result.patch)).toBe(true);
  });

  it("refuses months out of range before the server does", () => {
    expect(kindPatch(SAMPLE_AMORTIZING, { kind: "interest_only", months: "0" })).toEqual({ ok: false, error: "months" });
    expect(kindPatch(SAMPLE_AMORTIZING, { kind: "interest_only", months: "361" })).toEqual({ ok: false, error: "months" });
    expect(kindPatch(SAMPLE_AMORTIZING, { kind: "balloon", months: "359" })).toEqual({ ok: false, error: "months" });
    expect(kindPatch(SAMPLE_AMORTIZING, { kind: "balloon", months: "601" })).toEqual({ ok: false, error: "months" });
    expect(kindPatch(SAMPLE_DEMAND, { kind: "amortizing", months: "" })).toEqual({ ok: false, error: "term" });
  });

  it("stores the regular payment after the interest-only months, above a month of interest", () => {
    const result = kindPatch(SAMPLE_AMORTIZING, { kind: "interest_only", months: "24" });
    if (!result.ok) throw new Error("refused");
    // $200,000 at 6.00% for a month is $1,000; the payment_below_interest guard needs at least that, plus escrow.
    expect(result.patch.payment_minor).toBeGreaterThan(100_000 + 31_330);
    expect(result.patch.escrow_minor).toBe(31_330);
  });
});

describe("status", () => {
  const payments = readLoanPayments([
    { transaction_id: "t1", doc_date: "2026-08-01", interest_minor: 100, escrow_minor: 0, principal_minor: 50, fees_minor: 0 },
    { transaction_id: "t2", doc_date: "2026-10-01", interest_minor: 100, escrow_minor: 0, principal_minor: 50, fees_minor: 25, needs_review: true },
  ]);

  it("reads payments newest first, with 4 parts when there are fees", () => {
    expect(payments.map((payment) => payment.transactionId)).toEqual(["t2", "t1"]);
    expect(payments[0]).toMatchObject({ parts: 4, totalMinor: 175n, needsReview: true });
    expect(payments[1]).toMatchObject({ parts: 3, totalMinor: 150n, needsReview: false });
    expect(readLoanPayments(null)).toEqual([]);
    expect(readLoanPayments([{ doc_date: "2026-01-01" }, "x"])).toEqual([]);
  });

  it("floors the close date at the last payment and opens on it", () => {
    expect(lastPaymentDate(payments)).toBe("2026-10-01");
    expect(lastPaymentDate([])).toBeNull();
    expect(closeDateDefault({ closedOn: null }, payments, "2026-10-09")).toBe("2026-10-01");
    expect(closeDateDefault({ closedOn: null }, [], "2026-10-09")).toBe("2026-10-09");
    expect(closeDateDefault({ closedOn: "2026-06-15" }, payments, "2026-10-09")).toBe("2026-06-15");
  });

  it("says what is left when a paid-off loan still has a balance", () => {
    expect(statusToast("paid_off", 24_000_000n, "USD")).toBe("סומנה כנפרעה · נשארה יתרה $240,000 בספרים");
    expect(statusToast("paid_off", 0n, "USD")).toBe("סומנה כנפרעה");
    expect(statusToast("closed", 5n, "USD")).toBe("סומנה כנסגרה");
    expect(statusToast("open", 0n, "USD")).toBe("ההלוואה נפתחה מחדש");
    expect(statusPill({ status: "paid_off", closedOn: "2026-06-15" })).toBe("נפרעה · 15/06/2026");
    expect(statusPill({ status: "open", closedOn: null })).toBe("פתוחה");
  });
});

describe("the loan row and its patches", () => {
  const row: LoanDetailDbRow = {
    id: "l1",
    company_id: "c1",
    name: "הלוואה",
    currency: "USD",
    principal_minor: 100_000,
    annual_rate_ppm: 60_000,
    term_months: 12,
    start_date: "2026-01-01",
    payment_minor: 8_607,
    escrow_minor: 0,
    kind: "amortizing",
    interest_only_months: null,
    amortization_months: null,
    status: "open",
    closed_on: null,
    project_id: null,
    interest_category_id: "cat-bridge",
    escrow_category_id: null,
    principal_category_id: null,
    fees_category_id: null,
    loan_rates: [
      { id: "r1", effective_date: "2026-03-01", annual_rate_ppm: 70_000 },
      { id: "r2", effective_date: "2026-06-01", annual_rate_ppm: 80_000 },
    ],
  };

  it("reads rates newest first and a missing balance as the principal", () => {
    const loan = readLoanRow(row, null);
    expect(loan.rates.map((rate) => rate.id)).toEqual(["r2", "r1"]);
    expect(loan.balanceMinor).toBe(100_000n);
    expect(loan.categoryIds).toEqual({ interest: "cat-bridge", escrow: null, principal: null, fees: null });
    expect(readLoanRow(row, { balanceMinor: 5n, flaggedParts: 2 })).toMatchObject({ balanceMinor: 5n, flaggedParts: 2 });
  });

  it("writes only the columns a patch names, and its inverse puts them back", () => {
    const loan = readLoanRow(row, null);
    const patch = { status: "paid_off" as const, closedOn: "2026-10-01", categoryIds: { fees: "cat-bank" } };
    expect(patchColumns(patch)).toEqual({ status: "paid_off", closed_on: "2026-10-01", fees_category_id: "cat-bank" });
    const changed = applyPatch(loan, patch);
    expect(changed).toMatchObject({ status: "paid_off", closedOn: "2026-10-01", categoryIds: { interest: "cat-bridge", fees: "cat-bank" } });
    expect(applyPatch(changed, inversePatch(loan, patch))).toEqual(loan);
  });

  it("undoes a write on the memory store", async () => {
    const store = sampleLoanStore();
    const before = store.read("loan-mortgage");
    if (before.phase !== "ready") throw new Error("missing");
    const patch = { projectId: "proj-b" };
    await store.update("loan-mortgage", patch);
    expect(store.read("loan-mortgage")).toMatchObject({ bundle: { loan: { projectId: "proj-b" } } });
    await store.update("loan-mortgage", inversePatch(before.bundle.loan, patch));
    expect(store.read("loan-mortgage")).toMatchObject({ bundle: { loan: { projectId: "proj-a" } } });
  });

  it("refuses a close date before the last payment on the memory store, like the trigger", async () => {
    const store = sampleLoanStore();
    await expect(store.update("loan-bridge", { status: "paid_off", closedOn: "2026-09-30" })).rejects.toThrow("loan_payments_after_close");
  });

  it("deletes and restores a loan", async () => {
    const store = sampleLoanStore();
    const gone = await store.deleteLoan("loan-mortgage");
    expect(gone.payments).toBe(2);
    expect(store.read("loan-mortgage").phase).toBe("missing");
    await store.restoreLoan("loan-mortgage");
    expect(store.read("loan-mortgage").phase).toBe("ready");
  });
});

describe("the list", () => {
  const rows: LoanListRow[] = [
    { id: "b", name: "בית", currency: "USD", balanceMinor: 1n, flaggedParts: 0, projectId: null, projectName: "פרויקט א", kind: "interest_only" },
    { id: "a", name: "אלון", currency: "USD", balanceMinor: 1n, flaggedParts: 2, projectId: null, projectName: null },
    { id: "c", name: "גשר", currency: "USD", balanceMinor: 0n, flaggedParts: 0, projectId: null, projectName: null, status: "closed", closedOn: "2025-11-30" },
    { id: "d", name: "דקל", currency: "USD", balanceMinor: 0n, flaggedParts: 0, projectId: null, projectName: null, status: "paid_off", closedOn: null },
  ];

  it("keeps loans alphabetical and puts paid-off and closed ones in their own group", () => {
    expect(sortLoans(rows).map((row) => row.name)).toEqual(["אלון", "בית", "גשר", "דקל"]);
    const { open, closed } = groupLoans(rows);
    expect(open.map((row) => row.id)).toEqual(["a", "b"]);
    expect(closed.map((row) => row.id)).toEqual(["c", "d"]);
  });

  it("hints the kind and project, a review, or how and when a loan ended", () => {
    expect(loanListHint(rows[0] as LoanListRow)).toBe("ריבית בלבד · פרויקט א");
    expect(loanListHint(rows[1] as LoanListRow)).toBe("ממתין לבדיקה");
    expect(loanListHint(rows[2] as LoanListRow)).toBe("נסגרה · 30/11/2025");
    expect(loanListHint(rows[3] as LoanListRow)).toBe("נפרעה");
    expect(loanListHint({ ...(rows[0] as LoanListRow), kind: "amortizing", projectName: null })).toBeUndefined();
  });

  it("hides the balance of a paid-off loan and of a closed loan with nothing owed (FLOW-138)", () => {
    expect(rows.map((row) => showsLoanBalance(row))).toEqual([true, true, false, false]);
    expect(showsLoanBalance({ ...(rows[2] as LoanListRow), balanceMinor: 1200n })).toBe(true);
  });

  it("leads with ממתין לבדיקה, so a narrow row drops the kind and keeps the warning in words (FLOW-347)", () => {
    expect(loanListHintParts({ ...(rows[0] as LoanListRow), flaggedParts: 2 })).toEqual(["ממתין לבדיקה", "ריבית בלבד"]);
    expect(loanListHintParts(rows[0] as LoanListRow)).toEqual(["ריבית בלבד", "פרויקט א"]);
  });
});
