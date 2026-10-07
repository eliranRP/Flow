import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { getSupabase } from "../lib/supabase";
import { assertNoError } from "../use-write";
import { AlertIcon } from "../ui/icons";

/** FLOW-107. A bank line with a loan split, as a transaction row shows it. */
export type LoanMark = "split" | "review";

const CHUNK = 100;

/**
 * The loan split mark of each listed line. The key starts with "loan-split",
 * so a loan match or a correction refreshes the rows too.
 */
export function useLoanMarks(ids: readonly string[], enabled = true): ReadonlyMap<string, LoanMark> {
  const sorted = [...new Set(ids)].sort();
  const query = useQuery({
    queryKey: ["loan-split", "marks", sorted],
    enabled: enabled && sorted.length > 0,
    retry: false,
    staleTime: 30_000,
    queryFn: () => readLoanMarks(sorted),
  });
  return query.data ?? EMPTY;
}

const EMPTY: ReadonlyMap<string, LoanMark> = new Map();

async function readLoanMarks(ids: readonly string[]): Promise<ReadonlyMap<string, LoanMark>> {
  const supabase = getSupabase();
  if (!supabase) return EMPTY;
  const marks = new Map<string, LoanMark>();
  for (let start = 0; start < ids.length; start += CHUNK) {
    const result = await supabase
      .from("loan_splits")
      .select("transaction_id, needs_review")
      .in("transaction_id", ids.slice(start, start + CHUNK));
    assertNoError(result);
    for (const row of result.data ?? []) {
      if (row.needs_review) marks.set(row.transaction_id, "review");
      else if (!marks.has(row.transaction_id)) marks.set(row.transaction_id, "split");
    }
  }
  return marks;
}

/** The row props for a split line: "3 חלקים" in the hint, or a warning while a part waits for review. */
export function loanRowProps(
  mark: LoanMark | undefined,
  hint: ReactNode,
): { hint: ReactNode; tone?: "warning"; icon?: ReactNode } {
  if (mark == null) return { hint };
  const words = mark === "review" ? "ממתין לבדיקה" : "3 חלקים";
  const joined = hint == null || hint === "" ? words : <>{words} · {hint}</>;
  if (mark === "review") return { hint: joined, tone: "warning", icon: <AlertIcon /> };
  return { hint: joined };
}
