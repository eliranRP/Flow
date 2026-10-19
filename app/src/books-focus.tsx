import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { LEDGER_KEYS } from "./ledger-keys";

/** A focus refresh runs at most this often, so tab switches do not refetch every read. */
const FOCUS_REFRESH_GAP_MS = 5 * 60_000;

/** Refetch the ledger reads when the window focuses or the document becomes visible. Decision 0080. Returns whether it ran. */
export function refreshLedger(client: { invalidateQueries: (filters: { queryKey: readonly string[] }) => Promise<unknown> }): boolean {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;
  for (const key of LEDGER_KEYS) {
    void client.invalidateQueries({ queryKey: [key] });
  }
  return true;
}

export function LedgerFocusRefresh() {
  const client = useQueryClient();
  const last = useRef(Number.NEGATIVE_INFINITY);
  useEffect(() => {
    let pending = false;
    let alive = true;
    function schedule() {
      if (pending || !alive) return;
      if (Date.now() - last.current < FOCUS_REFRESH_GAP_MS) return;
      pending = true;
      queueMicrotask(() => {
        pending = false;
        if (!alive) return;
        if (refreshLedger(client)) last.current = Date.now();
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
