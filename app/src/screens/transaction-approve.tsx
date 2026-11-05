import { useState } from "react";
import { approveFailure, approveShown } from "../approve-review";
import { getSupabase } from "../lib/supabase";
import { Button } from "../ui/button";
import { useToast } from "../ui/toast";
import { topToast } from "../ui/top-toast";
import { useInvalidateBooks } from "../use-books";
import { assertNoError, useWrite } from "../use-write";

/** What an approve writes, and its undo (the review reopened). */
type ApproveWrite = { reviewId: string; projectId: string; categoryId: string; undo: boolean };

/**
 * FLOW-1048 (V3-Transaction): the pinned אישור approves the line in place (approve_review_item with the values on
 * screen, as the queue does); its toast's ביטול reopens the review. `approved` hides the bar at once. A sample
 * writes nothing.
 */
export function useTxnApprove({ live, keys }: { live: boolean; keys: readonly string[] }) {
  const toast = useToast();
  const invalidate = useInvalidateBooks();
  const [approved, setApproved] = useState(false);
  const write = useWrite<ApproveWrite>({
    failure: approveFailure,
    keys,
    place: "top",
    onSuccess: (done) => {
      if (done.undo) {
        setApproved(false);
        return;
      }
      toast.show(topToast({
        message: "אושר",
        action: "ביטול",
        onAction: () => {
          write.mutate({ ...done, undo: true });
        },
      }));
    },
    onError: (_error, done) => {
      if (!done.undo) setApproved(false);
    },
    run: async (input) => {
      if (!input.undo) setApproved(true);
      if (!live) return;
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      if (input.undo) {
        assertNoError(await supabase.rpc("reopen_review", { p_id: input.reviewId }));
        return;
      }
      await approveShown(supabase, { id: input.reviewId, projectId: input.projectId, categoryId: input.categoryId, shownProjectId: input.projectId, shownCategoryId: input.categoryId }, () => invalidate());
    },
  });
  return { approved, write };
}

/**
 * The pending line's bar, pinned at the bottom: אישור (in place when `approve` is given, else it opens the line in
 * the queue) and שינוי, which opens the change sheet.
 */
export function TxnApproveBar({ approve, busy, reviewTo, onChange }: {
  approve: (() => void) | null;
  busy: boolean;
  reviewTo: string;
  onChange: () => void;
}) {
  return (
    <div className="ui-txn-approve" role="group" aria-label="השורה מחכה לאישור שלך">
      {approve != null ? (
        <Button full busy={busy} onClick={approve}>אישור</Button>
      ) : (
        <Button full to={reviewTo}>אישור</Button>
      )}
      <Button variant="secondary" onClick={onChange}>שינוי</Button>
    </div>
  );
}
