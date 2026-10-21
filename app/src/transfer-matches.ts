import { useQuery } from "@tanstack/react-query";
import type { z } from "zod";
import { getSupabase } from "./lib/supabase";
import { loadReadSchemas } from "./load-read-schemas";
import { useHomePreview } from "./preview";
import type { RpcClient } from "./recurring-actions";
import type { transferMatchesSchema } from "./transfer-match-schema";
import { assertNoError } from "./use-write";
import { waitForAccessToken } from "./wait-for-session";

/**
 * FLOW-941 (decision 0205): a transfer between two Mercury connections Flow suggests. Mercury may name a
 * recipient instead of the other organisation's account, so the transfer comes in as two lines; the user
 * says whether it is one transfer or a coincidence. Every pair is the server's (list_transfer_matches).
 */
export type TransferMatch = z.output<typeof transferMatchesSchema>[number];
export type TransferSide = TransferMatch["out"];

export const TRANSFER_MATCHES_KEY = "transfer-matches";

/** The suggestions. Home counts them; the screen lists them. A failed read just hides Home's row. */
export function useTransferMatchesQuery(active = true) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: [TRANSFER_MATCHES_KEY, preview],
    enabled: active && preview === "off",
    queryFn: async (): Promise<TransferMatch[]> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("list_transfer_matches", {});
      if (error) throw error;
      return (await loadReadSchemas()).transferMatchesSchema.parse(data);
    },
  });
}

/** One pair's key: its two lines. */
export function transferMatchKey(match: TransferMatch): string {
  return `${match.out.transaction_id}:${match.in.transaction_id}`;
}

/** An account as the card names it: its name and last 4 ("Operations ••4821"). */
export function transferAccountName(side: TransferSide): string {
  const name = side.account_name ?? "Mercury";
  return side.account_last4 == null ? name : `${name} ••${side.account_last4}`;
}

/** The answer: true (a transfer), false (a coincidence), or null to take it back (ביטול). */
export async function answerTransferMatch(client: RpcClient, match: TransferMatch, same: boolean | null): Promise<void> {
  assertNoError(
    await client.rpc("answer_transfer_match", {
      p_out_transaction_id: match.out.transaction_id,
      p_in_transaction_id: match.in.transaction_id,
      // null takes the answer back; the generated type shows the parameter as boolean only.
      p_same: same as boolean,
    }),
  );
}
