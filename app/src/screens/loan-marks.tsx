import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { getSupabase } from "../lib/supabase";
import { assertNoError } from "../use-write";
import { AlertIcon } from "../ui/icons";

/** FLOW-107. A bank line with a loan split, as a transaction row shows it: its part count (FLOW-125), and whether a part waits for review. */
export type LoanMark = { parts: number; review: boolean };

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
    // One loan_splits row per part.
    for (const row of result.data ?? []) {
      const mark = marks.get(row.transaction_id) ?? { parts: 0, review: false };
      marks.set(row.transaction_id, { parts: mark.parts + 1, review: mark.review || row.needs_review });
    }
  }
  return marks;
}

/** The row props for a split line: its part count in the hint, or a warning while a part waits for review. */
export function loanRowProps(
  mark: LoanMark | undefined,
  hint: ReactNode,
): { hint: ReactNode; tone?: "warning"; icon?: ReactNode } {
  if (mark == null) return { hint };
  const words = mark.review ? "ממתין לבדיקה" : partsLabel(mark.parts);
  const joined = hint == null || hint === "" ? words : <>{words} · {hint}</>;
  if (mark.review) return { hint: joined, tone: "warning", icon: <AlertIcon /> };
  return { hint: joined };
}

export function partsLabel(parts: number): string {
  return parts === 1 ? "חלק אחד" : `${String(parts)} חלקים`;
}
