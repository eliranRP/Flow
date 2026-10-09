/** The app's אישור result. Decision 0080. stale and already_closed are info toasts. */
import type { getSupabase } from "./lib/supabase";
import { assertNoError, isTransientWriteError, type WriteFailure } from "./use-write";

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
  return "refused";
}

/** A deadlock or serialization failure from approve_review_item can be retried. */
export function isApproveRetry(error: Error): boolean {
  const code = (error as { code?: unknown }).code;
  if (code === "40P01" || code === "40001") return true;
  return /40P01|40001|deadlock detected|serialization failure/i.test(error.message);
}

/** The אישור toast (review queue, and the change sheet's split link, FLOW-325 §10). */
export function approveFailure(error: Error): WriteFailure {
  if (error instanceof ApproveNotice) return { message: error.message, tone: "info", retry: false };
  if (isApproveRetry(error) || isTransientWriteError(error)) return { message: APPROVE_FAILURE, retry: true };
  return { message: APPROVE_FAILURE, retry: false };
}

export const APPROVE_FAILURE = "לא הצלחנו לאשר.";

/**
 * approve_review_item with the values on screen, checked against the stored ones the owner saw
 * (decision 0080). stale and already_closed throw an ApproveNotice after refresh; not_found and
 * a refusal throw.
 */
export async function approveShown(
  supabase: NonNullable<ReturnType<typeof getSupabase>>,
  input: {
    id: string;
    projectId: string;
    categoryId: string;
    shownProjectId: string | null | undefined;
    shownCategoryId: string | null | undefined;
  },
  refresh: () => Promise<void>,
): Promise<void> {
  const result = await supabase.rpc("approve_review_item", {
    p_id: input.id,
    p_project_id: input.projectId,
    p_category_id: input.categoryId,
    p_remember: false,
    p_check_shown: true,
    ...(input.shownProjectId == null ? {} : { p_shown_project_id: input.shownProjectId }),
    ...(input.shownCategoryId == null ? {} : { p_shown_category_id: input.shownCategoryId }),
  });
  assertNoError(result);
  const outcome = readApproveOutcome(result.data);
  if (outcome === "stale" || outcome === "already_closed") {
    await refresh();
    throw new ApproveNotice(outcome);
  }
  if (outcome === "not_found") {
    await refresh();
    throw new Error("not_found");
  }
  if (outcome !== "ok") throw new Error("refused");
}
