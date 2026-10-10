import { useCallback } from "react";
import { useLocation } from "react-router-dom";
import { FiledTodayScreen } from "../screens/filed-today-screen";
import { useTxnListMore } from "../txn-list-more";

/** The e2e lists the card walks: rows `t-step-1` and on, which the dev card route draws. */
function stepRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `t-step-${String(i + 1)}`,
    description: `תנועה ${String(i + 1)}`,
    doc_date: "2026-09-29",
    amount_net: BigInt(-(i + 1) * 10_000),
    direction: "expense" as const,
    supplier_name: `ספק ${String(i + 1)}`,
    project_name: "שיפוץ הרצל 12",
    category_name: "חומרים",
  }));
}

export function DevTxnList() {
  return <FiledTodayScreen backTo="/e2e/project" sample={stepRows(24)} />;
}

/**
 * FLOW-314: a paged list for the card's next-page probe. It shows 10 rows and registers a next page
 * that lands 1.5 s after it is asked for, with rows 11 to 20 and no page after.
 */
export function DevTxnPagedList() {
  const location = useLocation();
  const load = useCallback(
    () => new Promise<{ ids: readonly string[]; more: boolean }>((resolve) => {
      window.setTimeout(() => {
        resolve({ ids: stepRows(20).map((row) => row.id), more: false });
      }, 1500);
    }),
    [],
  );
  useTxnListMore(`${location.pathname}${location.search}`, true, load);
  return <FiledTodayScreen backTo="/e2e/project" sample={stepRows(10)} />;
}

