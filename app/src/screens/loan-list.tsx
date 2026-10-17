import { useQuery } from "@tanstack/react-query";
import type { LoanKind, LoanStatus } from "@flow/shared";
import { splitCents } from "../ui/amount";
import { formatDisplay, israelToday } from "../ui/date-math";
import { rateOnDate } from "@flow/shared";
import { getSupabase } from "../lib/supabase";
import { assertNoError } from "../use-write";
import { LOAN_KIND_LABEL, LOAN_STATUS_LABEL } from "./loan-copy";
import { LOAN_DETAIL_COLUMNS, type LoanDetailDbRow } from "./loan-detail-data";
import { formatLoanMoney } from "./loan-form";
import type { LoanBalanceRow } from "./loan-match";
import { readLoanBalances, readProjectNames } from "./loan-reads";

/**
 * FLOW-106 §3.1. The loans list: open loans, then paid-off and closed loans under a quiet
 * "נסגרו (N)", collapsed. Loans stay alphabetical (the owner dropped reordering, 2026-10-08).
 * A row opens the loan's page (`/loans/:id`).
 */
export type LoanListRow = LoanBalanceRow & {
  /** Missing reads as amortizing. */
  kind?: LoanKind;
  /** Missing reads as open. */
  status?: LoanStatus;
  closedOn?: string | null;
  /** The annual rate in force today, in ppm. Missing (a sample) leaves the rate out of the row. */
  ratePpm?: number;
};

export const LOANS_CLOSED_UNDER_EMPTY = "הלוואות שנסגרו";

function showMoney(minor: bigint, currency: string): string {
  return formatLoanMoney(minor, currency === "USD" ? "USD" : "ILS");
}

function isClosed(row: LoanListRow): boolean {
  return row.status != null && row.status !== "open";
}

/** Alphabetical, as Hebrew sorts it; the id breaks a tie so the order never jumps. */
export function sortLoans<T extends { name: string; id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name, "he") || a.id.localeCompare(b.id));
}

export function groupLoans(rows: readonly LoanListRow[]): { open: LoanListRow[]; closed: LoanListRow[] } {
  const sorted = sortLoans(rows);
  return { open: sorted.filter((row) => !isClosed(row)), closed: sorted.filter(isClosed) };
}

/**
 * The hint under an open loan: its kind when it is not a plain mortgage, then its project, or
 * ממתין לבדיקה. A closed loan says how it ended and when: "נפרעה · 30/11/2025".
 */
export function loanListHint(row: LoanListRow): string | undefined {
  const parts = loanListHintParts(row);
  return parts.length === 0 ? undefined : parts.join(" · ");
}

/** The same hint as whole parts, so a narrow row drops a part with its "·" instead of wrapping (FLOW-347). */
export function loanListHintParts(row: LoanListRow): string[] {
  if (isClosed(row) && row.status != null) {
    const label = LOAN_STATUS_LABEL[row.status];
    return row.closedOn ? [label, formatDisplay(row.closedOn)] : [label];
  }
  const kind = row.kind != null && row.kind !== "amortizing" ? LOAN_KIND_LABEL[row.kind] : null;
  // ממתין לבדיקה leads, so a narrow row drops the kind, never the words behind the warning tone.
  if (row.flaggedParts > 0) return ["ממתין לבדיקה", ...(kind != null ? [kind] : [])];
  return [kind, row.projectName ?? null].filter((part): part is string => part != null && part !== "");
}

/**
 * A paid-off loan shows only נפרעה and its date: its balance is no longer news (FLOW-138, Eliran picked "Hide").
 * A closed loan drops a zero balance too, and keeps one that is still owed.
 */
export function showsLoanBalance(row: Pick<LoanListRow, "status" | "balanceMinor">): boolean {
  if (row.status === "paid_off") return false;
  return !(row.status === "closed" && row.balanceMinor === 0n);
}

/** A balance with its agorot drawn small, none on a whole amount (FLOW-501, decision 0120). */
export function LoanBalance({ minor, currency, className }: { minor: bigint; currency: string; className?: string }) {
  const { whole, cents } = splitCents(showMoney(minor, currency), "detail");
  return (
    <bdi className={className == null ? "ui-num ui-loan-amount" : `ui-num ui-loan-amount ${className}`} dir="ltr">
      {whole}
      {cents != null ? <span className="ui-num-cents">{cents}</span> : null}
    </bdi>
  );
}

/** The rate in force on a day, as rateInForce reads it (loan-detail-data.ts), from the list's read. */
function rateInForRow(loan: LoanDetailDbRow, today: string): number | undefined {
  if (typeof loan.annual_rate_ppm !== "number") return undefined;
  const rates = (Array.isArray(loan.loan_rates) ? loan.loan_rates : [])
    .map((rate) => ({ effectiveDate: rate.effective_date, annualRatePpm: rate.annual_rate_ppm }))
    .sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : 1));
  return rateOnDate(loan.annual_rate_ppm, rates, today);
}

/** The loans of a company: the list's rows (alphabetical) and each loan's full detail for the summary card. */
export type LoanListData = {
  rows: LoanListRow[];
  /** Each loan's row and its balance, mapped to a LoanDetail by the summary card. */
  loans: Array<{ row: LoanDetailDbRow; balance: { balanceMinor: bigint; flaggedParts: number } | null }>;
};

/** One read, shared by the list and the summary card through the same query key. */
export async function readLoanList(companyId: string | null): Promise<LoanListData> {
  const supabase = getSupabase();
  if (!supabase || companyId == null) return { rows: [], loans: [] };
  const loans = await supabase.from("loans").select(LOAN_DETAIL_COLUMNS).eq("company_id", companyId).order("name");
  assertNoError(loans);
  const byLoan = await readLoanBalances(supabase, companyId);
  const projectNames = await readProjectNames(supabase, loans.data ?? []);
  const rows = sortLoans((loans.data ?? []).map((loan) => {
    const balance = byLoan.get(loan.id);
    return {
      id: loan.id,
      name: loan.name,
      currency: balance?.currency ?? loan.currency,
      // A balance row missing from the read: nothing counted against it, so the principal is left.
      balanceMinor: BigInt(balance?.balance_minor ?? loan.principal_minor),
      flaggedParts: balance?.flagged_parts ?? 0,
      projectId: loan.project_id,
      projectName: loan.project_id == null ? null : (projectNames.get(loan.project_id) ?? null),
      kind: loan.kind,
      status: loan.status,
      closedOn: loan.closed_on,
      ratePpm: rateInForRow(loan, israelToday()),
    };
  }));
  const detailRows = (loans.data ?? []).map((row) => {
    const balance = byLoan.get(row.id);
    return { row, balance: balance == null ? null : { balanceMinor: BigInt(balance.balance_minor ?? row.principal_minor), flaggedParts: balance.flagged_parts ?? 0 } };
  });
  return { rows, loans: detailRows };
}

/** The loans with their balances, kind and status, alphabetical. */
export function useLoanList(companyId: string | null) {
  return useQuery({
    queryKey: ["loans", companyId, "list"],
    enabled: companyId != null,
    retry: false,
    queryFn: () => readLoanList(companyId),
    select: (data) => data.rows,
  });
}
