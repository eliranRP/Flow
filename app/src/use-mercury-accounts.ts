import { useRef } from "react";
import { invokeEdge, isRecord } from "./edge";
import { getSupabase } from "./lib/supabase";
import { LEDGER_KEYS } from "./ledger-keys";
import { hebrewMercuryError, mercuryRefreshDone } from "./mercury-copy";
import { useInvalidateBooks } from "./use-books";
import { useToast } from "./ui/toast";
import { topToast } from "./ui/top-toast";
import { assertNoError, useWrite } from "./use-write";

/** How long the save waits for the first sync's count before it says connected without it. */
export const FIRST_SYNC_WAIT_MS = 8000;

/**
 * One save of a connection's accounts (FLOW-938): `connect` is step 3 of a new connection, `edit` the
 * synced accounts list, `answer` the reply to a new account. `from` is the server's p_from: "start", a
 * day, or null for its default (start at the first choice, today for an account added later).
 */
export type MercuryAccountsSave = {
  slot: number;
  accounts: readonly string[];
  from: string | null;
  kind: "connect" | "edit" | "answer";
  /** The toast for an answer (it names the account). */
  answer?: string;
};

function countWord(count: number): string {
  return count === 1 ? "חשבון אחד" : `${String(count)} חשבונות`;
}

function insertedOf(result: unknown): number | null {
  if (!isRecord(result) || typeof result.inserted !== "number" || !Number.isInteger(result.inserted)) return null;
  return result.inserted;
}

/**
 * Saves the accounts through set_mercury_accounts, then starts the sync that brings them in. A first
 * connect waits a few seconds for the count ("Mercury מחובר · 4 חשבונות · 214 תנועות נכנסו"); a sync
 * that takes longer goes on, and says what came in when it finishes.
 */
export function useMercuryAccounts({ onSuccess, place }: {
  onSuccess?: (save: MercuryAccountsSave) => void;
  /** The Mercury page puts its toasts under the header (decision 0223); setup's sheet keeps its place. */
  place?: "top";
} = {}) {
  const toast = useToast();
  const invalidate = useInvalidateBooks();
  const message = useRef("");
  return useWrite<MercuryAccountsSave>({
    keys: LEDGER_KEYS,
    failure: (error) => hebrewMercuryError(error.message) ?? "לא הצלחנו לשמור.",
    success: () => message.current,
    ...(place == null ? {} : { place }),
    onSuccess,
    run: async (save) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      // p_from takes null for the server's default; the generated types never mark RPC args nullable.
      const args = { p_slot: save.slot, p_accounts: [...save.accounts], p_from: save.from } as { p_slot: number; p_accounts: string[]; p_from: string };
      const saved = await supabase.rpc("set_mercury_accounts", args);
      assertNoError(saved);
      const reread = isRecord(saved.data) && saved.data.reread === true;
      const added = isRecord(saved.data) && typeof saved.data.added === "number" && saved.data.added > 0;
      const count = save.accounts.length;
      if (save.kind === "edit") message.current = `נשמר · ${countWord(count)} מסונכרנים`;
      else if (save.kind === "answer") message.current = save.answer ?? "נשמר";
      else message.current = `Mercury מחובר · ${countWord(count)}`;
      if (save.kind !== "connect" && !reread && !added) return;
      // The sync that brings the accounts in. Its failure does not undo the save: the next run catches up.
      const sync = invokeEdge("mercury-sync", { force: true }).then((result) => result, () => null);
      if (save.kind !== "connect") {
        void sync.then(() => invalidate(LEDGER_KEYS));
        return;
      }
      const first = await Promise.race([sync, new Promise<"waiting">((resolve) => { setTimeout(() => { resolve("waiting"); }, FIRST_SYNC_WAIT_MS); })]);
      if (first !== "waiting") {
        const inserted = insertedOf(first);
        if (inserted != null) message.current = `Mercury מחובר · ${countWord(count)} · ${String(inserted)} תנועות נכנסו`;
        return;
      }
      void sync.then(async (result) => {
        await invalidate(LEDGER_KEYS);
        if (result != null) toast.show(place == null ? { message: mercuryRefreshDone(result) } : topToast({ message: mercuryRefreshDone(result) }));
      });
    },
  });
}
