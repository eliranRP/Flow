import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import type { Database, LoanKind, LoanSplitPart, LoanStatus } from "@flow/shared";
import { getSupabase } from "../lib/supabase";
import { assertNoError } from "../use-write";
import {
  LOAN_DETAIL_COLUMNS,
  readLoanPayments,
  readLoanRow,
  type LoanCategory,
  type LoanDetail,
  type LoanDetailDbRow,
  type LoanPayment,
  type LoanRateRow,
} from "./loan-detail-data";
import type { LoanListRow } from "./loan-list";
import type { LoanProjectChoice } from "./loan-project-picker";

/**
 * FLOW-106 B / FLOW-110: where the loan page reads and writes. Live reads go through react-query
 * and write with RLS (loans, loan_rates) or the owner RPCs (delete_loan, restore_loan). Stories,
 * the dev fixture and tests use `memoryLoanStore`, with the same write shape, so every sheet and
 * undo runs with no network.
 */

export type LoanBundle = {
  loan: LoanDetail;
  payments: LoanPayment[];
  categories: LoanCategory[];
};

/** What the page edits on the loan row, in the app's words. */
export type LoanPatch = {
  status?: LoanStatus;
  closedOn?: string | null;
  projectId?: string | null;
  categoryIds?: Partial<Record<LoanSplitPart, string | null>>;
  kind?: LoanKind;
  interestOnlyMonths?: number | null;
  amortizationMonths?: number | null;
  termMonths?: number | null;
  paymentMinor?: bigint | null;
  escrowMinor?: bigint;
};

export type LoanRateWrite = { id?: string; effectiveDate: string; annualRatePpm: number };

export type LoanWrites = {
  update: (loanId: string, patch: LoanPatch) => Promise<void>;
  /** Adds a rate row, or changes one by id. Returns the row's id. */
  saveRate: (loan: Pick<LoanDetail, "id" | "companyId">, rate: LoanRateWrite) => Promise<string>;
  deleteRate: (rateId: string) => Promise<void>;
  /** delete_loan: the loan, its rates and its split parts. Returns how many payments count whole again. */
  deleteLoan: (loanId: string) => Promise<{ payments: number }>;
  /** restore_loan: the app's undo of a delete. */
  restoreLoan: (loanId: string) => Promise<void>;
};

const PART_COLUMN: Record<LoanSplitPart, "interest_category_id" | "escrow_category_id" | "principal_category_id" | "fees_category_id"> = {
  interest: "interest_category_id",
  escrow: "escrow_category_id",
  principal: "principal_category_id",
  fees: "fees_category_id",
};

/** The loans columns a patch writes. */
type LoanUpdate = Database["public"]["Tables"]["loans"]["Update"];

export function patchColumns(patch: LoanPatch): LoanUpdate {
  const columns: LoanUpdate = {};
  if (patch.status !== undefined) columns.status = patch.status;
  if (patch.closedOn !== undefined) columns.closed_on = patch.closedOn;
  if (patch.projectId !== undefined) columns.project_id = patch.projectId;
  for (const [part, id] of Object.entries(patch.categoryIds ?? {}) as Array<[LoanSplitPart, string | null]>) {
    columns[PART_COLUMN[part]] = id;
  }
  if (patch.kind !== undefined) columns.kind = patch.kind;
  if (patch.interestOnlyMonths !== undefined) columns.interest_only_months = patch.interestOnlyMonths;
  if (patch.amortizationMonths !== undefined) columns.amortization_months = patch.amortizationMonths;
  if (patch.termMonths !== undefined) columns.term_months = patch.termMonths;
  if (patch.paymentMinor !== undefined) columns.payment_minor = patch.paymentMinor == null ? null : Number(patch.paymentMinor);
  if (patch.escrowMinor !== undefined) columns.escrow_minor = Number(patch.escrowMinor);
  return columns;
}

/** The patch that puts back what `patch` changed. */
export function inversePatch(loan: LoanDetail, patch: LoanPatch): LoanPatch {
  const back: LoanPatch = {};
  if (patch.status !== undefined) back.status = loan.status;
  if (patch.closedOn !== undefined) back.closedOn = loan.closedOn;
  if (patch.projectId !== undefined) back.projectId = loan.projectId;
  if (patch.categoryIds) {
    back.categoryIds = {};
    for (const part of Object.keys(patch.categoryIds) as LoanSplitPart[]) back.categoryIds[part] = loan.categoryIds[part];
  }
  if (patch.kind !== undefined) back.kind = loan.kind;
  if (patch.interestOnlyMonths !== undefined) back.interestOnlyMonths = loan.interestOnlyMonths;
  if (patch.amortizationMonths !== undefined) back.amortizationMonths = loan.amortizationMonths;
  if (patch.termMonths !== undefined) back.termMonths = loan.termMonths;
  if (patch.paymentMinor !== undefined) back.paymentMinor = loan.paymentMinor;
  if (patch.escrowMinor !== undefined) back.escrowMinor = loan.escrowMinor;
  return back;
}

export function applyPatch(loan: LoanDetail, patch: LoanPatch): LoanDetail {
  return {
    ...loan,
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.closedOn !== undefined ? { closedOn: patch.closedOn } : {}),
    ...(patch.projectId !== undefined ? { projectId: patch.projectId } : {}),
    ...(patch.categoryIds ? { categoryIds: { ...loan.categoryIds, ...patch.categoryIds } } : {}),
    ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
    ...(patch.interestOnlyMonths !== undefined ? { interestOnlyMonths: patch.interestOnlyMonths } : {}),
    ...(patch.amortizationMonths !== undefined ? { amortizationMonths: patch.amortizationMonths } : {}),
    ...(patch.termMonths !== undefined ? { termMonths: patch.termMonths } : {}),
    ...(patch.paymentMinor !== undefined ? { paymentMinor: patch.paymentMinor } : {}),
    ...(patch.escrowMinor !== undefined ? { escrowMinor: patch.escrowMinor } : {}),
  };
}

function refused(): Error {
  return Object.assign(new Error("forbidden"), { code: "42501" });
}

/** The live writes. RLS filters a refused row without an error, so no row back is a refusal. */
export const liveLoanWrites: LoanWrites = {
  update: async (loanId, patch) => {
    const supabase = getSupabase();
    if (!supabase) throw new Error("supabase");
    const result = await supabase.from("loans").update(patchColumns(patch)).eq("id", loanId).select("id");
    assertNoError(result);
    if ((result.data ?? []).length === 0) throw refused();
  },
  saveRate: async (loan, rate) => {
    const supabase = getSupabase();
    if (!supabase) throw new Error("supabase");
    if (rate.id != null) {
      const result = await supabase
        .from("loan_rates")
        .update({ effective_date: rate.effectiveDate, annual_rate_ppm: rate.annualRatePpm })
        .eq("id", rate.id)
        .select("id");
      assertNoError(result);
      const id = result.data?.[0]?.id;
      if (typeof id !== "string") throw refused();
      return id;
    }
    // One row per day (unique loan_id, effective_date): a second rate on the same day replaces it.
    const result = await supabase
      .from("loan_rates")
      .upsert(
        { company_id: loan.companyId, loan_id: loan.id, effective_date: rate.effectiveDate, annual_rate_ppm: rate.annualRatePpm },
        { onConflict: "loan_id,effective_date" },
      )
      .select("id");
    assertNoError(result);
    const id = result.data?.[0]?.id;
    if (typeof id !== "string") throw refused();
    return id;
  },
  deleteRate: async (rateId) => {
    const supabase = getSupabase();
    if (!supabase) throw new Error("supabase");
    const result = await supabase.from("loan_rates").delete().eq("id", rateId).select("id");
    assertNoError(result);
    if ((result.data ?? []).length === 0) throw refused();
  },
  deleteLoan: async (loanId) => {
    const supabase = getSupabase();
    if (!supabase) throw new Error("supabase");
    const result = await supabase.rpc("delete_loan", { p_loan_id: loanId });
    assertNoError(result);
    const data = result.data as { payments?: unknown } | null;
    return { payments: typeof data?.payments === "number" ? data.payments : 0 };
  },
  restoreLoan: async (loanId) => {
    const supabase = getSupabase();
    if (!supabase) throw new Error("supabase");
    assertNoError(await supabase.rpc("restore_loan", { p_loan_id: loanId }));
  },
};

export type LoanRead =
  | { phase: "loading" }
  | { phase: "error"; retry: () => void; retrying: boolean }
  | { phase: "missing" }
  | { phase: "ready"; bundle: LoanBundle };

/** The live read of one loan's page: the loan with its rates and balance, its payments, and the categories. */
export function useLiveLoan(loanId: string, active: boolean): LoanRead {
  const client = useQueryClient();
  const loan = useQuery({
    queryKey: ["loans", "detail", loanId],
    enabled: active && loanId !== "",
    retry: false,
    queryFn: async (): Promise<LoanDetail | null> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      const row = await supabase.from("loans").select(LOAN_DETAIL_COLUMNS).eq("id", loanId).maybeSingle();
      assertNoError(row);
      if (row.data == null) return null;
      const balance = await supabase.from("loan_balances").select("balance_minor, flagged_parts").eq("loan_id", loanId).maybeSingle();
      assertNoError(balance);
      const data = row.data as unknown as LoanDetailDbRow;
      return readLoanRow(data, balance.data == null ? null : {
        balanceMinor: BigInt(balance.data.balance_minor ?? 0),
        flaggedParts: balance.data.flagged_parts ?? 0,
      });
    },
  });
  const payments = useQuery({
    queryKey: ["loans", "payments", loanId],
    enabled: active && loanId !== "" && loan.data != null,
    retry: false,
    queryFn: async (): Promise<LoanPayment[]> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      const result = await supabase.rpc("mcp_loan_payments", { p_loan_id: loanId });
      assertNoError(result);
      return readLoanPayments(result.data);
    },
  });
  const categories = useQuery({
    queryKey: ["categories", "loan-parts"],
    enabled: active && loan.data != null,
    retry: false,
    queryFn: async (): Promise<LoanCategory[]> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      const result = await supabase
        .from("categories")
        .select("id, name, kind, loan_part, excluded_from_pnl, hidden")
        .order("sort_order");
      assertNoError(result);
      return (result.data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        kind: row.kind,
        loanPart: row.loan_part,
        excludedFromPnl: row.excluded_from_pnl,
        hidden: row.hidden,
      }));
    },
  });
  if (loan.isLoading || (loan.data != null && (payments.isLoading || categories.isLoading))) return { phase: "loading" };
  if (loan.isError || payments.isError || categories.isError) {
    return {
      phase: "error",
      retrying: loan.isFetching || payments.isFetching || categories.isFetching,
      retry: () => { void client.refetchQueries({ queryKey: ["loans", "detail", loanId] }); void payments.refetch(); void categories.refetch(); },
    };
  }
  if (loan.data == null) return { phase: "missing" };
  return { phase: "ready", bundle: { loan: loan.data, payments: payments.data ?? [], categories: categories.data ?? [] } };
}

/** A sample loan page: what a memory store holds for one loan. */
export type LoanSample = LoanBundle & { projectName?: string | null };

export type MemoryLoanStore = LoanWrites & {
  read: (loanId: string) => LoanRead;
  rows: () => LoanListRow[];
  projects: LoanProjectChoice[];
  subscribe: (listener: () => void) => () => void;
  version: () => number;
};

/**
 * An in-memory loan store for stories, the dev fixture and tests. `refuse` answers a write
 * kind with that server reason; `phase` pins the page to loading or error.
 */
export function memoryLoanStore(
  samples: readonly LoanSample[],
  options: {
    projects?: LoanProjectChoice[];
    phase?: "loading" | "error";
    refuse?: Partial<Record<"update" | "saveRate" | "deleteRate" | "deleteLoan" | "restoreLoan", string>>;
    /** Milliseconds each write waits, so a busy state can be seen. */
    delayMs?: number;
  } = {},
): MemoryLoanStore {
  const live = new Map(samples.map((sample) => [sample.loan.id, { ...sample, loan: { ...sample.loan } }]));
  const deleted = new Map<string, LoanSample>();
  const listeners = new Set<() => void>();
  let version = 0;
  let rateSeq = 0;
  const projects = options.projects ?? [];
  const emit = () => {
    version += 1;
    for (const listener of listeners) listener();
  };
  const wait = () => new Promise<void>((resolve) => { setTimeout(resolve, options.delayMs ?? 0); });
  const guard = (kind: keyof NonNullable<typeof options.refuse>) => {
    const reason = options.refuse?.[kind];
    if (reason != null) throw Object.assign(new Error(reason), reason === "forbidden" ? { code: "42501" } : {});
  };
  const find = (loanId: string) => {
    const sample = live.get(loanId);
    if (!sample) throw new Error("loan not found");
    return sample;
  };
  const sortRates = (rates: LoanRateRow[]) => [...rates].sort((a, b) => (a.effectiveDate < b.effectiveDate ? 1 : -1));
  return {
    projects,
    read: (loanId) => {
      if (options.phase === "loading") return { phase: "loading" };
      if (options.phase === "error") return { phase: "error", retry: () => undefined, retrying: false };
      const sample = live.get(loanId);
      return sample ? { phase: "ready", bundle: sample } : { phase: "missing" };
    },
    rows: () => [...live.values()].map((sample) => ({
      id: sample.loan.id,
      name: sample.loan.name,
      currency: sample.loan.currency,
      balanceMinor: sample.loan.balanceMinor,
      flaggedParts: sample.loan.flaggedParts,
      projectId: sample.loan.projectId,
      projectName: projects.find((project) => project.id === sample.loan.projectId)?.name ?? sample.projectName ?? null,
      kind: sample.loan.kind,
      status: sample.loan.status,
      closedOn: sample.loan.closedOn,
    })),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    version: () => version,
    update: async (loanId, patch) => {
      await wait();
      guard("update");
      const sample = find(loanId);
      if (patch.status != null && patch.status !== "open" && patch.closedOn != null) {
        const last = sample.payments.reduce<string | null>((max, payment) => (max == null || payment.docDate > max ? payment.docDate : max), null);
        if (last != null && patch.closedOn < last) throw new Error("loan_payments_after_close");
      }
      live.set(loanId, { ...sample, loan: applyPatch(sample.loan, patch) });
      emit();
    },
    saveRate: async (loan, rate) => {
      await wait();
      guard("saveRate");
      const sample = find(loan.id);
      if (rate.effectiveDate < sample.loan.startDate) throw new Error("rate before the loan start");
      const others = sample.loan.rates.filter((row) => row.id !== rate.id && row.effectiveDate !== rate.effectiveDate);
      const sameDay = sample.loan.rates.find((row) => row.effectiveDate === rate.effectiveDate && row.id !== rate.id);
      rateSeq += 1;
      const id = rate.id ?? sameDay?.id ?? `rate-${String(rateSeq)}`;
      live.set(loan.id, { ...sample, loan: { ...sample.loan, rates: sortRates([...others, { id, effectiveDate: rate.effectiveDate, annualRatePpm: rate.annualRatePpm }]) } });
      emit();
      return id;
    },
    deleteRate: async (rateId) => {
      await wait();
      guard("deleteRate");
      for (const [id, sample] of live) {
        if (sample.loan.rates.some((row) => row.id === rateId)) {
          live.set(id, { ...sample, loan: { ...sample.loan, rates: sample.loan.rates.filter((row) => row.id !== rateId) } });
          emit();
          return;
        }
      }
      throw new Error("rate not found");
    },
    deleteLoan: async (loanId) => {
      await wait();
      guard("deleteLoan");
      const sample = find(loanId);
      live.delete(loanId);
      deleted.set(loanId, sample);
      emit();
      return { payments: sample.payments.length };
    },
    restoreLoan: async (loanId) => {
      await wait();
      guard("restoreLoan");
      const sample = deleted.get(loanId);
      if (!sample) throw new Error("loan not found");
      deleted.delete(loanId);
      live.set(loanId, sample);
      emit();
    },
  };
}

/** Re-renders when a memory store changes. */
export function useMemoryLoanStore(store: MemoryLoanStore | null): number {
  return useSyncExternalStore(
    (listener) => (store ? store.subscribe(listener) : () => undefined),
    () => (store ? store.version() : 0),
    () => (store ? store.version() : 0),
  );
}
