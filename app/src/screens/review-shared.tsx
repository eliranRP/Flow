import { type ReviewRow } from "@flow/shared";
import { useEffect, useRef, useState } from "react";
import * as reviewE2eFixture from "../dev/review-e2e-fixture";
import type { ReviewCase } from "../dev/review-e2e-fixture";
import { type JevShown } from "./jev-review";
import type { ReviewPaging } from "../use-review";
import { focusReviewEmptyAction, takeReviewFocus } from "./review-focus";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { ReviewPushPrompt } from "./review-push-prompt";
import type { NotificationPrefs, PushSupport } from "../push";
import { CheckIcon } from "../ui/icons";
import { ReviewIcon } from "../ui/icons-later";
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

export function useE2eReviewRows(active: boolean, size?: number, kind?: ReviewCase | null): ReviewRow[] {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!import.meta.env.DEV || !active || reviewE2e == null) return;
    return reviewE2e.subscribe(() => {
      bump((n) => n + 1);
    });
  }, [active]);
  if (!import.meta.env.DEV || !active || reviewE2e == null) return EMPTY_REVIEW;
  return reviewE2e.currentRows(size, kind);
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

/** `total` is every open item when only some pages are loaded (FLOW-984); `rows` is the loaded ones. */
export function listPlace(rows: ReviewRow[], ordered: ReviewRow[], fromList: boolean, total = rows.length): { index: number; total: number } | undefined {
  if (!fromList) return undefined;
  const head = ordered[0];
  if (!head) return undefined;
  const index = rows.findIndex((row) => row.id === head.id);
  if (index < 0) return undefined;
  return { index: index + 1, total: Math.max(total, rows.length) };
}

/** FLOW-984: a page of the queue did not load. A quiet row where the next card would be, with the retry. */
export function ReviewMoreFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="ui-review-next t-caption t-muted" role="status">
      <span>לא הצלחנו לטעון עוד פריטים</span>
      <Button variant="link" onClick={onRetry}>ניסיון חוזר</Button>
    </div>
  );
}

/**
 * FLOW-984: the end of a list that loads in pages. One screen before this mark scrolls into view the next
 * page starts loading; a failed page leaves the quiet row with its retry.
 */
export function ReviewListEnd({ paging }: { paging: ReviewPaging }) {
  const mark = useRef<HTMLDivElement>(null);
  const { more, failed, loading, loadMore, retry } = paging;
  useEffect(() => {
    const node = mark.current;
    if (node == null || !more || failed) return;
    // Without the observer (an old browser) the pages come one after another.
    if (typeof IntersectionObserver === "undefined") {
      loadMore();
      return;
    }
    const watch = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    }, { rootMargin: "0px 0px 100% 0px" });
    watch.observe(node);
    return () => { watch.disconnect(); };
  }, [more, failed, loading, loadMore]);
  if (!more) return null;
  if (failed) return <ReviewMoreFailed onRetry={retry} />;
  // FLOW-1016: while the next page loads the list's end says so, not an empty gap.
  return (
    <div ref={mark} data-review-more="" role="status" className="t-caption t-muted ui-review-more">
      {loading ? "טוענים עוד…" : null}
    </div>
  );
}

/**
 * FLOW-1016: the cards loaded are used up and the next page is on its way. The queue keeps its frame, with the
 * card's place drawn as a skeleton, rather than the whole-screen loader. FLOW-1137: the queue's first load draws
 * it too, and says "טוען…" (`status`).
 */
export function ReviewCardLoading({ status = "טוענים עוד…" }: { status?: string } = {}) {
  return (
    <div className="ui-skel-card ui-review-card-loading" aria-busy="true">
      <p className="sr-only" role="status">{status}</p>
      {SKELETON_LINES.map(([width, height]) => (
        <span key={width} aria-hidden="true" className="ui-skeleton-bar" style={{ inlineSize: width, blockSize: height, flex: "none" }} />
      ))}
    </div>
  );
}

/** The card's lines as the skeleton draws them: the source pill, the payee, the amount, then the two fields. */
const SKELETON_LINES = [["30%", 12], ["60%", 18], ["45%", 32], ["85%", 44], ["80%", 44]] as const;

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

/** FLOW-1049: the done frame's count line: what was approved today, by hand on this visit and automatically. */
export function reviewDoneLine(count: number): string {
  return count === 1 ? "שורה אחת אושרה היום" : `${String(count)} שורות אושרו היום`;
}

export function ReviewEmpty({
  search,
  filtered = false,
  homeTo,
  homeLabel,
  backTo,
  pushPrompt = false,
  pushSample,
  done,
}: {
  search: string;
  filtered?: boolean;
  homeTo?: string;
  homeLabel?: string;
  backTo?: string;
  /** FLOW-502: the one-time "תזכורת בערב" card under the action. */
  pushPrompt?: boolean;
  /** Stories: the card's prefs and this browser's support, instead of the live read. */
  pushSample?: { prefs: NotificationPrefs; support: PushSupport };
  /** FLOW-365b: the queue just emptied. What this visit approved, and the auto count of the day. */
  done?: { approved: number; auto: number };
}) {
  // FLOW-309: the last card left with focus in its action bar; the action takes it (after the title's).
  // A ref, so StrictMode's second run of the effect still knows (the title focuses itself again).
  const handed = useRef<boolean | null>(null);
  const finished = done != null && !filtered;
  useEffect(() => {
    handed.current ??= takeReviewFocus();
    if (handed.current) focusReviewEmptyAction();
  }, []);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ScreenHeader title="לאישור" backTo={backTo ?? "/"} backText={backTo == null ? "בית" : undefined} />
      {/* FLOW-1049 (V3-Review): the queue just emptied: a check in a tint circle, "הכול אושר", the day's count, and one way home. */}
      <div className={finished ? "ui-review-done" : undefined}>
        <EmptyState
          icon={finished ? <CheckIcon size={28} stroke={2.2} /> : <ReviewIcon />}
          title={filtered ? "אין פריטים לאישור בפרויקט הזה" : finished ? "הכול אושר" : "הכל מאושר"}
          body={filtered
            ? "אין פריטים של הפרויקט הזה בתור."
            : done == null
              ? "אין פריטים שמחכים לך. נעדכן כשיגיע משהו חדש."
              : reviewDoneLine(done.approved + done.auto)}
          action={finished ? (
            <Button variant="link" to={homeTo ?? `/${search}`}>{homeLabel ?? "חזרה לבית"}</Button>
          ) : (
            <>
              <Button full to={homeTo ?? `/${search}`}>{homeLabel ?? "חזרה לבית"}</Button>
              {filtered ? null : <Button variant="link" to={`/review/filed${search}`}>מה אושר היום</Button>}
            </>
          )}
          aside={pushPrompt && !filtered ? <ReviewPushPrompt sample={pushSample?.prefs} support={pushSample?.support} /> : null}
        />
      </div>
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
