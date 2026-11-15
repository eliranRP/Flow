import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { invokeEdge } from "./edge";
import { LEDGER_KEYS } from "./ledger-keys";
import { hebrewSumitError } from "./sumit-copy";
import { useWrite } from "./use-write";
import { useToast } from "./ui/toast";
import type { ToastInput } from "./ui/toast-layout";

export const REFRESH_DONE = "הרענון הסתיים.";

/**
 * Calls one tap makes at most (FLOW-1163). A SUMIT company with more than 20 pages of documents is
 * pulled over several runs; a run that stops at the page cap answers `partial: true`, and the tap
 * calls again until an answer is complete. At the bound the tap still ends with the finished toast:
 * the pull continues at the next sync, as it does for the cron.
 */
export const REFRESH_CALL_CAP = 10;

function answers(data: unknown, key: "skipped" | "partial"): boolean {
  return data != null && typeof data === "object" && key in data && (data as Record<string, unknown>)[key] === true;
}

/**
 * One SUMIT refresh, as the connector's "רענון עכשיו" starts it: the sumit-sync edge call with
 * force. A run another tab or an earlier load already holds shows as syncing, with no skip toast.
 * The connections screen and Unpaid (FLOW-335, after a mark) share it. `shape` places its toasts as the
 * screen's others (the invoice pages: under the header, a note 4s, decision 0218).
 */
export function useSumitRefresh(shape?: (input: ToastInput) => ToastInput) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  return useWrite({
    failure: (error) => hebrewSumitError(error.message) ?? "הרענון נכשל.",
    silent: (error) => error.message === "sync_held",
    ...(shape
      ? { place: shape({ message: REFRESH_DONE }).place, onSuccess: () => { toast.show(shape({ message: REFRESH_DONE })); } }
      : { success: REFRESH_DONE }),
    keys: LEDGER_KEYS,
    run: async () => {
      // Each call is a forced refresh, as the first. An error or a skipped answer ends the loop at once
      // (an error throws, a skip is handled below); leaving the screen ends it between calls.
      for (let call = 0; call < REFRESH_CALL_CAP; call += 1) {
        const data = await invokeEdge("sumit-sync", { force: true });
        if (answers(data, "skipped")) {
          await queryClient.refetchQueries({ queryKey: ["sumit"] });
          const held = queryClient.getQueriesData<{ syncing?: boolean }>({ queryKey: ["sumit"] }).some(([, d]) => d?.syncing === true);
          throw new Error(held ? "sync_held" : "sync_skipped");
        }
        if (!answers(data, "partial") || !mounted.current) return;
      }
    },
  });
}
