import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "../lib/supabase";
import { assertNoError } from "../use-write";
import { LOAN_DETAIL_COLUMNS, readLoanRow, type LoanDetail } from "./loan-detail-data";
import type { LoanListEntry } from "./loan-list-summary";
import { loanOutlook } from "./loan-outlook";
import { readLoanBalances } from "./loan-reads";

/**
 * FLOW-139. Every loan of a company with its outlook (its next payment and the payments ahead), for
 * the list's summary card. `today` is the Israeli-calendar date the outlook starts from.
 */
export function useLoanSummaryEntries(companyId: string | null, today: string) {
  return useQuery({
    queryKey: ["loans", companyId, "summary-entries", today],
    enabled: companyId != null,
    retry: false,
    queryFn: async (): Promise<LoanListEntry[]> => {
      const supabase = getSupabase();
      if (!supabase || companyId == null) return [];
      const loans = await supabase.from("loans").select(LOAN_DETAIL_COLUMNS).eq("company_id", companyId).order("name");
      assertNoError(loans);
      const balances = await readLoanBalances(supabase, companyId);
      return (loans.data ?? []).map((row) => {
        const balance = balances.get(row.id);
        const loan: LoanDetail = readLoanRow(row, balance == null ? null : {
          balanceMinor: BigInt(balance.balance_minor ?? 0),
          flaggedParts: balance.flagged_parts ?? 0,
        });
        return { loan, outlook: loanOutlook(loan, today) };
      });
    },
  });
}
