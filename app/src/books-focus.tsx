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
  "breakdown",
  "breakdown-lines",
  "missing-bills",
  "expected-months",
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
    let pending = false;
    let alive = true;
    function schedule() {
      if (pending || !alive) return;
      pending = true;
      queueMicrotask(() => {
        pending = false;
        if (!alive) return;
        refreshLedger(client);
      });
    }
    function onFocus() {
      schedule();
    }
    function onVisibility() {
      if (document.visibilityState === "visible") schedule();
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [client]);
  return null;
}
