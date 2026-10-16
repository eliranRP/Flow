import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import type { LoanCurrency } from "./loan-form";
import { readLoanList, type LoanListData } from "./loan-list";
import { loanListSummary, type LoanListSummary } from "./loan-list-summary";
import { loanOutlook } from "./loan-outlook";
import { readLoanRow } from "./loan-detail-data";
import { israelToday } from "../ui/date-math";

/**
 * FLOW-139. The summary card's figures for one currency. It reads the list's own query (the same key,
 * so the loans are read once) and maps each loan to its outlook from today's Israeli-calendar date.
 * Null until the loans are read.
 */
export function useLoanSummary(companyId: string | null, currency: LoanCurrency | null): LoanListSummary | null {
  const today = israelToday();
  const summary = useQuery({
    queryKey: ["loans", companyId, "list"],
    enabled: companyId != null && currency != null,
    retry: false,
    queryFn: () => readLoanList(companyId),
    select: useCallback((data: LoanListData): LoanListSummary | null => {
      if (currency == null) return null;
      const entries = data.loans.map(({ row, balance }) => {
        const loan = readLoanRow(row, balance);
        return { loan, outlook: loanOutlook(loan, today) };
      });
      return loanListSummary(entries, currency);
    }, [currency, today]),
  });
  return summary.data ?? null;
}
