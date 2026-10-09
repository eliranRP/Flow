import { type ReviewRow } from "@flow/shared";
import { useEffect, useRef, useState } from "react";
import * as reviewE2eFixture from "../dev/review-e2e-fixture";
import { type JevShown } from "./jev-review";
import { focusReviewEmptyAction, takeReviewFocus } from "./review-focus";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { ReviewPushPrompt } from "./review-push-prompt";
import type { NotificationPrefs, PushSupport } from "../push";
import { ReviewIcon } from "../ui/icons";
import { skippedListPath, useSkippedReviewQuery } from "./review-skipped";
import { ReviewSkippedLink } from "../ui/review-skipped-list";
import { ScreenHeader } from "../ui/screen-header";

export const EMPTY_REVIEW: ReviewRow[] = [];

/** The card line that opened the picker. The sheet focuses it after close. */
export const reviewLineFocus: {
  project: { current: HTMLButtonElement | null };
  category: { current: HTMLButtonElement | null };
} = {
  project: { current: null },
  category: { current: null },
};

/** Dev-only fixture. A production build folds this to null and drops the module. */
export const reviewE2e = import.meta.env.DEV ? reviewE2eFixture : null;

export function useE2eReviewRows(active: boolean, size?: number): ReviewRow[] {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!import.meta.env.DEV || !active || reviewE2e == null) return;
    return reviewE2e.subscribe(() => {
      bump((n) => n + 1);
    });
  }, [active]);
  if (!import.meta.env.DEV || !active || reviewE2e == null) return EMPTY_REVIEW;
  return reviewE2e.currentRows(size);
}

export function reviewListPath(search: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.delete("item");
  params.delete("from");
  params.delete("pick");
  params.delete("list");
  const text = params.toString();
  return text === "" ? "/review/all" : `/review/all?${text}`;
}

export function rotateReview<T extends { id: string }>(rows: T[], id: string): T[] {
  const index = rows.findIndex((row) => row.id === id);
  if (index <= 0) return rows;
  return [...rows.slice(index), ...rows.slice(0, index)];
}

/** Keeps a card opened from the list, then the item that followed it once that card leaves. */
export function queueAfterFocus<T extends { id: string }>(
  rows: T[],
  focusId: string,
  prior: readonly T[] | null,
): { rows: T[]; order: T[] } {
  if (rows.some((row) => row.id === focusId)) {
    const order = rotateReview(rows, focusId);
    return { rows: order, order };
  }
  const index = prior?.findIndex((row) => row.id === focusId) ?? -1;
  const rest = prior == null || index < 0 ? [] : [...prior.slice(index + 1), ...prior.slice(0, index)];
  const nextId = rest.find((row) => rows.some((item) => item.id === row.id))?.id;
  const order = nextId ? rotateReview(rows, nextId) : rows;
  return { rows: order, order };
}

/** The list card under a line picker. from=all opens it; list=all keeps it while the picker is open. */
export function listFocusId(params: URLSearchParams): string | null {
  const item = params.get("item");
  if (item == null || item === "") return null;
  if (params.get("from") === "all" || params.get("list") === "all") return item;
  return null;
}

export function assignmentPath(
  changeTo: string | undefined,
  search: string,
  id: string,
  pick?: "project" | "category",
  fromList = false,
  fromLine = false,
): string {
  const base = changeTo ?? `/review/change${search}`;
  const [path, query = ""] = base.split("?");
  const params = new URLSearchParams(query);
  params.set("item", id);
  if (pick) params.set("pick", pick);
  else params.delete("pick");
  if (fromLine) {
    params.set("from", "line");
    if (fromList) params.set("list", "all");
    else params.delete("list");
  } else if (fromList) {
    params.set("from", "all");
    params.delete("list");
  }
  return `${String(path)}?${params.toString()}`;
}

export function listPlace(rows: ReviewRow[], ordered: ReviewRow[], fromList: boolean): { index: number; total: number } | undefined {
  if (!fromList) return undefined;
  const head = ordered[0];
  if (!head) return undefined;
  const index = rows.findIndex((row) => row.id === head.id);
  if (index < 0) return undefined;
  return { index: index + 1, total: rows.length };
}

/** הצג הכול with nothing waiting, above the skipped section. */
export const REVIEW_NONE_WAITING = "אין פריטים שמחכים לאישור.";

/** "project · category" for the statement row's ✦ line: what the card shows (U11). FLOW-305. */
export function statementSuggestion(row: ReviewRow): string | null {
  const suggestion = reviewSuggestion(row);
  if (suggestion == null) return null;
  return [suggestion.project, suggestion.category].filter((part) => part != null).join(" · ");
}

/** `jev` marks the fields whose shown value is Jev's fill, so the card says הצעת Jev there. */
export function reviewSuggestion(row: ReviewRow, reversal = false, jev?: JevShown) {
  const split = reviewIsSplit(row);
  const project = split ? reviewSplitTitle(row) : row.project_name || undefined;
  const category = row.category_name || undefined;
  if (!project && !category) return undefined;
  const categorySuggested = Boolean(category) && row.category_suggested !== false;
  const projectSuggested = !split && row.project_suggested === true;
  return {
    ...(project ? { project } : {}),
    ...(category ? { category } : {}),
    ...(projectSuggested ? { projectSuggested: true } : {}),
    ...(categorySuggested ? { categorySuggested: true } : {}),
    ...(projectSuggested && jev?.project === true ? { projectJev: true } : {}),
    ...(categorySuggested && jev?.category === true ? { categoryJev: true } : {}),
    ...(reversal && category ? { categoryReversal: true } : {}),
  };
}

export function ReviewEmpty({
  search,
  filtered = false,
  homeTo,
  homeLabel,
  backTo,
  skippedLink = false,
  pushPrompt = false,
  pushSample,
}: {
  search: string;
  filtered?: boolean;
  homeTo?: string;
  homeLabel?: string;
  backTo?: string;
  /** FLOW-309, owner pick 2026-10-08: "N פריטים דולגו" under the action when cards were skipped. */
  skippedLink?: boolean;
  /** FLOW-502: the one-time "תזכורת בערב" card under the action. */
  pushPrompt?: boolean;
  /** Stories: the card's prefs and this browser's support, instead of the live read. */
  pushSample?: { prefs: NotificationPrefs; support: PushSupport };
}) {
  const skipped = useSkippedReviewQuery(skippedLink && !filtered);
  // FLOW-309: the last card left with focus in its action bar; the action takes it (after the title's).
  // A ref, so StrictMode's second run of the effect still knows (the title focuses itself again).
  const handed = useRef<boolean | null>(null);
  useEffect(() => {
    handed.current ??= takeReviewFocus();
    if (handed.current) focusReviewEmptyAction();
  }, []);
  const skippedCount = skippedLink && !filtered && !skipped.isError ? (skipped.data?.length ?? 0) : 0;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ScreenHeader title="לאישור" subtitle="תנועות שמחכות לשיוך" backTo={backTo} layout="inline" />
      <EmptyState
        icon={<ReviewIcon />}
        title={filtered ? "אין פריטים לאישור בפרויקט הזה" : "הכל מאושר"}
        body={filtered ? "אין פריטים של הפרויקט הזה בתור." : "אין פריטים שמחכים לך. נעדכן כשיגיע משהו חדש."}
        action={(
          <>
            <Button variant="pill" to={homeTo ?? `/${search}`}>{homeLabel ?? "לדף הבית"}</Button>
            <ReviewSkippedLink count={skippedCount} to={skippedListPath(reviewListPath(search))} />
          </>
        )}
        aside={pushPrompt && !filtered ? <ReviewPushPrompt sample={pushSample?.prefs} support={pushSample?.support} /> : null}
      />
    </div>
  );
}

/**
 * FLOW-327 r1: the line names its party. An income line's party is its customer, so a new customer
 * reads "לקוח חדש · בלי היסטוריה".
 */
export function reviewHasParty(row: Pick<ReviewRow, "direction" | "supplier_name"> & { customer_name?: string | null }): boolean {
  const party = row.direction === "income" ? row.customer_name ?? row.supplier_name : row.supplier_name;
  return party != null && party !== "";
}

export function reviewIsSplit(row: { reason?: string | null; pnl_role?: string | null; share_count?: number | null } | null | undefined): boolean {
  if (!row) return false;
  return row.pnl_role === "shared" || (row.share_count ?? 0) > 1 || row.reason === "unallocated_shared";
}

export function reviewSplitTitle(row: { project_name?: string | null; share_count?: number | null; reason?: string | null }): string {
  if ((row.share_count ?? 0) > 1) return `מפוצל · ${String(row.share_count)} פרויקטים`;
  if (row.project_name) return row.project_name;
  return "עלות משותפת · טרם פוצלה";
}
