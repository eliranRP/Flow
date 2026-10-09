import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { allocateLoanSplitWithFees, type LoanKind, type LoanRate, type LoanSplitPart, type LoanStatus, type TransactionLoanSplit } from "@flow/shared";
import { getSupabase } from "../lib/supabase";
import { assertNoError, type WriteFailure } from "../use-write";

/**
 * FLOW-114. Every query a loan match, a split edit or an unmatch changes: the split itself,
 * the loan balances, the card, the lists that show a line's category (review, search), and the
 * P&L reads (Home, the project page and its category lines, the breakdowns and the months).
 */
export const LOAN_WRITE_KEYS = [
  "loan-split",
  "line-split-loan",
  "loans",
  "txn",
  "review",
  "search",
  "dashboard",
  "project",
  "project-category",
  "breakdown",
  "breakdown-lines",
  "profit-months",
];

export type SplitRow = {
  id: string;
  part: LoanSplitPart;
  amountMinor: bigint;
  scheduledMinor: bigint;
  needsReview: boolean;
  loanId: string;
  /** From get_loan_split. Null when the P&L counts the whole line, not this part. */
  inPnl?: boolean | null;
};

export type LoanChoice = {
  id: string;
  name: string;
  currency: string;
  principalMinor: number;
  annualRatePpm: number;
  /** Null for a demand loan only (decision 0132). */
  termMonths: number | null;
  startDate: string;
  /** Null for a demand loan only. */
  paymentMinor: number | null;
  escrowMinor: number;
  balanceMinor: bigint;
  /** Missing reads as amortizing. */
  kind?: LoanKind;
  interestOnlyMonths?: number | null;
  amortizationMonths?: number | null;
  rates?: readonly LoanRate[];
  status?: LoanStatus;
  closedOn?: string | null;
  /** The loan's own category per part (decision 0128). A missing one uses the keyed default. */
  categoryIds?: Partial<Record<LoanSplitPart, string | null>>;
};

export type LoadedMatch = {
  companyId: string;
  lineMinor: bigint;
  currency: string;
  splits: SplitRow[];
  byParts: boolean;
  loans: LoanChoice[];
  categoryIds: Partial<Record<LoanSplitPart, string>>;
};

/** One part as save_loan_split takes it. Any part may name its category (decisions 0128, 0130). */
export type SavePart = {
  part: LoanSplitPart;
  amount_minor: number;
  scheduled_minor: number;
  category_id?: string;
};

/** The stored parts the split sheet needs to save: scheduled figures and each part's category. */
export type StoredSplit = {
  lineMinor: bigint;
  currency: string;
  /** Null when the loan could not be read; the sheet then uses the line's currency. */
  loanCurrency: string | null;
  parts: Array<{ part: LoanSplitPart; amountMinor: bigint; scheduledMinor: bigint; categoryId: string | null; needsReview: boolean }>;
};

/** What clear_loan_split returns: the loan and the parts it removed (decision 0136). */
export type ClearedSplit = {
  loanId: string;
  parts: Array<{ part: LoanSplitPart; amount_minor: number; scheduled_minor: number; category_id: string | null; needs_review: boolean }>;
};

export type LoanMatchApi = {
  /** The match offer: the line, its loans and the keyed categories. `known` skips the split reads. */
  read: (transactionId: string, known: boolean) => Promise<LoadedMatch>;
  /** The split sheet's read, only when it opens. */
  readStored: (transactionId: string) => Promise<StoredSplit>;
  /** One save_loan_split call: a new match, an edit, or an undo of an unmatch. */
  save: (transactionId: string, loanId: string, parts: SavePart[]) => Promise<void>;
  /** One clear_loan_split call. */
  clear: (transactionId: string) => Promise<ClearedSplit>;
};

/** Sample stories hold the split locally, so a save or an unmatch shows on the card. */
type LoanMatchSample = { split: TransactionLoanSplit | null };

type LoanMatchContextValue = { api: LoanMatchApi; sample: LoanMatchSample | null };

export const liveLoanMatchApi: LoanMatchApi = {
  read: readLoanMatch,
  readStored: readStoredSplit,
  save: async (transactionId, loanId, parts) => {
    const supabase = getSupabase();
    if (!supabase) throw new Error("supabase");
    assertNoError(await supabase.rpc("save_loan_split", {
      p_transaction_id: transactionId,
      p_loan_id: loanId,
      p_parts: parts,
    }));
  },
  clear: async (transactionId) => {
    const supabase = getSupabase();
    if (!supabase) throw new Error("supabase");
    const result = await supabase.rpc("clear_loan_split", { p_transaction_id: transactionId });
    assertNoError(result);
    return parseCleared(result.data);
  },
};

const LoanMatchContext = createContext<LoanMatchContextValue>({ api: liveLoanMatchApi, sample: null });

export function useLoanMatchContext(): LoanMatchContextValue {
  return useContext(LoanMatchContext);
}

/** The split the card shows: the sample's own state in a story, else what get_transaction sent. */
export function useLoanSplitView(server: TransactionLoanSplit | null | undefined): TransactionLoanSplit | null | undefined {
  const { sample } = useLoanMatchContext();
  return sample ? sample.split : server;
}

/**
 * A story's loan match: the api answers from sample data, and a save or an unmatch updates the
 * split the card reads. Invented data only.
 */
export function LoanMatchSampleProvider({
  api,
  initial,
  loanNames,
  children,
}: {
  api: LoanMatchApi;
  initial: TransactionLoanSplit | null;
  loanNames: Record<string, string>;
  children: ReactNode;
}) {
  const [split, setSplit] = useState<TransactionLoanSplit | null>(initial);
  const value = useMemo<LoanMatchContextValue>(() => ({
    sample: { split },
    api: {
      ...api,
      save: async (transactionId, loanId, parts) => {
        await api.save(transactionId, loanId, parts);
        setSplit({
          loan_id: loanId,
          loan_name: loanNames[loanId] ?? null,
          needs_review: false,
          by_parts: true,
          parts: parts.map((part) => ({ part: part.part, amount_minor: BigInt(part.amount_minor), in_pnl: part.part !== "principal" })),
        });
      },
      clear: async (transactionId) => {
        const cleared = await api.clear(transactionId);
        setSplit(null);
        return cleared;
      },
    },
  }), [api, loanNames, split]);
  return <LoanMatchContext.Provider value={value}>{children}</LoanMatchContext.Provider>;
}

/** The card's split from the offer read, for a server that does not send loan_split yet. */
export function splitFromLoaded(loaded: LoadedMatch | undefined): TransactionLoanSplit | null | undefined {
  if (loaded == null) return undefined;
  if (loaded.splits.length === 0) return null;
  const loanId = loaded.splits[0]?.loanId ?? "";
  return {
    loan_id: loanId,
    loan_name: loaded.loans.find((loan) => loan.id === loanId)?.name ?? null,
    needs_review: loaded.splits.some((part) => part.needsReview),
    by_parts: loaded.byParts,
    parts: loaded.splits.map((part) => ({ part: part.part, amount_minor: part.amountMinor, in_pnl: part.inPnl ?? null })),
  };
}

function code(error: Error): string | undefined {
  return (error as { code?: string }).code;
}

/** The server's refusals of a split save, as save_loan_split raises them (20261010120000). */
export function loanSaveFailureText(error: Error, fallback = "לא הצלחנו לשמור את הפיצול."): string {
  const message = error.message;
  if (code(error) === "42501" || message.includes("forbidden")) return "אין הרשאה לעדכן את הפיצול.";
  if (message.includes("loan balance exceeded") || message.includes("loan_split_balance") || message === "loan_split_over_balance") {
    return "התשלום גבוה מיתרת ההלוואה.";
  }
  if (message.includes("invalid loan parts") || message.includes("loan_split_sum")) return "הפיצול לא מסתכם לשורה.";
  if (message.includes("loan currency mismatch") || message.includes("loan_split_currency")) return "המטבע של השורה לא מתאים להלוואה.";
  if (message.includes("loan closed") || message.includes("loan_closed")) return "ההלוואה נסגרה לפני תאריך התשלום.";
  if (message.includes("loan already attached")) return "התשלום כבר שויך להלוואה אחרת.";
  if (message.includes("fees category required")) return "חסרה קטגוריה לעמלות.";
  if (message.includes("category does not fit the loan part") || message.includes("category not found")) return "קטגוריית העמלות לא מתאימה.";
  if (message.includes("a later payment is already attached")) return "כבר שויך תשלום מאוחר יותר.";
  if (message.includes("payment before the loan start")) return "התשלום לפני תחילת ההלוואה.";
  return fallback;
}

/** clear_loan_split's refusals (decision 0136). A line already unmatched is handled quietly by the caller. */
export function loanClearFailureText(error: Error): WriteFailure {
  if (code(error) === "42501" || error.message.includes("forbidden")) return "אין הרשאה לבטל את השיוך.";
  // Another write matched or unmatched the line while this one waited: worth a retry.
  if (code(error) === "40001" || error.message.includes("loan split changed")) {
    return { message: "השיוך השתנה בינתיים.", retry: true };
  }
  return "לא הצלחנו לבטל את השיוך.";
}

/** The line was already unmatched elsewhere: nothing to tell, just refresh. */
export function isAlreadyUnmatched(error: Error): boolean {
  return error.message.includes("line has no loan split");
}

function parseCleared(data: unknown): ClearedSplit {
  const value = (data ?? {}) as { loan_id?: unknown; parts?: unknown };
  if (typeof value.loan_id !== "string" || !Array.isArray(value.parts)) throw new Error("supabase");
  return {
    loanId: value.loan_id,
    parts: (value.parts as Array<Record<string, unknown>>).map((part) => ({
      part: String(part.part) as LoanSplitPart,
      amount_minor: Number(part.amount_minor),
      scheduled_minor: Number(part.scheduled_minor),
      category_id: typeof part.category_id === "string" ? part.category_id : null,
      needs_review: part.needs_review === true,
    })),
  };
}

/**
 * Undo of an unmatch: the removed parts back through save_loan_split, each with its category.
 * A flagged split whose parts no longer add up to the line (a re-synced amount) is rebuilt from the
 * same scheduled figures and fees, as the sheet's correction does; the server refuses parts that
 * don't add up.
 */
export function partsFromCleared(cleared: ClearedSplit, lineMinor?: bigint | null): SavePart[] {
  const keep = (part: ClearedSplit["parts"][number], amount: number): SavePart => ({
    part: part.part,
    amount_minor: amount,
    scheduled_minor: part.scheduled_minor,
    ...(part.category_id ? { category_id: part.category_id } : {}),
  });
  const sum = cleared.parts.reduce((total, part) => total + BigInt(part.amount_minor), 0n);
  if (lineMinor == null || sum === lineMinor) return cleared.parts.map((part) => keep(part, part.amount_minor));
  const scheduled = (name: LoanSplitPart) => BigInt(cleared.parts.find((part) => part.part === name)?.scheduled_minor ?? 0);
  const feesMinor = BigInt(cleared.parts.find((part) => part.part === "fees")?.amount_minor ?? 0);
  const next = allocateLoanSplitWithFees({
    lineMinor,
    feesMinor,
    interestMinor: scheduled("interest"),
    escrowMinor: scheduled("escrow"),
    principalMinor: scheduled("principal"),
  });
  if (next == null) return cleared.parts.map((part) => keep(part, part.amount_minor));
  return cleared.parts.map((part) => keep(part, Number(next.find((item) => item.part === part.part)?.amountMinor ?? 0n)));
}

async function readStoredSplit(transactionId: string): Promise<StoredSplit> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  const [txn, splits] = await Promise.all([
    supabase.from("transactions").select("amount_original, currency").eq("id", transactionId).single(),
    supabase
      .from("loan_splits")
      .select("part, amount_minor, scheduled_minor, category_id, needs_review, loan_id")
      .eq("transaction_id", transactionId),
  ]);
  assertNoError(txn);
  assertNoError(splits);
  if (!txn.data) throw new Error("supabase");
  const rows = splits.data ?? [];
  const loanId = rows[0]?.loan_id;
  let loanCurrency: string | null = null;
  if (loanId) {
    const loan = await supabase.from("loans").select("currency").eq("id", loanId).single();
    loanCurrency = loan.error ? null : loan.data.currency;
  }
  return {
    lineMinor: BigInt(txn.data.amount_original),
    currency: txn.data.currency,
    loanCurrency,
    parts: rows.map((row) => ({
      part: row.part,
      amountMinor: BigInt(row.amount_minor),
      scheduledMinor: BigInt(row.scheduled_minor),
      categoryId: row.category_id,
      needsReview: row.needs_review,
    })),
  };
}

async function readLoanMatch(transactionId: string, known: boolean): Promise<LoadedMatch> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  const txn = await supabase
    .from("transactions")
    .select("company_id, amount_original, currency")
    .eq("id", transactionId)
    .single();
  assertNoError(txn);
  if (!txn.data) throw new Error("supabase");
  const companyId = txn.data.company_id;
  const [splits, loans, categories, balances, counted] = await Promise.all([
    // get_transaction already said the line has no split: no split reads (FLOW-114).
    known
      ? Promise.resolve({ data: [], error: null })
      : supabase
        .from("loan_splits")
        .select("id, part, amount_minor, scheduled_minor, needs_review, loan_id")
        .eq("transaction_id", transactionId),
    supabase
      .from("loans")
      .select("id, name, currency, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor, escrow_minor, status, closed_on, interest_category_id, escrow_category_id, principal_category_id, kind, interest_only_months, amortization_months, loan_rates(effective_date, annual_rate_ppm)")
      .eq("company_id", companyId),
    supabase
      .from("categories")
      .select("id, loan_part")
      .eq("company_id", companyId)
      .eq("kind", "expense")
      .not("loan_part", "is", null),
    supabase
      .from("loan_balances")
      .select("loan_id, balance_minor")
      .eq("company_id", companyId),
    known
      ? Promise.resolve({ data: null, error: null })
      : supabase.rpc("get_loan_split", { p_transaction_id: transactionId }),
  ]);
  assertNoError(splits);
  assertNoError(loans);
  assertNoError(categories);
  assertNoError(balances);
  assertNoError(counted);
  const pnl = readCounted(counted.data);
  const balanceByLoan = new Map((balances.data ?? []).map((row) => [row.loan_id, BigInt(row.balance_minor ?? 0)]));
  const categoryIds: Partial<Record<LoanSplitPart, string>> = {};
  for (const category of categories.data ?? []) {
    if (category.loan_part) categoryIds[category.loan_part] = category.id;
  }
  return {
    companyId,
    lineMinor: BigInt(txn.data.amount_original),
    currency: txn.data.currency,
    splits: (splits.data ?? []).map((row) => ({
      id: row.id,
      part: row.part,
      amountMinor: BigInt(row.amount_minor),
      scheduledMinor: BigInt(row.scheduled_minor),
      needsReview: row.needs_review,
      loanId: row.loan_id,
      inPnl: pnl.parts.get(row.part) ?? null,
    })),
    byParts: pnl.byParts,
    loans: (loans.data ?? []).map((loan) => ({
      id: loan.id,
      name: loan.name,
      currency: loan.currency,
      principalMinor: loan.principal_minor,
      annualRatePpm: loan.annual_rate_ppm,
      termMonths: loan.term_months,
      startDate: loan.start_date,
      paymentMinor: loan.payment_minor,
      escrowMinor: loan.escrow_minor,
      balanceMinor: balanceByLoan.get(loan.id) ?? 0n,
      kind: loan.kind,
      interestOnlyMonths: loan.interest_only_months,
      amortizationMonths: loan.amortization_months,
      // Test doubles and older rows may leave the embed out.
      rates: (Array.isArray(loan.loan_rates) ? loan.loan_rates : []).map((rate) => ({ effectiveDate: rate.effective_date, annualRatePpm: rate.annual_rate_ppm })),
      status: loan.status,
      closedOn: loan.closed_on,
      categoryIds: {
        interest: loan.interest_category_id,
        escrow: loan.escrow_category_id,
        principal: loan.principal_category_id,
      },
    })),
    categoryIds,
  };
}

/** get_loan_split is null or { by_parts, parts: [{ part, in_pnl }] }. Anything else reads as the whole line. */
function readCounted(data: unknown): { byParts: boolean; parts: Map<string, boolean | null> } {
  const parts = new Map<string, boolean | null>();
  if (data == null || typeof data !== "object") return { byParts: false, parts };
  const value = data as { by_parts?: unknown; parts?: unknown };
  if (Array.isArray(value.parts)) {
    for (const item of value.parts as Array<{ part?: unknown; in_pnl?: unknown }>) {
      if (typeof item.part === "string") parts.set(item.part, typeof item.in_pnl === "boolean" ? item.in_pnl : null);
    }
  }
  return { byParts: value.by_parts === true, parts };
}
