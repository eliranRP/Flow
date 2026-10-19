import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { LEDGER_KEYS } from "./ledger-keys";

/** A focus refetch runs at most this often, so tab switches do not refetch every read. */
const FOCUS_REFRESH_GAP_MS = 5 * 60_000;

type LedgerClient = { invalidateQueries: (filters: { queryKey: readonly string[]; refetchType?: "none" }) => Promise<unknown> };

/**
 * Decision 0080: when the window focuses or the document becomes visible, the ledger reads go
 * stale. `refetch` refetches the ones on screen too; without it the next screen opened reads
 * again. Returns whether it ran (a hidden document does nothing).
 */
export function refreshLedger(client: LedgerClient, refetch = true): boolean {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;
  for (const key of LEDGER_KEYS) {
    void client.invalidateQueries(refetch ? { queryKey: [key] } : { queryKey: [key], refetchType: "none" });
  }
  return true;
}

export function LedgerFocusRefresh() {
  const client = useQueryClient();
  const last = useRef(0);
  useEffect(() => {
    // The page just read what it shows: the first refetch waits a full gap from load.
    last.current = Date.now();
    let pending = false;
    let alive = true;
    function schedule() {
      if (pending || !alive) return;
      pending = true;
      queueMicrotask(() => {
        pending = false;
        if (!alive) return;
        // Inside the gap, an outside change (an agent, the 5-minute server sync) still shows on
        // the next screen opened: the reads go stale, with no refetch now.
        const refetch = Date.now() - last.current >= FOCUS_REFRESH_GAP_MS;
        if (refreshLedger(client, refetch) && refetch) last.current = Date.now();
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
