import { useQuery } from "@tanstack/react-query";
import { useHomePreview } from "./preview";
import { readyClient } from "./ready-client";

/** Home's row: the bills not refunded, a count and a sum per currency (FLOW-1143: Flow suggests nothing). */
export type UtilityRefundCount = {
  notRefunded: number;
  totals: { currency: string; minor: bigint }[];
};

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new Error("count_utility_refunds");
  return value;
}

/** count_utility_refunds's answer, checked by hand: zod stays out of Home's first load. */
export function parseUtilityRefundCount(data: unknown): UtilityRefundCount {
  if (data == null || typeof data !== "object") throw new Error("count_utility_refunds");
  const body = data as Record<string, unknown>;
  const totals = Array.isArray(body.not_refunded_by_currency) ? body.not_refunded_by_currency : [];
  return {
    notRefunded: count(body.not_refunded_count),
    totals: totals.map((row: unknown) => {
      const item = (row ?? {}) as { currency?: unknown; amount_minor?: unknown };
      if (typeof item.currency !== "string" || (typeof item.amount_minor !== "number" && typeof item.amount_minor !== "string")) {
        throw new Error("count_utility_refunds");
      }
      return { currency: item.currency, minor: BigInt(item.amount_minor) };
    }),
  };
}

/**
 * FLOW-1135 (decision 0265): Home's "N חשבונות לא הוחזרו" row. Its own small file, so Home's first load takes
 * neither the list's schema nor the screen's code (as transfer-match-count.ts). A failed read just hides the row.
 */
export function useUtilityRefundCountQuery() {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["utility-refund-count", preview],
    enabled: preview === "off",
    queryFn: async (): Promise<UtilityRefundCount> => {
      const supabase = await readyClient();
      const { data, error } = await supabase.rpc("count_utility_refunds", {});
      if (error) throw error;
      return parseUtilityRefundCount(data);
    },
  });
}
