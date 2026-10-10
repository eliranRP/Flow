import type { LoanCategory, LoanDetail, LoanPayment } from "../screens/loan-detail-data";
import { memoryLoanStore, type LoanSample, type MemoryLoanStore } from "../screens/loan-detail-store";
import type { LoanProjectChoice } from "../screens/loan-project-picker";

/**
 * FLOW-106 B / FLOW-110. Invented loans for the loan page's stories, the dev e2e route, unit
 * tests and `?preview=1`: no real lenders, amounts or ids.
 */

export const SAMPLE_LOAN_CATEGORIES: LoanCategory[] = [
  { id: "cat-interest", name: "ריבית", kind: "expense", loanPart: "interest", excludedFromPnl: false, hidden: false },
  { id: "cat-escrow", name: "מסים וביטוח", kind: "expense", loanPart: "escrow", excludedFromPnl: false, hidden: false },
  { id: "cat-principal", name: "תשלומי הלוואה", kind: "expense", loanPart: "principal", excludedFromPnl: true, hidden: false },
  { id: "cat-bridge", name: "ריבית הלוואות גישור", kind: "expense", loanPart: null, excludedFromPnl: false, hidden: false },
  { id: "cat-bank", name: "עמלות בנק", kind: "expense", loanPart: null, excludedFromPnl: false, hidden: false },
  { id: "cat-closing", name: "עלויות סגירה", kind: "expense", loanPart: null, excludedFromPnl: true, hidden: false },
  { id: "cat-office", name: "הוצאות משרד", kind: "expense", loanPart: null, excludedFromPnl: false, hidden: false },
  { id: "cat-partner", name: "קרן הלוואות שותפים", kind: "expense", loanPart: null, excludedFromPnl: true, hidden: false },
  { id: "cat-old", name: "ישנה", kind: "expense", loanPart: null, excludedFromPnl: false, hidden: true },
  { id: "cat-rent", name: "שכירות", kind: "income", loanPart: null, excludedFromPnl: false, hidden: false },
];

export const SAMPLE_LOAN_PROJECTS: LoanProjectChoice[] = [
  { id: "proj-a", name: "שיפוץ דוגמה 12", status: "active", code: "P-12" },
  { id: "proj-b", name: "בית דוגמה 9", status: "active", code: "P-9" },
  { id: "proj-c", name: "דירה דוגמה 8", status: "finished", code: "P-3" },
];

const NO_CATEGORIES = { interest: null, escrow: null, principal: null, fees: null };

function payment(id: string, docDate: string, parts: { interest: bigint; escrow?: bigint; principal: bigint; fees?: bigint }, needsReview = false): LoanPayment {
  const escrow = parts.escrow ?? 0n;
  const fees = parts.fees ?? 0n;
  return {
    transactionId: id,
    docDate,
    needsReview,
    interestMinor: parts.interest,
    escrowMinor: escrow,
    principalMinor: parts.principal,
    feesMinor: fees,
    totalMinor: parts.interest + escrow + parts.principal + fees,
    // FLOW-427 (C20-3): as the server data counts them, only the parts with an amount.
    parts: [parts.interest, escrow, parts.principal, fees].filter((minor) => minor !== 0n).length,
  };
}

export const SAMPLE_INTEREST_ONLY: LoanDetail = {
  id: "loan-bridge",
  companyId: "company-sample",
  name: "הלוואת גישור",
  currency: "USD",
  principalMinor: 24_000_000n,
  annualRatePpm: 105_000,
  termMonths: 24,
  startDate: "2026-03-01",
  paymentMinor: 2_115_566n,
  escrowMinor: 0n,
  kind: "interest_only",
  interestOnlyMonths: 12,
  amortizationMonths: null,
  status: "open",
  closedOn: null,
  projectId: "proj-b",
  categoryIds: { interest: "cat-bridge", escrow: null, principal: null, fees: null },
  rates: [
    { id: "rate-2", effectiveDate: "2026-09-01", annualRatePpm: 112_500 },
    { id: "rate-1", effectiveDate: "2026-06-01", annualRatePpm: 107_500 },
  ],
  balanceMinor: 24_000_000n,
  flaggedParts: 0,
};

export const SAMPLE_AMORTIZING: LoanDetail = {
  id: "loan-mortgage",
  companyId: "company-sample",
  name: "משכנתא דוגמה",
  currency: "USD",
  principalMinor: 20_000_000n,
  annualRatePpm: 60_000,
  termMonths: 360,
  startDate: "2025-01-01",
  paymentMinor: 151_240n,
  escrowMinor: 31_330n,
  kind: "amortizing",
  interestOnlyMonths: null,
  amortizationMonths: null,
  status: "open",
  closedOn: null,
  projectId: "proj-a",
  categoryIds: NO_CATEGORIES,
  rates: [],
  balanceMinor: 18_240_955n,
  flaggedParts: 0,
};

export const SAMPLE_BALLOON: LoanDetail = {
  id: "loan-note",
  companyId: "company-sample",
  name: "שטר דוגמה",
  currency: "USD",
  principalMinor: 10_000_000n,
  annualRatePpm: 65_000,
  termMonths: 60,
  startDate: "2026-07-01",
  paymentMinor: 63_207n,
  escrowMinor: 0n,
  kind: "balloon",
  interestOnlyMonths: null,
  amortizationMonths: 360,
  status: "open",
  closedOn: null,
  projectId: null,
  categoryIds: NO_CATEGORIES,
  rates: [],
  balanceMinor: 9_612_040n,
  flaggedParts: 3,
};

export const SAMPLE_DEMAND: LoanDetail = {
  id: "loan-partner",
  companyId: "company-sample",
  name: "הלוואת שותף",
  currency: "USD",
  principalMinor: 4_000_000n,
  annualRatePpm: 60_000,
  termMonths: null,
  startDate: "2025-11-01",
  paymentMinor: null,
  escrowMinor: 0n,
  kind: "demand",
  interestOnlyMonths: null,
  amortizationMonths: null,
  status: "open",
  closedOn: null,
  projectId: null,
  categoryIds: { interest: null, escrow: null, principal: "cat-partner", fees: null },
  rates: [],
  balanceMinor: 3_878_904n,
  flaggedParts: 0,
};

export const SAMPLE_PAID_OFF: LoanDetail = {
  id: "loan-old",
  companyId: "company-sample",
  name: "שטר ישן",
  currency: "USD",
  principalMinor: 5_000_000n,
  annualRatePpm: 70_000,
  termMonths: 36,
  startDate: "2023-07-01",
  paymentMinor: 154_385n,
  escrowMinor: 0n,
  kind: "amortizing",
  interestOnlyMonths: null,
  amortizationMonths: null,
  status: "paid_off",
  closedOn: "2026-06-15",
  projectId: null,
  categoryIds: NO_CATEGORIES,
  rates: [],
  balanceMinor: 124_000n,
  flaggedParts: 0,
};

export const SAMPLE_CLOSED: LoanDetail = {
  id: "loan-closed",
  companyId: "company-sample",
  name: "הלוואת ציוד ישנה",
  currency: "USD",
  principalMinor: 2_000_000n,
  annualRatePpm: 80_000,
  termMonths: 24,
  startDate: "2024-01-01",
  paymentMinor: 90_455n,
  escrowMinor: 0n,
  kind: "amortizing",
  interestOnlyMonths: null,
  amortizationMonths: null,
  status: "closed",
  closedOn: "2025-11-30",
  projectId: null,
  categoryIds: NO_CATEGORIES,
  rates: [],
  balanceMinor: 0n,
  flaggedParts: 0,
};

export function sampleLoans(): LoanSample[] {
  return [
    {
      loan: SAMPLE_INTEREST_ONLY,
      categories: SAMPLE_LOAN_CATEGORIES,
      payments: [
        payment("txn-b3", "2026-10-01", { interest: 225_000n, principal: 0n }),
        payment("txn-b2", "2026-09-01", { interest: 215_000n, principal: 0n }),
        payment("txn-b1", "2026-08-01", { interest: 215_000n, principal: 0n, fees: 26_250n }),
        payment("txn-b0", "2026-07-01", { interest: 215_000n, principal: 0n }),
      ],
    },
    {
      loan: SAMPLE_AMORTIZING,
      categories: SAMPLE_LOAN_CATEGORIES,
      payments: [
        payment("txn-m2", "2026-09-01", { interest: 91_500n, escrow: 31_330n, principal: 28_410n }),
        payment("txn-m1", "2026-08-01", { interest: 91_640n, escrow: 31_330n, principal: 28_270n }),
      ],
    },
    {
      loan: SAMPLE_BALLOON,
      categories: SAMPLE_LOAN_CATEGORIES,
      payments: [
        payment("txn-n2", "2026-10-03", { interest: 52_066n, escrow: 0n, principal: 11_141n }, true),
        payment("txn-n1", "2026-08-11", { interest: 52_066n, escrow: 115_000n, principal: 132_000n, fees: 148_000n }),
      ],
    },
    {
      loan: SAMPLE_DEMAND,
      categories: SAMPLE_LOAN_CATEGORIES,
      payments: [
        payment("txn-d1", "2026-05-01", { interest: 78_904n, principal: 121_096n }),
      ],
    },
    {
      loan: SAMPLE_PAID_OFF,
      categories: SAMPLE_LOAN_CATEGORIES,
      payments: [
        payment("txn-o2", "2026-06-11", { interest: 9_000n, principal: 145_385n }),
        payment("txn-o1", "2026-05-11", { interest: 9_800n, principal: 144_585n }),
      ],
    },
    { loan: SAMPLE_CLOSED, categories: SAMPLE_LOAN_CATEGORIES, payments: [] },
  ];
}

export function sampleLoanStore(options: Parameters<typeof memoryLoanStore>[1] = {}): MemoryLoanStore {
  return memoryLoanStore(sampleLoans(), { projects: SAMPLE_LOAN_PROJECTS, ...options });
}

/** One sample loan in a store of its own, for a story. */
export function oneLoanStore(loanId: string, options: Parameters<typeof memoryLoanStore>[1] = {}): MemoryLoanStore {
  return memoryLoanStore(sampleLoans().filter((sample) => sample.loan.id === loanId), { projects: SAMPLE_LOAN_PROJECTS, ...options });
}

let devStore: MemoryLoanStore | null = null;

/** The dev e2e route's store: the list and the loan page share it, so a delete shows on both. */
export function devLoanStore(): MemoryLoanStore {
  devStore ??= sampleLoanStore({ delayMs: 150 });
  return devStore;
}

/** A fresh dev store, for `?reset=1`. */
export function resetDevLoanStore(): MemoryLoanStore {
  devStore = sampleLoanStore({ delayMs: 150 });
  return devStore;
}

let previewStore: MemoryLoanStore | null = null;

/** `?preview=1`: the Settings preview loans (ids preview-loan-1 and -2) with sample pages. Writes stay in memory. */
export function previewLoanStore(): MemoryLoanStore {
  const [bridge, mortgage] = sampleLoans();
  previewStore ??= memoryLoanStore([
    ...(mortgage ? [{ ...mortgage, loan: { ...SAMPLE_AMORTIZING, id: "preview-loan-1", name: "משכנתא אלון" } }] : []),
    ...(bridge ? [{ ...bridge, loan: { ...SAMPLE_INTEREST_ONLY, id: "preview-loan-2", name: "הלוואת ציוד", currency: "ILS" as const } }] : []),
  ], { projects: SAMPLE_LOAN_PROJECTS });
  return previewStore;
}
