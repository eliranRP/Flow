import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { LoanOutlooks } from "@flow/shared";
import type { LoanCurrency } from "./loan-form";
import { readLoanList, useLoanOutlooks, type LoanListData } from "./loan-list";
import { loanListSummary, type LoanListEntry, type LoanListSummary } from "./loan-list-summary";
import { readLoanRow } from "./loan-detail-data";

/**
 * FLOW-1316: each loan with its outlook from `loan_outlooks`. A loan absent from the answer (a demand or closed loan)
 * has none, and adds its balance only; so does one the answer holds only for a late mark (no next payment).
 */
export function summaryEntries(loans: LoanListData["loans"], outlooks: LoanOutlooks): LoanListEntry[] {
  const byLoan = new Map(outlooks.map((outlook) => [outlook.loan_id, outlook]));
  return loans.map(({ row, balance }) => {
    const outlook = byLoan.get(row.id);
    const next = outlook?.next;
    return {
      loan: readLoanRow(row, balance),
      outlook: next == null
        ? null
        : {
            next: { dueDate: next.due_date, principalMinor: next.principal_minor, interestMinor: next.interest_minor, escrowMinor: next.escrow_minor },
            aheadMinor: outlook?.ahead_minor ?? next.amount_minor,
          },
    };
  });
}

/**
 * FLOW-139. The summary card's figures for one currency. It reads the list's own query and the outlooks' (the same
 * keys as the list, so each is read once; FLOW-1316: the outlooks are `loan_outlooks`, whose `ahead_minor` is summed
 * for the currency). Null until both are read.
 */
export function useLoanSummary(companyId: string | null, currency: LoanCurrency | null): LoanListSummary | null {
  const on = companyId != null && currency != null;
  const list = useQuery({
    queryKey: ["loans", companyId, "list"],
    enabled: on,
    retry: false,
    queryFn: () => readLoanList(companyId),
  });
  const outlooks = useLoanOutlooks(on ? companyId : null);
  const loans = list.data?.loans;
  const answer = outlooks.data;
  return useMemo(
    () => (currency == null || loans == null || answer == null ? null : loanListSummary(summaryEntries(loans, answer), currency)),
    [currency, loans, answer],
  );
}
