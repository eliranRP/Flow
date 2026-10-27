import { useQueryClient } from "@tanstack/react-query";
import { invokeEdge } from "./edge";
import { LEDGER_KEYS } from "./ledger-keys";
import { hebrewSumitError } from "./sumit-copy";
import { useWrite } from "./use-write";
import { useToast } from "./ui/toast";
import type { ToastInput } from "./ui/toast-layout";

export const REFRESH_DONE = "הרענון הסתיים.";

/**
 * One SUMIT refresh, as the connector's "רענון עכשיו" starts it: the sumit-sync edge call with
 * force. A run another tab or an earlier load already holds shows as syncing, with no skip toast.
 * The connections screen and Unpaid (FLOW-335, after a mark) share it. `shape` places its toasts as the
 * screen's others (the invoice pages: under the header, a note 4s, decision 0218).
 */
export function useSumitRefresh(shape?: (input: ToastInput) => ToastInput) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useWrite({
    failure: (error) => hebrewSumitError(error.message) ?? "הרענון נכשל.",
    silent: (error) => error.message === "sync_held",
    ...(shape
      ? { place: shape({ message: REFRESH_DONE }).place, onSuccess: () => { toast.show(shape({ message: REFRESH_DONE })); } }
      : { success: REFRESH_DONE }),
    keys: LEDGER_KEYS,
    run: async () => {
      const data = await invokeEdge("sumit-sync", { force: true });
      if (data != null && typeof data === "object" && "skipped" in data && data.skipped === true) {
        await queryClient.refetchQueries({ queryKey: ["sumit"] });
        const held = queryClient.getQueriesData<{ syncing?: boolean }>({ queryKey: ["sumit"] }).some(([, d]) => d?.syncing === true);
        throw new Error(held ? "sync_held" : "sync_skipped");
      }
    },
  });
}
