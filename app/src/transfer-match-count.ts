import { useQuery } from "@tanstack/react-query";
import { useHomePreview } from "./preview";
import { readyClient } from "./ready-client";

/**
 * FLOW-941 (decision 0205): how many transfers between two Mercury connections Flow suggests, for
 * Home's דורש טיפול row (count_transfer_matches: the last 90 days). Its own small file, so Home's first
 * load takes neither the list's schema nor the screen's code. A failed read just hides the row.
 */
export function useTransferMatchCountQuery() {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["transfer-match-count", preview],
    enabled: preview === "off",
    queryFn: async (): Promise<number> => {
      const supabase = await readyClient();
      const { data, error } = await supabase.rpc("count_transfer_matches", {});
      if (error) throw error;
      if (typeof data !== "number" || !Number.isInteger(data) || data < 0) throw new Error("count_transfer_matches");
      return data;
    },
  });
}
