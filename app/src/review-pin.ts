/**
 * The line the owner is working on in לאישור. It stays the head card across refetches and a
 * trip to the project or category picker, so a reorder can't put another line under אישור.
 * Module state, because the queue unmounts while /review/change is open.
 *
 * ביטול sets a hold on the line it brings back (FLOW-327 r1). Until that line is the card on
 * screen, the queue's own pin of the card it shows cannot replace it, so the next card can't stay
 * on screen after the undo. The hold clears when the held line is shown, when its reopen fails,
 * or with a null pin (sign-out, a test reset).
 */
let pinned: string | null = null;
let held: string | null = null;

export function pinReviewLine(transactionId: string | null | undefined, options?: { hold?: boolean }): void {
  const next = transactionId ?? null;
  if (next == null) {
    pinned = null;
    held = null;
    return;
  }
  if (options?.hold === true) {
    pinned = next;
    held = next;
    return;
  }
  if (held != null) {
    // Another line while the undone one is on its way back: keep the hold.
    if (next !== held) return;
    held = null;
  }
  pinned = next;
}

export function reviewPin(): string | null {
  return pinned;
}

/** The line ביטול is bringing back, or null. */
export function reviewHold(): string | null {
  return held;
}

/** Drops the hold on `transactionId` (its reopen failed). The queue's next pin then takes over. */
export function releaseReviewHold(transactionId: string | null | undefined): void {
  if (transactionId != null && held === transactionId) held = null;
}

/** Moves the pinned line to the head. Rows keep their order otherwise; a missing pin is ignored. */
export function pinReviewHead<T extends { transaction_id?: string | null }>(rows: T[], pin: string | null): T[] {
  if (pin == null) return rows;
  const at = rows.findIndex((row) => row.transaction_id === pin);
  if (at <= 0) return rows;
  return [rows[at] as T, ...rows.slice(0, at), ...rows.slice(at + 1)];
}
