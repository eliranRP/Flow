import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "./lib/supabase";
import {
  composerAccounts,
  parseCopies,
  parseSaved,
  parseSuggestion,
  undoParts,
  type ComposerAccount,
  type JournalCopies,
  type JournalSuggestion,
  type SavedBooking,
} from "./line-composer";
import { useHomePreview } from "./preview";
import { assertNoError } from "./use-write";
import { waitForAccessToken } from "./wait-for-session";

/** FLOW-955. The composer's reads and its save, live. Stories and tests pass their own `ComposerApi`. */

/** What a booking refreshes: the line, its journal and split, and every total it reaches. */
export const COMPOSER_KEYS = ["txn", "line-split", "dashboard", "project", "project-category", "home", "breakdown", "breakdown-lines", "review", "jev-bookings"];

export type ComposerApi = {
  save: (legs: Array<{ account_id: string; amount_minor: number; project_id?: string }>) => Promise<SavedBooking>;
  /** ביטול: the split before the save goes back. */
  undo: (saved: SavedBooking) => Promise<void>;
};

export function liveComposerApi(transactionId: string): ComposerApi {
  return {
    save: async (legs) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      const result = await supabase.rpc("save_line_journal", { p_transaction_id: transactionId, p_legs: legs });
      assertNoError(result);
      return parseSaved(result.data);
    },
    undo: async (saved) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("save_line_split", { p_transaction_id: saved.transactionId, p_parts: undoParts(saved.before) }));
    },
  };
}

type Client = NonNullable<ReturnType<typeof getSupabase>>;

function useComposerRead<T>(name: string, transactionId: string, enabled: boolean, read: (supabase: Client) => Promise<T>) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["txn", name, preview, transactionId],
    enabled: enabled && preview === "off" && transactionId !== "",
    retry: 1,
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      return read(supabase);
    },
  });
}

/** The accounts a composer line can take (`mcp_accounts`, the same list book_line reads). */
export function useComposerAccountsQuery(enabled = true) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["composer-accounts", preview],
    enabled: enabled && preview === "off",
    retry: 1,
    queryFn: async (): Promise<ComposerAccount[]> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("mcp_accounts");
      if (error) throw error;
      return composerAccounts(data);
    },
  });
}

/** ✦ הצעה של Jev for one line, or null. */
export function useJournalSuggestionQuery(transactionId: string, enabled = true) {
  return useComposerRead("journal-suggestion", transactionId, enabled, async (supabase): Promise<JournalSuggestion | null> => {
    const { data, error } = await supabase.rpc("get_line_journal_suggestion", { p_transaction_id: transactionId });
    if (error) throw error;
    return parseSuggestion(data);
  });
}

/** כמו תנועה קודמת: the party's booked lines, each scaled to this line. */
export function useJournalCopiesQuery(transactionId: string, enabled = true) {
  return useComposerRead("journal-copies", transactionId, enabled, async (supabase): Promise<JournalCopies | null> => {
    const { data, error } = await supabase.rpc("get_line_journal_copies", { p_transaction_id: transactionId });
    if (error) throw error;
    return parseCopies(data);
  });
}
