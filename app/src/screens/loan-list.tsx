import { useQuery } from "@tanstack/react-query";
import type { LoanKind, LoanOutlooks, LoanStatus } from "@flow/shared";
import { israelToday } from "../ui/date-math";
import { loadReadSchemas } from "../load-read-schemas";
import { getSupabase } from "../lib/supabase";
import { readyClient } from "../ready-client";
import { assertNoError } from "../use-write";
import { LOAN_KIND_LIST_LABEL } from "./loan-copy";
import type { LoanDetailDbRow } from "./loan-detail-data";
import type { LoanBalanceRow } from "./loan-match";
import { loanOutlook, type OutlookLoan } from "./loan-outlook";
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

/**
 * FLOW-1046: an open loan's next scheduled payment, its parts summed; null for a closed loan or one with no schedule.
 * FLOW-1316: the Loans list reads this from `loan_outlooks`; the dev and preview sample store (loan-detail-store.ts) still builds it here.
 */
export function nextPaymentOf(loan: OutlookLoan, today: string): LoanListRow["next"] | null {
  const outlook = loan.status === "open" ? loanOutlook(loan, today) : null;
  if (outlook == null) return null;
  const { dueDate, principalMinor, interestMinor, escrowMinor } = outlook.next;
  return { dueDate, amountMinor: principalMinor + interestMinor + escrowMinor };
}

/** The loans of a company: the list's rows (alphabetical, without the outlooks) and each loan's detail row and balance for the band's figures. */
export type LoanListData = {
  rows: LoanListRow[];
  loans: Array<{ row: LoanDetailDbRow; balance: { balanceMinor: bigint; flaggedParts: number } | null }>;
};

/** The list's loan columns: the detail's, without the rates (FLOW-1316: no schedule is built from them here, and nothing draws the rate). */
const LOAN_LIST_COLUMNS =
  "id, company_id, name, currency, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor, escrow_minor, kind, interest_only_months, amortization_months, status, closed_on, refinanced_into_id, project_id, closing_paid_minor, interest_category_id, escrow_category_id, principal_category_id, fees_category_id" as const;

/** One read, shared by the list and the band's summary through the same query key. FLOW-1316: the next payments and late marks come from `loan_outlooks` (readLoanOutlooks), not from here. */
export async function readLoanList(companyId: string | null): Promise<LoanListData> {
  const supabase = getSupabase();
  if (!supabase || companyId == null) return { rows: [], loans: [] };
  // Three reads at once: none needs another's answer.
  const [loans, byLoan, projectNames] = await Promise.all([
    supabase.from("loans").select(LOAN_LIST_COLUMNS).eq("company_id", companyId).order("name"),
    readLoanBalances(supabase, companyId),
    readProjectNames(supabase, companyId),
  ]);
  assertNoError(loans);
  const built = (loans.data ?? []).map((loan) => {
    const balance = byLoan.get(loan.id);
    // A balance row missing from the read: nothing counted against it, so the principal is left.
    const balanceMinor = BigInt(balance?.balance_minor ?? loan.principal_minor);
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
    };
    const detail = { row: loan, balance: balance == null ? null : { balanceMinor, flaggedParts: balance.flagged_parts ?? 0 } };
    return { row, detail };
  });
  return { rows: sortLoans(built.map((item) => item.row)), loans: built.map((item) => item.detail) };
}

/**
 * FLOW-1316: the open loans' outlooks, one read of `loan_outlooks(p_today)` (FLOW-1310), as the answer comes. A failed
 * read throws, so the screen shows its failed state with retry.
 */
export async function readLoanOutlooks(companyId: string | null, today: string = israelToday()): Promise<LoanOutlooks> {
  if (companyId == null) return [];
  const supabase = await readyClient();
  const { data, error } = await supabase.rpc("loan_outlooks", { p_today: today });
  if (error) throw error;
  return (await loadReadSchemas()).loanOutlooksSchema.parse(data);
}

/**
 * The list's rows with each open loan's next payment and late mark from the outlooks. A loan absent from the answer
 * has neither (a closed or demand loan keeps its row); `next.amount_minor` is the sum of the payment's parts.
 */
export function withOutlooks(rows: readonly LoanListRow[], outlooks: LoanOutlooks): LoanListRow[] {
  const byLoan = new Map(outlooks.map((outlook) => [outlook.loan_id, outlook]));
  return rows.map((row) => {
    const outlook = byLoan.get(row.id);
    if (outlook == null) return row;
    return {
      ...row,
      ...(outlook.next == null ? {} : { next: { dueDate: outlook.next.due_date, amountMinor: outlook.next.amount_minor } }),
      ...(outlook.late_on == null ? {} : { lateOn: outlook.late_on }),
    };
  });
}

/**
 * The loans with their balances, kind and status, alphabetical, without the outlooks (the loan page reads the names).
 * The Loans screen adds them with useLoanOutlooks and withOutlooks.
 */
export function useLoanList(companyId: string | null) {
  return useQuery({
    queryKey: ["loans", companyId, "list"],
    enabled: companyId != null,
    retry: false,
    queryFn: () => readLoanList(companyId),
    select: (data) => data.rows,
  });
}

/** FLOW-1316: the open loans' outlooks from today (Israel). The key names the day, so a kept answer serves the same day only. */
export function useLoanOutlooks(companyId: string | null) {
  const today = israelToday();
  return useQuery({
    queryKey: ["loans", companyId, "outlooks", today],
    enabled: companyId != null,
    retry: false,
    queryFn: () => readLoanOutlooks(companyId, today),
  });
}
