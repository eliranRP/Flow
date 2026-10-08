/**
 * The line the owner is working on in לאישור. It stays the head card across refetches and a
 * trip to the project or category picker, so a reorder can't put another line under אישור.
 * Module state, because the queue unmounts while /review/change is open.
 */
let pinned: string | null = null;

export function pinReviewLine(transactionId: string | null | undefined): void {
  pinned = transactionId ?? null;
}

export function reviewPin(): string | null {
  return pinned;
}

/** Moves the pinned line to the head. Rows keep their order otherwise; a missing pin is ignored. */
export function pinReviewHead<T extends { transaction_id?: string | null }>(rows: T[], pin: string | null): T[] {
  if (pin == null) return rows;
  const at = rows.findIndex((row) => row.transaction_id === pin);
  if (at <= 0) return rows;
  return [rows[at] as T, ...rows.slice(0, at), ...rows.slice(at + 1)];
}
