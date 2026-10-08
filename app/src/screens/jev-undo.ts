import { useState } from "react";
import { getSupabase } from "../lib/supabase";
import { assertNoError, isTransientWriteError, useWrite, type WriteFailure } from "../use-write";
import type { JevReviewState } from "./jev-review";

export const JEV_UNDO_DONE = "המילוי של Jev בוטל.";
export const JEV_UNDO_FAILED = "לא הצלחנו לבטל את המילוי.";
export const JEV_UNDO_NOTHING = "אין מילוי של Jev לבטל בשורה הזו.";
export const JEV_UNDO_CHANGED = "השורה השתנתה מאז המילוי, ולכן אי אפשר לבטל אותו.";
export const JEV_UNDO_CLOSED = "השורה כבר לא ממתינה לאישור.";

/** `undo_jev_prefill` refusals (decision 0145) as toasts. A refusal is final; a dropped connection retries. */
export function jevUndoFailure(error: Error): WriteFailure {
  if (/nothing to undo/i.test(error.message)) return { message: JEV_UNDO_NOTHING, tone: "info", retry: false };
  if (/line changed since/i.test(error.message)) return { message: JEV_UNDO_CHANGED, tone: "info", retry: false };
  if (/review item not found|transaction not found/i.test(error.message)) return { message: JEV_UNDO_CLOSED, tone: "info", retry: false };
  return { message: JEV_UNDO_FAILED, retry: isTransientWriteError(error) };
}

/**
 * בטל on "מולא ע״י Jev": calls `undo_jev_prefill`, then refetches the queue. The line stays in
 * לאישור with its values before. Until the Jev read refetches, the undone line is held here so
 * the card does not paint Jev's values again.
 */
export function useJevUndo() {
  const [undone, setUndone] = useState<ReadonlySet<string>>(() => new Set());
  const write = useWrite<string>({
    place: "bar",
    keys: ["review", "jev-review-queue", "dashboard", "project", "project-category", "project-waiting", "txn"],
    success: JEV_UNDO_DONE,
    failure: jevUndoFailure,
    run: async (transactionId) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("undo_jev_prefill", { p_transaction_id: transactionId }));
      setUndone((current) => new Set(current).add(transactionId));
    },
  });
  return {
    /** The card's Jev state with a line undone here marked undone. */
    stateFor(transactionId: string | null, state: JevReviewState): JevReviewState {
      if (transactionId == null || !undone.has(transactionId) || state.prefill == null) return state;
      const auto = state.prefill.auto ?? { projectId: null, categoryId: null };
      return { ...state, prefill: { ...state.prefill, auto: { ...auto, state: "undone" } } };
    },
    pendingFor(transactionId: string | null): boolean {
      return write.isPending && transactionId != null && write.variables === transactionId;
    },
    undo(transactionId: string) {
      if (write.isPending) return;
      write.mutate(transactionId);
    },
  };
}
