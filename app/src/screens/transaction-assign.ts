/**
 * The transaction page's project and category picks (FLOW-1165). The page's assignment writes and their
 * ביטול run one after another in one scope, so a second pick waits for the first; each pick's write
 * sets the undo id the server returned on its own payload, and its ביטול undoes that id.
 */

/** A pick's write: the next ids, the screen as it was before the tap (for a rollback), and the undo id the write got. */
export type PickBack = {
  next: { projectId: string; categoryId: string };
  back: { projectId: string; categoryId: string; projectName: string; categoryName: string; committed: { projectId: string; categoryId: string } };
  undoId?: string | null;
};

/** The scope the page's assignment writes share. */
export function assignScope(transactionId: string): string {
  return `txn-assign:${transactionId}`;
}

/**
 * A line split between projects, or a shared cost not yet split: its project row opens the split, and a
 * pick changes its category only. (The review card's `reviewIsSplit` reads the same from the queue's row.)
 */
export function txnSplitLike(txn: { pnl_role?: string | null; review_reason?: string | null; allocations?: readonly unknown[] | null }): boolean {
  return txn.pnl_role === "shared" || txn.review_reason === "unallocated_shared" || (txn.allocations?.length ?? 0) > 1;
}
