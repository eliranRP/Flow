import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

/** Refetch these when the window focuses or the document becomes visible. Decision 0080. */
export const LEDGER_FOCUS_KEYS = [
  "review",
  "dashboard",
  "unpaid",
  "project",
  "project-category",
  "project-waiting",
  "filed-today",
  "txn",
] as const;

export function refreshLedger(client: { invalidateQueries: (filters: { queryKey: readonly string[] }) => Promise<unknown> }): void {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  for (const key of LEDGER_FOCUS_KEYS) {
    void client.invalidateQueries({ queryKey: [key] });
  }
}

export function LedgerFocusRefresh() {
  const client = useQueryClient();
  useEffect(() => {
    function onFocus() {
      refreshLedger(client);
    }
    function onVisibility() {
      if (document.visibilityState === "visible") refreshLedger(client);
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [client]);
  return null;
}
