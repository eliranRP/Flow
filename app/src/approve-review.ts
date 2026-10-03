/** The app's אישור result. Decision 0080. stale and already_closed are info toasts. */

export class ApproveNotice extends Error {
  readonly code: "stale" | "already_closed";

  constructor(code: "stale" | "already_closed") {
    super(code === "stale" ? "השיוך עודכן. בדקו את הכרטיס." : "הפריט כבר טופל.");
    this.name = "ApproveNotice";
    this.code = code;
  }
}

export type ApproveOutcome = "ok" | "stale" | "already_closed" | "not_found" | "refused";

export function readApproveOutcome(data: unknown): ApproveOutcome {
  if (data == null) return "ok";
  if (typeof data !== "object") return "refused";
  const row = data as { ok?: unknown; error?: { code?: unknown } };
  if (row.ok === true) return "ok";
  const code = row.error?.code;
  if (code === "stale" || code === "already_closed" || code === "not_found") return code;
  if (row.ok === false) return "refused";
  return "ok";
}

/** A deadlock or serialization failure from approve_review_item can be retried. */
export function isApproveRetry(error: Error): boolean {
  return /40P01|40001|deadlock detected|serialization failure/i.test(error.message);
}
