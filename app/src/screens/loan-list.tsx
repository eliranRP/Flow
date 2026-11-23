import { useQuery } from "@tanstack/react-query";
import type { LoanKind, LoanScheduleRow, LoanStatus } from "@flow/shared";
import { israelToday } from "../ui/date-math";
import { rateOnDate } from "@flow/shared";
import { getSupabase } from "../lib/supabase";
import { assertNoError } from "../use-write";
import { LOAN_KIND_LIST_LABEL } from "./loan-copy";
import { LOAN_DETAIL_COLUMNS, readLoanRow, type LoanDetailDbRow } from "./loan-detail-data";
import type { LoanBalanceRow } from "./loan-match";
import { latePayment, loanOutlook, type OutlookLoan, scheduleRowsOf } from "./loan-outlook";
import { readLoanBalances, readProjectNames } from "./loan-reads";

/**
 * FLOW-106 §3.1, FLOW-1046. The loans list: open loans and closed loans (the פעילות / נסגרו segment), each in
 * groups by kind. Loans stay alphabetical inside a group (the owner dropped reordering, 2026-10-08).
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
  /** FLOW-1046: the next scheduled payment; missing for a demand loan, a closed one, or a sample without it. */
  next?: { dueDate: string; amountMinor: bigint };
  /** FLOW-1258: the due date of a scheduled payment past its grace with nothing recorded for it; missing when on time. */
  lateOn?: string;
};

export function isClosedLoan(row: Pick<LoanListRow, "status">): boolean {
  return row.status != null && row.status !== "open";
}

/** Alphabetical, as Hebrew sorts it; the id breaks a tie so the order never jumps. */
export function sortLoans<T extends { name: string; id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name, "he") || a.id.localeCompare(b.id));
}

export function groupLoans(rows: readonly LoanListRow[]): { open: LoanListRow[]; closed: LoanListRow[] } {
  const sorted = sortLoans(rows);
  return { open: sorted.filter((row) => !isClosedLoan(row)), closed: sorted.filter(isClosedLoan) };
}

/** FLOW-1046: the kinds in the list's order. A missing kind reads as amortizing. */
const KIND_ORDER: readonly LoanKind[] = ["amortizing", "interest_only", "balloon", "demand"];

export type LoanKindGroup = {
  kind: LoanKind;
  /** פריסה רגילה, ריבית בלבד, בלון, לפי דרישה. */
  title: string;
  rows: LoanListRow[];
  /** The group's balances, one sum per currency (amounts in two currencies do not add). */
  totals: Array<{ currency: string; minor: bigint }>;
};

/**
 * FLOW-1046 (V3-Loans): the rows in groups by kind, in KIND_ORDER, each alphabetical; a kind with no row has
 * no group. The caller passes the open rows or the closed rows (the פעילות / נסגרו segment).
 */
export function groupLoansByKind(rows: readonly LoanListRow[]): LoanKindGroup[] {
  const sorted = sortLoans(rows);
  return KIND_ORDER.flatMap((kind) => {
    const inKind = sorted.filter((row) => (row.kind ?? "amortizing") === kind);
    if (inKind.length === 0) return [];
    const totals = new Map<string, bigint>();
    for (const row of inKind) totals.set(row.currency, (totals.get(row.currency) ?? 0n) + row.balanceMinor);
    return [{ kind, title: LOAN_KIND_LIST_LABEL[kind], rows: inKind, totals: [...totals].map(([currency, minor]) => ({ currency, minor })) }];
  });
}

/**
 * A paid-off loan's balance is no longer news (FLOW-138), so the loan page leads with נפרעה and its date alone.
 * The list no longer uses this: it shows $0 for a paid-off loan as the board draws it (FLOW-139c).
 */
export function showsLoanBalance(row: Pick<LoanListRow, "status" | "balanceMinor">): boolean {
  if (row.status === "paid_off") return false;
  return !(row.status === "closed" && row.balanceMinor === 0n);
}

/** The rate in force on a day, as rateInForce reads it (loan-detail-data.ts), from the list's read. */
function rateInForRow(loan: LoanDetailDbRow, today: string): number | undefined {
  if (typeof loan.annual_rate_ppm !== "number") return undefined;
  const rates = (Array.isArray(loan.loan_rates) ? loan.loan_rates : [])
    .map((rate) => ({ effectiveDate: rate.effective_date, annualRatePpm: rate.annual_rate_ppm }))
    .sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : 1));
  return rateOnDate(loan.annual_rate_ppm, rates, today);
}

/**
 * FLOW-1046: an open loan's next scheduled payment, its parts summed; null for a closed loan or one with no schedule.
 * `rows` is the loan's schedule (scheduleRowsOf), passed in when the caller already built it (FLOW-1260).
 */
export function nextPaymentOf(loan: OutlookLoan, today: string, rows: readonly LoanScheduleRow[] | null = scheduleRowsOf(loan)): LoanListRow["next"] | null {
  const outlook = loan.status === "open" ? loanOutlook(loan, today, rows) : null;
  if (outlook == null) return null;
  const { dueDate, principalMinor, interestMinor, escrowMinor } = outlook.next;
  return { dueDate, amountMinor: principalMinor + interestMinor + escrowMinor };
}

/** The loans of a company: the list's rows (alphabetical) and each loan's full detail for the band's figures. */
export type LoanListData = {
  rows: LoanListRow[];
  /** Each loan's row, its balance (mapped to a LoanDetail by the band's summary) and its schedule (FLOW-1260). */
  loans: Array<{ row: LoanDetailDbRow; balance: { balanceMinor: bigint; flaggedParts: number } | null; schedule: readonly LoanScheduleRow[] | null }>;
};

/** One read, shared by the list and the band's summary through the same query key. */
export async function readLoanList(companyId: string | null, today: string = israelToday()): Promise<LoanListData> {
  const supabase = getSupabase();
  if (!supabase || companyId == null) return { rows: [], loans: [] };
  // Three reads at once: none needs another's answer.
  const [loans, byLoan, projectNames] = await Promise.all([
    supabase.from("loans").select(LOAN_DETAIL_COLUMNS).eq("company_id", companyId).order("name"),
    readLoanBalances(supabase, companyId),
    readProjectNames(supabase, companyId),
  ]);
  assertNoError(loans);
  const built = (loans.data ?? []).map((loan) => {
    const balance = byLoan.get(loan.id);
    // A balance row missing from the read: nothing counted against it, so the principal is left.
    const balanceMinor = BigInt(balance?.balance_minor ?? loan.principal_minor);
    const outlookLoan = readLoanRow(loan, { balanceMinor, flaggedParts: 0 });
    // FLOW-1260: the loan's schedule is built once here; its next payment and its late flag both read it.
    const schedule = scheduleRowsOf(outlookLoan);
    const next = nextPaymentOf(outlookLoan, today, schedule);
    const lateOn = latePayment(outlookLoan, balance?.last_paid_on ?? null, today, schedule);
    const row: LoanListRow = {
      id: loan.id,
      name: loan.name,
      currency: loan.currency,
      balanceMinor,
      flaggedParts: balance?.flagged_parts ?? 0,
      projectId: loan.project_id,
      projectName: loan.project_id == null ? null : (projectNames.get(loan.project_id) ?? null),
      kind: loan.kind,
      status: loan.status,
      closedOn: loan.closed_on,
      ratePpm: rateInForRow(loan, today),
      ...(next == null ? {} : { next }),
      ...(lateOn == null ? {} : { lateOn }),
    };
    const detail = { row: loan, balance: balance == null ? null : { balanceMinor, flaggedParts: balance.flagged_parts ?? 0 }, schedule };
    return { row, detail };
  });
  return { rows: sortLoans(built.map((item) => item.row)), loans: built.map((item) => item.detail) };
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
