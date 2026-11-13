import type { RefObject } from "react";
import { getSupabase } from "../lib/supabase";
import { assertNoError } from "../use-write";
import { Button } from "../ui/button";
import { CheckIcon } from "../ui/icons";
import { REVIEW_HELD_HINT_ID } from "../ui/review-card";

/**
 * FLOW-1166: אישור on a closed_month_change card leaves the line as it is (leave_held_change, owner or
 * editor): the held change is kept aside and the row is approved. It runs as the queue's own approve, so a
 * second tap waits for it and a failure puts the card back with the queue's usual toast.
 */
export async function leaveHeldChange(reviewId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  assertNoError(await supabase.rpc("leave_held_change", { p_review_id: reviewId }));
}

/**
 * FLOW-1166: the held card's bar. אישור is its one action: שינוי (a project, category or split) would be
 * refused on a closed line, and דלג would only bring the same card back, so neither is offered. It points
 * at the card's hint.
 */
export function ReviewHeldBar({
  approveSlot,
  disabled,
  onApprove,
}: {
  approveSlot: RefObject<HTMLDivElement | null>;
  disabled: boolean;
  onApprove: () => void;
}) {
  return (
    <div className="ui-action-bar-row ui-review-actions ui-review-actions-one">
      <div className="ui-review-approve" ref={approveSlot}>
        <Button full disabled={disabled} icon={<CheckIcon />} aria-describedby={REVIEW_HELD_HINT_ID} onClick={onApprove}>
          אישור
        </Button>
      </div>
    </div>
  );
}
