import { useQueryClient } from "@tanstack/react-query";
import { invokeEdge } from "./edge";
import { hebrewSumitError } from "./sumit-copy";
import { useWrite } from "./use-write";

export const REFRESH_DONE = "הרענון הסתיים.";
export const SUMIT_REFRESH_KEYS = ["sumit", "dashboard", "unpaid", "review", "project"];

/**
 * One SUMIT refresh, as the connector's "רענון עכשיו" starts it: the sumit-sync edge call with
 * force. A run another tab or an earlier load already holds shows as syncing, with no skip toast.
 * The connections screen and Unpaid (FLOW-335, after a mark) share it.
 */
export function useSumitRefresh() {
  const queryClient = useQueryClient();
  return useWrite({
    failure: (error) => hebrewSumitError(error.message) ?? "הרענון נכשל.",
    silent: (error) => error.message === "sync_held",
    success: REFRESH_DONE,
    keys: SUMIT_REFRESH_KEYS,
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
