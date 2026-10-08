import { formatAmountText, formatMoney, type ProjectWaitingRow, type ReviewRow } from "@flow/shared";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { absAgorot } from "../agorot";
import * as reviewE2eFixture from "../dev/review-e2e-fixture";
import { useHoldWrites, useWriteGate, ViewerNote, ViewerScope } from "../use-is-viewer";
import { addTriggerRef } from "../add-trigger";
import { getSupabase } from "../lib/supabase";
import { useFlowSearch, useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase } from "../query-phase";
import { useCategoriesQuery, useDashboardQuery, useInvalidateBooks, useProjectWaitingQuery, useReviewQuery, useLineMetaPageQuery, useLineMetaQuery } from "../use-books";
import { ApproveNotice, isApproveRetry, readApproveOutcome } from "../approve-review";
import { LEDGER_FOCUS_KEYS } from "../books-focus";
import { filedTodayBannerTitle } from "../filed-today-copy";
import { useHeldOrder } from "../list-hold";
import { pinReviewHead, pinReviewLine, releaseReviewHold, reviewHold, reviewPin } from "../review-pin";
import { reviewFocusPath } from "../review-paths";
import { emptyVisit, noteHandled, notePresence, visitPlace } from "../visit-meter";
import { assertNoError, isTransientWriteError, useWrite } from "../use-write";
import { SAMPLE_TOAST } from "../setup/copy";
import { useJevQueue, useJevReview, useReviewFlags } from "./jev-review-card";
import { jevShown, withJev, type JevShown } from "./jev-review";
import { SetupSampleReview } from "../setup/sample-review";
import { Banner } from "../ui/banner";
import { Button } from "../ui/button";
import { formatDayMonth } from "../ui/date-math";
import { EmptyState } from "../ui/empty-state";
import { useGoBack } from "../ui/back";
import { IconButton } from "../ui/icon-button";
import { CameraIcon, CheckIcon, CloseIcon, PencilIcon, ReviewIcon } from "../ui/icons";
import { ListRow } from "../ui/list-row";
import { MonthList } from "../ui/month-list";
import { statementMethodOf } from "../ui/statement";
import { CHANGE_SAVE_FAILURE, ChangeAssignment, changeSaveFailure, COLLAPSE_SPLIT_NOTE, type ChangeChoice } from "../ui/change-sheet";
import { ProgressBar } from "../ui/progress-bar";
import { REVIEW_MISMATCH_ID, REVIEW_MISSING_ID, ReviewCard, SPLIT_MISMATCH_ACTION, SPLIT_MISMATCH_KEEP } from "../ui/review-card";
import { ActionBar, ActionBarRow } from "../ui/action-bar";
import { jevReasonText, reviewFlagView } from "../review-copy";
import { ReviewSkippedSection, skippedListPath, useSkippedReviewQuery } from "./review-skipped";
import { ReviewSkippedLink } from "../ui/review-skipped-list";
import { ScreenHeader } from "../ui/screen-header";
import { ScreenState } from "../ui/screen-state";
import { RouteSheet } from "../ui/route-sheet";
import { TextLink } from "../ui/text-link";
import { useToast } from "../ui/toast";
import { isReversal, reversalChoices } from "../reversal";
import { useLineSplitQuery } from "./line-split";
import { collapseSplit, combinePhase, invoiceDate, saveNewProject, useBlockedPreview, withChoice } from "./screen-shared";

// Screens moved to their own files (FLOW-807). Import from those files in new code.
export { OnboardingScreen } from "./onboarding-screen";
export { ProjectsScreen } from "./projects-screen";
export { ProjectDetailScreen, projectMonthAmount } from "./project-detail-screen";
export { FiledTodayScreen } from "./filed-today-screen";
export { ProjectCategoryScreen } from "./project-category-screen";
export { UNPAID_MARKED, UnpaidScreen } from "./unpaid-screen";
export { linePnlState, TransactionScreen } from "./transaction-screen";
export { SplitScreen } from "./split-screen";
export { type ConnectorTally, type ConnectionsHint, connectionsHint, loansCountHint, SettingsScreen, LoansScreen, NotificationsScreen } from "./settings-screen";
export { ConnectionsScreen } from "./connections-screen";
export { CategoriesScreen } from "./categories-screen";

const EMPTY_REVIEW: ReviewRow[] = [];

/** The row opened from the list. A later URL replace must not move this. */
let reviewReturnId: string | null = null;

/** The card line that opened the picker. The sheet focuses it after close. */
export const reviewLineFocus: {
  project: { current: HTMLButtonElement | null };
  category: { current: HTMLButtonElement | null };
} = {
  project: { current: null },
  category: { current: null },
};

export function resetReviewListFocus(): void {
  reviewReturnId = null;
  reviewLineFocus.project.current = null;
  reviewLineFocus.category.current = null;
}

/** Dev-only fixture. A production build folds this to null and drops the module. */
const reviewE2e = import.meta.env.DEV ? reviewE2eFixture : null;

function useE2eReviewRows(active: boolean): ReviewRow[] {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!import.meta.env.DEV || !active || reviewE2e == null) return;
    return reviewE2e.subscribe(() => {
      bump((n) => n + 1);
    });
  }, [active]);
  if (!import.meta.env.DEV || !active || reviewE2e == null) return EMPTY_REVIEW;
  return reviewE2e.currentRows();
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

export { reviewFocusPath };

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
function listFocusId(params: URLSearchParams): string | null {
  const item = params.get("item");
  if (item == null || item === "") return null;
  if (params.get("from") === "all" || params.get("list") === "all") return item;
  return null;
}

function assignmentPath(
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

export function ReviewScreen() {
  const preview = useHomePreview();
  const search = useFlowSearch();
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const holdWrites = useHoldWrites();
  const listing = location.pathname === "/review/all";
  const projectFilter = params.get("project");
  const review = useReviewQuery();
  const waiting = useProjectWaitingQuery(projectFilter ?? "");
  const focusedOrder = useRef<ReviewRow[] | null>(null);
  const e2eList = reviewE2e != null && params.get("preview") != null && params.get("e2e") === "list";
  const e2eRows = useE2eReviewRows(e2eList);
  const phase = e2eList ? ({ kind: "ready" } as const) : screenPhase(preview, review);
  const source = e2eList ? e2eRows : (review.data ?? EMPTY_REVIEW);
  const activeRows = useMemo(() => {
    if (projectFilter == null || preview !== "off") return source;
    const held = waiting.data;
    if (held == null || held.length === 0 || !held.every((row) => row.review_id != null)) return source;
    const ids = new Set(held.map((row) => row.review_id));
    return source.filter((row) => ids.has(row.id));
  }, [projectFilter, preview, source, waiting.data]);
  useEffect(() => {
    if (location.pathname !== "/review") {
      if (listing) focusedOrder.current = null;
      return;
    }
    const urlId = listFocusId(params);
    if (urlId == null) {
      focusedOrder.current = null;
      return;
    }
    if (reviewReturnId == null) reviewReturnId = urlId;
    if (phase.kind !== "ready") return;
    if (activeRows.length === 0) {
      if (projectFilter == null) void navigate(`/review${search}`, { replace: true });
      return;
    }
    if (activeRows.some((row) => row.id === urlId)) {
      focusedOrder.current = rotateReview(activeRows, urlId);
      return;
    }
    const head = queueAfterFocus(activeRows, urlId, focusedOrder.current).rows[0]?.id;
    if (head != null && head !== urlId) void navigate(reviewFocusPath(search, head), { replace: true });
  }, [location.pathname, listing, params, activeRows, phase.kind, search, navigate, projectFilter]);
  function rowsForFocus(rows: ReviewRow[]): ReviewRow[] {
    const urlId = listFocusId(params);
    if (listing || urlId == null) return rows;
    if (rows.some((row) => row.id === urlId)) return rotateReview(rows, urlId);
    return queueAfterFocus(rows, urlId, focusedOrder.current).rows;
  }
  const e2eWrite: ReviewPreviewWrite | undefined = reviewE2e != null && e2eList
    ? reviewE2e.e2ePreviewWrite()
    : undefined;
  if (projectFilter != null && preview === "off") {
    const back = `/projects/${projectFilter}`;
    const waitingPhase = screenPhase(preview, waiting);
    if (waitingPhase.kind === "loading" || waitingPhase.kind === "error") {
      return <ScreenState title="לאישור" backTo={back} phase={waitingPhase} onRetry={() => { void waiting.refetch(); }} />;
    }
    const held = waiting.data ?? [];
    if (held.length === 0) return <ReviewEmpty search={search} filtered backTo={back} homeTo={back} homeLabel="חזרה לפרויקט" />;
    if (held.every((row) => row.review_id != null)) {
      if (phase.kind !== "ready") {
        return <ScreenState title="לאישור" backTo={back} phase={phase} onRetry={() => { void review.refetch(); }} />;
      }
      const ids = new Set(held.map((row) => row.review_id));
      const rows = source.filter((row) => ids.has(row.id));
      if (rows.length === 0) return <ReviewEmpty search={search} filtered backTo={back} homeTo={back} homeLabel="חזרה לפרויקט" />;
      if (listing) return <ReviewAllList rows={rows} search={search} backTo={`/review${search}`} skipped={false} />;
      const fromList = listFocusId(params) != null;
      const ordered = rowsForFocus(rows);
      return (
        <ReviewQueue
          rows={ordered}
          search={search}
          listPlace={listPlace(rows, ordered, fromList)}
          backTo={fromList ? reviewListPath(search) : back}
          homeTo={back}
          homeLabel="חזרה לפרויקט"
        />
      );
    }
    return <ProjectWaitingList rows={held} search={search} backTo={back} />;
  }
  const rows = source;
  const fromList = listFocusId(params) != null;
  if (!listing && !holdWrites && params.get("setup") === "1" && (phase.kind === "empty" || (phase.kind === "ready" && rows.length === 0))) {
    const fromCard = params.get("from") === "card";
    return (
      <SetupSampleReview
        backTo={fromCard ? "/setup/4?from=card" : "/setup/4"}
        continueTo={fromCard ? "/" : "/setup/5"}
        empty={<ReviewEmpty search={search} backTo={fromList ? `/review${search}` : undefined} />}
      />
    );
  }
  if (phase.kind === "empty" || (phase.kind === "ready" && rows.length === 0)) {
    // FLOW-309: הצג הכול still lists the skipped cards when nothing waits.
    if (listing) return <ReviewAllList rows={EMPTY_REVIEW} search={search} backTo={`/review${search}`} />;
    return <ReviewEmpty search={search} backTo={fromList ? `/review${search}` : undefined} skippedLink />;
  }
  if (phase.kind !== "ready") {
    return <ScreenState title="לאישור" phase={phase} onRetry={() => { void review.refetch(); }} backTo={listing ? `/review${search}` : undefined} />;
  }
  if (listing) return <ReviewAllList rows={rows} search={search} backTo={`/review${search}`} />;
  const ordered = rowsForFocus(rows);
  const setupRun = params.get("setup") === "1";
  const setupFromCard = params.get("from") === "card";
  return (
    <ReviewQueue
      rows={ordered}
      search={search}
      previewWrite={e2eWrite}
      listPlace={listPlace(rows, ordered, fromList)}
      backTo={fromList ? reviewListPath(search) : undefined}
      setupHandoff={setupRun ? { fromCard: setupFromCard } : undefined}
    />
  );
}

function listPlace(rows: ReviewRow[], ordered: ReviewRow[], fromList: boolean): { index: number; total: number } | undefined {
  if (!fromList) return undefined;
  const head = ordered[0];
  if (!head) return undefined;
  const index = rows.findIndex((row) => row.id === head.id);
  if (index < 0) return undefined;
  return { index: index + 1, total: rows.length };
}

export function ReviewAllList({
  rows,
  search,
  backTo,
  skipped = true,
}: {
  rows: ReviewRow[];
  search: string;
  backTo: string;
  /** FLOW-309: the דולגו section at the end. A project's list leaves it out. */
  skipped?: boolean;
}) {
  useEffect(() => {
    const id = reviewReturnId;
    if (id == null) return;
    const href = reviewFocusPath(search, id);
    const link = [...document.querySelectorAll("a[href]")].find((node) => node.getAttribute("href") === href);
    if (link instanceof HTMLElement) link.focus();
    const timer = window.setTimeout(() => {
      if (reviewReturnId === id) reviewReturnId = null;
    }, 0);
    return () => { window.clearTimeout(timer); };
  }, [search, rows]);
  const ordered = useHeldOrder(rows, (row) => row.id);
  // FLOW-305: one bank-details read for the bank lines on this page. A failed read keeps "בנק".
  const bankIds = useMemo(() => rows.filter((row) => row.source === "mercury").map((row) => row.transaction_id), [rows]);
  const lineMeta = useLineMetaPageQuery(bankIds);
  const skippedRead = useSkippedReviewQuery(skipped && rows.length === 0);
  const cardPath = useCallback((id: string) => reviewFocusPath(search, id), [search]);
  if (rows.length === 0) {
    const someSkipped = skipped && (skippedRead.isError || (skippedRead.data?.length ?? 0) > 0);
    // FLOW-327 r1: while the skipped read loads, only the header shows, so הכל מאושר never flashes
    // before the skipped rows land.
    if (skipped && skippedRead.isLoading) {
      return <ScreenHeader title="לאישור" subtitle="תנועות שמחכות לשיוך" backTo={backTo} layout="inline" />;
    }
    if (!someSkipped) return <ReviewEmpty search={search} backTo={backTo} />;
    return (
      <div>
        <ScreenHeader title="לאישור" subtitle="תנועות שמחכות לשיוך" backTo={backTo} layout="inline" />
        <p className="t-hint ui-page-pad ui-review-none-waiting">{REVIEW_NONE_WAITING}</p>
        <ReviewSkippedSection search={search} cardPath={cardPath} />
      </div>
    );
  }
  return (
    <div>
      <ScreenHeader title="לאישור" subtitle="תנועות שמחכות לשיוך" backTo={backTo} layout="inline" />
      <MonthList
        rows={ordered}
        keyOf={(row) => row.id}
        dateOf={(row) => row.doc_date}
        amountOf={(row) => ({ minor: row.amount_net, currency: row.currency ?? "ILS", direction: row.direction })}
        days
        cents
        renderRow={(row) => (
          <ListRow
            variant="statement"
            title={row.supplier_name ?? row.description}
            fallback={row.source === "mercury" ? "bank" : "invoice"}
            method={statementMethodOf(row.source, row.doc_kind, lineMeta.data?.get(row.transaction_id))}
            suggestion={statementSuggestion(row)}
            pending={row.line_status === "pending"}
            agorot={row.amount_net}
            currency={row.currency}
            sign={row.direction === "income" ? "in" : "out"}
            href={reviewFocusPath(search, row.id)}
          />
        )}
      />
      {skipped ? <ReviewSkippedSection search={search} cardPath={cardPath} /> : null}
    </div>
  );
}

/** הצג הכול with nothing waiting, above the skipped section. */
export const REVIEW_NONE_WAITING = "אין פריטים שמחכים לאישור.";

/** "project · category" for the statement row's ✦ line: what the card shows (U11). FLOW-305. */
export function statementSuggestion(row: ReviewRow): string | null {
  const suggestion = reviewSuggestion(row);
  if (suggestion == null) return null;
  return [suggestion.project, suggestion.category].filter((part) => part != null).join(" · ");
}

export function ProjectWaitingList({
  rows,
  search,
  backTo,
  hrefFor,
}: {
  rows: ProjectWaitingRow[];
  search: string;
  backTo?: string;
  hrefFor?: (row: ProjectWaitingRow) => string;
}) {
  const ordered = useHeldOrder(rows, (row) => row.transaction_id);
  return (
    <div>
      <ScreenHeader title="לאישור" subtitle="הוצאות שמחכות לאישור בפרויקט הזה" backTo={backTo} layout="inline" />
      <MonthList
        rows={ordered}
        keyOf={(row) => row.transaction_id}
        dateOf={(row) => row.doc_date}
        amountOf={(row) => ({ minor: row.amount_net, currency: "ILS", direction: "expense" })}
        renderRow={(row) => (
          <ListRow
            variant="transaction"
            title={row.description}
            hint={formatDayMonth(row.doc_date)}
            agorot={row.amount_net}
            sign="out"
            source="invoice"
            href={hrefFor
              ? hrefFor(row)
              : row.review_id == null
                ? `/transactions/${row.transaction_id}${search}`
                : `/review/change${search}${search ? "&" : "?"}item=${row.review_id}`}
          />
        )}
      />
    </div>
  );
}

export type ReviewPreviewWrite = {
  run: () => Promise<void>;
  onDone: (id: string) => void;
  onUndo: (id: string) => void;
};

function reviewFlagKey(value: boolean | undefined): string {
  if (value === true) return "1";
  if (value === false) return "0";
  return "";
}

function reviewMotionKey(row: ReviewRow | null): string {
  if (row == null) return "";
  return [
    row.id,
    row.category_id ?? "",
    row.category_name ?? "",
    reviewFlagKey(row.category_suggested),
    reviewFlagKey(row.project_suggested),
    row.project_name ?? "",
    String(row.share_count ?? ""),
    String(row.auto_approved_today ?? ""),
  ].join("\u0000");
}

export function ReviewQueue({
  rows: incoming,
  search,
  sample = false,
  previewWrite,
  changeTo,
  filedTo,
  backTo,
  homeTo,
  homeLabel,
  onShared,
  listPlace,
  setupHandoff,
}: {
  rows: ReviewRow[];
  search: string;
  sample?: boolean;
  setupHandoff?: { fromCard: boolean };
  /** Injected by the dev and reviewer previews. The hosted queue does not set it. */
  previewWrite?: ReviewPreviewWrite;
  /** Preview sends שינוי to its own save screen. */
  changeTo?: string;
  /** Preview sends צפייה to its own filed list. */
  filedTo?: string;
  backTo?: string;
  /** A card opened from the list. Position in the remaining queue, not visit progress. */
  listPlace?: { index: number; total: number };
  /** Preview returns an empty queue to its index. */
  homeTo?: string;
  /** Label for that return. The product queue says לדף הבית. */
  homeLabel?: string;
  /** Preview opens its own split instead of the ledger split. */
  onShared?: (transactionId: string) => void;
}) {
  const preview = useHomePreview();
  const navigate = useNavigate();
  const [queueParams] = useSearchParams();
  const fromList = listFocusId(queueParams) != null;
  const toast = useToast();
  const blocked = useBlockedPreview("bar");
  const holdWrites = useHoldWrites();
  const invalidate = useInvalidateBooks();
  const kindRows = useCategoriesQuery(!sample && preview === "off" && previewWrite == null).data;
  const held = useHeldOrder(incoming, (item) => item.id);
  // The card on screen stays the head until it is handled, so a refetch that reorders the
  // queue can't swap another line under אישור. A card opened from the list keeps its focus.
  const rows = fromList ? held : pinReviewHead(held, reviewPin());
  const [hideAuto, setHideAuto] = useState(false);
  const [shown, setShown] = useState<ReviewRow | null>(rows[0] ?? null);
  useEffect(() => {
    // While ביטול holds the undone line, this pin of another card is ignored (review-pin.ts).
    if (!fromList && shown != null) pinReviewLine(shown.transaction_id);
  }, [fromList, shown]);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  // A hold names a line this queue was bringing back; it does not outlive the queue. (Under
  // StrictMode in dev, the mount-cleanup-mount cycle drops a hold set before mount; prod is not affected.)
  useEffect(() => () => { releaseReviewHold(reviewHold()); }, []);
  /** ביטול's reopen failed: drop the hold and pin the card that stayed on screen. */
  const undoFailed = useCallback((line: string | null) => {
    releaseReviewHold(line);
    if (!fromList && shownRef.current != null) pinReviewLine(shownRef.current.transaction_id);
  }, [fromList]);
  // ביטול's reopen landed. If the line is still not in the queue a moment later (approved again
  // elsewhere, or hidden by a filter), the hold would outlive its use and freeze the pin.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const undoSettled = useCallback((line: string | null) => {
    window.setTimeout(() => {
      if (line == null || reviewHold() !== line) return;
      if (rowsRef.current.some((row) => row.transaction_id === line)) return;
      releaseReviewHold(line);
      if (!fromList && shownRef.current != null) pinReviewLine(shownRef.current.transaction_id);
    }, REVIEW_HOLD_SETTLE_MS);
  }, [fromList]);
  const jevQueue = useJevQueue(
    rows.map((item) => item.transaction_id),
    !sample && preview === "off" && previewWrite == null,
  );
  const shownId = (shown ?? rows[0])?.transaction_id ?? null;
  const jevLoading = jevQueue.loadingFor(shownId);
  const metaLive = !sample && previewWrite == null;
  const lineMeta = useLineMetaQuery(shownId, metaLive);
  // Warm the next card's bank details so its meta line paints with the card.
  useLineMetaQuery(rows.find((item) => item.transaction_id !== shownId)?.transaction_id, metaLive);
  const jev = jevQueue.stateFor(shownId);
  const flagsFor = useReviewFlags(
    rows.map((item) => item.transaction_id),
    !sample && preview === "off" && previewWrite == null,
  );
  const [motion, setMotion] = useState<"still" | "out" | "in">("still");
  const visit = useRef(emptyVisit());
  const approvedId = useRef<string | null>(null);
  const approvedLine = useRef<string | null>(null);
  const skippedId = useRef<string | null>(null);
  const skippedLine = useRef<string | null>(null);
  const approveSlot = useRef<HTMLDivElement>(null);
  const approveGuard = useRef(false);
  const setupHandoffShown = useRef(false);
  const [, bumpVisit] = useState(0);
  const openIds = rows.map((item) => item.id);
  const present = notePresence(visit.current, openIds);
  if (present !== visit.current) visit.current = present;
  function markHandled(id: string) {
    visit.current = noteHandled(visit.current, id);
    bumpVisit((value) => value + 1);
  }
  const leaving = motion === "out";
  const nextCard = rows[0] ?? null;
  const nextCardRef = useRef(nextCard);
  nextCardRef.current = nextCard;
  // The head's identity is the swap. A fresh array for the same item must not
  // cancel the card that is already on its way in.
  const motionKey = reviewMotionKey(nextCard);
  useEffect(() => {
    const next = nextCardRef.current;
    if (next?.id === shown?.id) {
      if (
        next != null
        && shown != null
        && (next.category_name !== shown.category_name
          || next.category_id !== shown.category_id
          || next.category_suggested !== shown.category_suggested
          || next.project_suggested !== shown.project_suggested
          || next.project_name !== shown.project_name
          || next.share_count !== shown.share_count
          || next.auto_approved_today !== shown.auto_approved_today)
      ) {
        setShown(next);
      }
      return;
    }
    if (!shown) {
      setShown(next);
      setMotion("still");
      return;
    }
    setMotion("out");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => {
      const landed = nextCardRef.current;
      setShown(landed);
      setMotion(landed ? "in" : "still");
    }, reduce ? 0 : 200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [motionKey, shown]);
  const approve = useWrite({
    failure: (error) => {
      if (previewWrite) return changeSaveFailure(error);
      if (error instanceof ApproveNotice) return { message: error.message, tone: "info", retry: false };
      if (isApproveRetry(error) || isTransientWriteError(error)) return { message: "לא הצלחנו לאשר.", retry: true };
      return { message: "לא הצלחנו לאשר.", retry: false };
    },
    place: "bar",
    keys: ["review", "dashboard", "unpaid", "project", "project-category", "project-waiting", "filed-today", "txn"],
    retryFocus: () => {
      approveSlot.current?.querySelector("button")?.focus();
    },
    run: async () => {
      const target = shown;
      approvedId.current = target?.id ?? null;
      approvedLine.current = target?.transaction_id ?? null;
      if (previewWrite) {
        await previewWrite.run();
        if (target) markHandled(target.id);
        return;
      }
      if (!target) throw new Error("missing");
      const filled = withJev(target, jev);
      if (!filled.category_id) throw new Error("missing");
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      if (reviewIsSplit(filled) && filled.reason !== "unallocated_shared") {
        // #177: one call sets the category (when it changed) and approves, so a failure can't
        // leave the category saved with the card still open.
        assertNoError(await supabase.rpc("approve_split_review", { p_id: filled.id, p_category_id: filled.category_id }));
        markHandled(filled.id);
        return;
      }
      if (!filled.project_id) throw new Error("missing");
      const result = await supabase.rpc("approve_review_item", {
        p_id: filled.id,
        p_project_id: filled.project_id,
        p_category_id: filled.category_id,
        p_remember: false,
        p_check_shown: true,
        ...(target.project_id == null ? {} : { p_shown_project_id: target.project_id }),
        ...(target.category_id == null ? {} : { p_shown_category_id: target.category_id }),
      });
      assertNoError(result);
      const outcome = readApproveOutcome(result.data);
      if (outcome === "stale" || outcome === "already_closed") {
        await invalidate([...LEDGER_FOCUS_KEYS]);
        throw new ApproveNotice(outcome);
      }
      if (outcome === "not_found") {
        await invalidate([...LEDGER_FOCUS_KEYS]);
        throw new Error("not_found");
      }
      if (outcome !== "ok") throw new Error("refused");
      markHandled(target.id);
    },
    onSuccess: () => {
      const id = approvedId.current;
      if (!id) return;
      // ביטול brings the undone card back to the front.
      const line = approvedLine.current;
      if (previewWrite) {
        previewWrite.onDone(id);
        toast.show({
          message: "הפריט אושר",
          action: "ביטול",
          place: "bar",
          onAction: () => {
            pinReviewLine(line, { hold: true });
            previewWrite.onUndo(id);
          },
        });
        return;
      }
      if (setupHandoff != null && !setupHandoffShown.current) {
        setupHandoffShown.current = true;
        toast.show({
          message: SAMPLE_TOAST,
          action: "המשך",
          place: "bar",
          onAction: () => {
            void navigate(setupHandoff.fromCard ? "/" : "/setup/5");
          },
        });
        return;
      }
      toast.show({
        message: "הפריט אושר",
        action: "ביטול",
        place: "bar",
        onAction: () => {
          pinReviewLine(line, { hold: true });
          void reopenReview(id, invalidate, toast, undefined, { line, failed: undoFailed, settled: undoSettled });
        },
      });
    },
  });
  const skip = useWrite({
    failure: previewWrite ? changeSaveFailure : "לא הצלחנו לדלג.",
    keys: ["review", "review-skipped", "project", "project-category", "project-waiting"],
    place: "bar",
    run: async () => {
      // The card on screen, like אישור; rows[0] can differ while the queue reorders.
      const target = shown;
      skippedId.current = target?.id ?? null;
      skippedLine.current = target?.transaction_id ?? null;
      if (previewWrite) {
        await previewWrite.run();
        if (target) markHandled(target.id);
        return;
      }
      if (!target) throw new Error("missing");
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("resolve_review", {
        p_id: target.id,
        p_action: "skipped",
      }));
      markHandled(target.id);
    },
    onSuccess: () => {
      const id = skippedId.current;
      if (!id) return;
      if (previewWrite) previewWrite.onDone(id);
      // ביטול puts the skipped card back at the front (Eliran 2026-10-08: list + undo).
      const line = skippedLine.current;
      toast.show({
        message: "דילגנו על הפריט",
        action: "ביטול",
        place: "bar",
        onAction: () => {
          pinReviewLine(line, { hold: true });
          if (previewWrite) {
            previewWrite.onUndo(id);
            return;
          }
          void reopenReview(id, invalidate, toast, "הפריט חזר לתור.", { line, failed: undoFailed, settled: undoSettled });
        },
      });
    },
  });
  // FLOW-333 C8: the part count, read for a split_mismatch card only.
  const mismatchLine = shown?.reason === "split_mismatch" ? shown.transaction_id : "";
  // Focus that was in the bar must not fall to the page: the buttons go disabled while a card
  // leaves (and remount when the next card switches between normal and split_mismatch). Once the
  // next card has settled, focus moves to the bar's first button.
  const queueRoot = useRef<HTMLDivElement>(null);
  const barFocus = useRef(false);
  const barKind = shown?.reason === "split_mismatch";
  useLayoutEffect(() => {
    if (!barFocus.current) return;
    const active = document.activeElement;
    if (active != null && active !== document.body && queueRoot.current?.contains(active)) return;
    queueRoot.current?.querySelector<HTMLElement>(".ui-action-bar button, .ui-action-bar a[href]")?.focus({ preventScroll: true });
  }, [barKind, shown?.id, leaving, jevLoading]);
  const splitRead = useLineSplitQuery(mismatchLine, mismatchLine !== "" && !sample && previewWrite == null);
  const splitParts: number | "loading" | undefined = splitRead.data != null
    ? splitRead.data.parts.length
    : splitRead.isPending && splitRead.fetchStatus === "fetching" ? "loading" : undefined;
  const card = shown;
  if (!card) return <ReviewEmpty search={search} homeTo={homeTo} homeLabel={homeLabel} backTo={backTo} skippedLink={homeTo == null && !sample && previewWrite == null} />;
  const current = card;
  const change = assignmentPath(changeTo, search, current.id, undefined, fromList);
  function openProject() {
    if (reviewIsSplit(current)) {
      if (!current.transaction_id) return;
      if (onShared) {
        onShared(current.transaction_id);
        return;
      }
      void navigate(`/transactions/${current.transaction_id}/split${search}`);
      return;
    }
    void navigate(assignmentPath(changeTo, search, current.id, "project", fromList, true));
  }
  function openCategory() {
    void navigate(assignmentPath(changeTo, search, current.id, "category", fromList, true));
  }
  const auto = card.auto_approved_today ?? 0;
  const view = withJev(card, jev);
  const suggestion = reviewSuggestion(
    view,
    isReversal(kindRows ?? [], view.category_id, view.direction === "income" ? "income" : "expense"),
    jevShown(card, jev),
  );
  // FLOW-703: Jev's "no project / overhead" shows on an empty project row; it fills nothing.
  const shownSuggestion = jev.prefill?.noProject === true && view.project_id == null && !reviewIsSplit(view)
    && view.reason !== "unallocated_shared" && view.reason !== "split_mismatch"
    ? { ...(suggestion ?? {}), projectNoneJev: true }
    : suggestion;
  const place = visitPlace(visit.current, openIds);
  const total = listPlace?.total ?? place.total;
  const index = listPlace?.index ?? place.index;
  const splitCard = reviewIsSplit(view);
  const needProject = view.reason !== "unallocated_shared" && !splitCard && view.project_id == null;
  const needCategory = view.reason !== "unallocated_shared" && view.category_id == null;
  const settled = !leaving && !jevLoading;
  const nextPick = settled ? (needProject ? "project" : needCategory ? "category" : null) : null;
  const approvable = settled && nextPick == null && (view.reason === "unallocated_shared"
    || (splitCard ? view.category_id != null : view.project_id != null && view.category_id != null));
  const approveLabel = nextPick === "project" ? "בחירת פרויקט" : nextPick === "category" ? "בחירת קטגוריה" : "אישור";
  // FLOW-327 1.5: with both fields missing the card says why, and the button points at it.
  const missingBoth = settled && needProject && needCategory;
  // FLOW-333 C2: a split whose bank amount changed leads with עדכון הפיצול; להשאיר כך approves it as it stands.
  const mismatch = card.reason === "split_mismatch";
  const jevWhy = jev.prefill?.why == null ? null : jevReasonText(jev.prefill.why, card.direction, reviewHasParty(card));
  const flag = reviewFlagView(flagsFor(card.transaction_id), { direction: card.direction, currency: card.currency });
  function runApprove() {
    if (approveGuard.current || !settled) return;
    if (nextPick === "project") {
      openProject();
      return;
    }
    if (nextPick === "category") {
      openCategory();
      return;
    }
    if (!approvable) return;
    if (previewWrite == null && blocked(sample ? "empty" : preview)) return;
    if (current.reason === "unallocated_shared") {
      if (!current.transaction_id) return;
      if (onShared) {
        onShared(current.transaction_id);
        return;
      }
      void navigate(`/transactions/${current.transaction_id}/split${search}`);
      return;
    }
    approveGuard.current = true;
    approve.mutate(undefined, {
      onSettled: () => {
        approveGuard.current = false;
      },
    });
  }
  const skipButton = (
    <Button
      variant="ghost"
      busy={skip.isPending}
      disabled={leaving || approve.isPending}
      onClick={() => {
        if (leaving) return;
        if (previewWrite == null && blocked(sample ? "empty" : preview)) return;
        skip.mutate();
      }}
    >
      דלג
    </Button>
  );
  return (
    <ViewerScope>
    <div
      className="ui-review-queue"
      data-bar={holdWrites ? undefined : ""}
      ref={queueRoot}
      onFocusCapture={(event) => {
        barFocus.current = event.target instanceof Element && event.target.closest(".ui-action-bar") != null;
      }}
    >
      <ScreenHeader title="לאישור" subtitle="מסמכים שמחכים לשיוך" backTo={backTo} layout="inline" />
      {rows.length > 0 ? (
        <div className="ui-review-meter">
          {/* FLOW-327 r1: on the start side, near the thumb. A card opened from the list leaves it
              out: Back already goes to the list. */}
          {changeTo == null && listPlace == null ? (
            <TextLink className="ui-review-show-all" to={reviewListPath(search)} chevron={false}>הצג הכול</TextLink>
          ) : null}
          {listPlace == null ? (
            <ProgressBar
              variant="thin"
              label="התקדמות התור"
              value={index}
              max={total}
            />
          ) : null}
          {holdWrites ? null : <span className="sr-only">פריט </span>}
          <span className="t-hint ui-review-counter">
            {holdWrites ? (
              <bdi className="ui-num ui-review-count" dir="ltr">{String(total)}</bdi>
            ) : (
              <>
                <bdi className="ui-num ui-review-count" dir="ltr">{String(index)}</bdi>
                {" מתוך "}
                <bdi className="ui-num ui-review-count" dir="ltr">{String(total)}</bdi>
              </>
            )}
          </span>
        </div>
      ) : null}
      {auto > 0 && !hideAuto ? (
        <Banner
          slim
          icon={<ReviewIcon />}
          title={filedTodayBannerTitle(auto)}
          hint={<TextLink to={filedTo ?? `/review/filed${search}`}>לרשימה</TextLink>}
          action={
            <IconButton label="סגירה" onClick={() => { setHideAuto(true); }}>
              <CloseIcon />
            </IconButton>
          }
        />
      ) : null}
      <div className="ui-review-motion" data-motion={motion === "still" ? undefined : motion} key={card.id}>
        <ReviewCard
          supplier={card.supplier_name ?? card.customer_name ?? card.description}
          sourceLine={`${card.direction === "income" ? "הכנסה" : docKindLabel(card.doc_kind)} · ${invoiceDate(card.doc_date)}`}
          netAgorot={card.amount_net}
          currency={card.currency}
          vatLine={reviewVatLine(card.vat_agorot, card.currency)}
          suggestion={shownSuggestion}
          pending={jevLoading}
          reason={card.reason}
          direction={card.direction}
          projectButtonRef={reviewLineFocus.project}
          categoryButtonRef={reviewLineFocus.category}
          onProject={holdWrites ? undefined : openProject}
          onCategory={holdWrites ? undefined : openCategory}
          meta={lineMeta.data}
          splitParts={mismatch ? splitParts : undefined}
          jevWhy={jevWhy}
          flag={flag}
          missingBoth={missingBoth}
        />
      </div>
      {holdWrites ? <ViewerNote className="t-hint ui-viewer-note" /> : (
      <ActionBar>
        {mismatch ? (
          <>
            <Button
              full
              disabled={approve.isPending || !card.transaction_id}
              onClick={() => {
                if (!card.transaction_id || approve.isPending) return;
                void navigate(`/transactions/${card.transaction_id}/split-category${search}`);
              }}
            >
              {SPLIT_MISMATCH_ACTION}
            </Button>
            <ActionBarRow>
              <div className="ui-review-approve" ref={approveSlot}>
                <Button
                  variant="secondary"
                  busy={approve.isPending}
                  disabled={!settled}
                  aria-describedby={REVIEW_MISMATCH_ID}
                  onClick={runApprove}
                >
                  {SPLIT_MISMATCH_KEEP}
                </Button>
              </div>
              {skipButton}
            </ActionBarRow>
          </>
        ) : (
          <>
            <div className="ui-review-approve" ref={approveSlot}>
              <Button
                full
                busy={approve.isPending}
                disabled={!settled}
                icon={approveLabel === "אישור" ? <CheckIcon /> : undefined}
                aria-describedby={missingBoth ? REVIEW_MISSING_ID : undefined}
                onClick={runApprove}
              >
                {approveLabel}
              </Button>
            </div>
            <ActionBarRow>
              <Button variant="secondary" to={change}>שינוי</Button>
              {skipButton}
            </ActionBarRow>
          </>
        )}
      </ActionBar>
      )}
    </div>
    </ViewerScope>
  );
}

function reviewVatLine(vat: bigint | undefined, currency?: string): string | null {
  if (currency != null && currency !== "ILS") return null;
  if (vat == null) return "לפני מע״מ";
  if (vat === 0n) return "פטור ממע״מ";
  const shown = vat < 0n ? -vat : vat;
  return `לפני מע״מ · מע״מ ${formatMoney(shown, currency)}`;
}

function docKindLabel(kind: string | undefined): string {
  if (kind === "invoice") return "חשבונית";
  if (kind === "receipt") return "קבלה";
  if (kind === "invoice_receipt") return "חשבונית מס קבלה";
  if (kind === "credit") return "זיכוי";
  if (kind === "expense") return "הוצאה";
  return "מסמך";
}

/** `jev` marks the fields whose shown value is Jev's fill, so the card says הצעת Jev there. */
function reviewSuggestion(row: ReviewRow, reversal = false, jev?: JevShown) {
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

/** How long after ביטול's reopen lands the queue waits for the line before it drops the hold. */
const REVIEW_HOLD_SETTLE_MS = 1000;

async function reopenReview(
  id: string,
  invalidate: (keys: string[]) => Promise<void>,
  toast: { show: (input: { message: string; tone?: "ok" | "bad"; action?: string; onAction?: () => void; place?: "bar" }) => void },
  done = "הפריט חזר לתור, והשיוך הקודם שוחזר.",
  /** ביטול's held line (review-pin.ts): a failed reopen drops the hold, ניסיון חוזר sets it again. */
  undo?: { line: string | null; failed: (line: string | null) => void; settled?: (line: string | null) => void },
) {
  try {
    const supabase = getSupabase();
    if (!supabase) throw new Error("supabase");
    assertNoError(await supabase.rpc("reopen_review", { p_id: id }));
    await invalidate(["review", "review-skipped", "dashboard", "project", "project-category", "project-waiting", "filed-today", "txn"]);
    undo?.settled?.(undo.line);
    toast.show({ message: done, place: "bar" });
  } catch {
    undo?.failed(undo.line);
    toast.show({
      place: "bar",
      tone: "bad",
      message: "לא הצלחנו לבטל.",
      action: "ניסיון חוזר",
      onAction: () => {
        if (undo != null) pinReviewLine(undo.line, { hold: true });
        void reopenReview(id, invalidate, toast, done, undo);
      },
    });
  }
}

export function ReviewEmpty({
  search,
  filtered = false,
  homeTo,
  homeLabel,
  backTo,
  skippedLink = false,
}: {
  search: string;
  filtered?: boolean;
  homeTo?: string;
  homeLabel?: string;
  backTo?: string;
  /** FLOW-309, owner pick 2026-10-08: "N פריטים דולגו" under the action when cards were skipped. */
  skippedLink?: boolean;
}) {
  const skipped = useSkippedReviewQuery(skippedLink && !filtered);
  const skippedCount = skippedLink && !filtered && !skipped.isError ? (skipped.data?.length ?? 0) : 0;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ScreenHeader title="לאישור" subtitle="מסמכים שמחכים לשיוך" backTo={backTo} layout="inline" />
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
      />
    </div>
  );
}

type ChangeSample = {
  supplier: string;
  amount: string;
  suggestionId?: string;
  suggestionCategoryId?: string;
  projectId?: string;
  categoryId?: string;
  projects: ChangeChoice[];
  categories: Array<{ id: string; name: string; hidden: boolean; kind?: string }>;
  direction?: "income" | "expense";
  initialQuery?: string;
  loading?: boolean;
  saveError?: boolean;
  /** A split in the queue. The sheet does not ask for a project. */
  split?: boolean;
  splitTitle?: string;
  /** False when the category is the owner's, so the sheet does not call it a suggestion. */
  categorySuggested?: boolean;
  /** False when the project is the owner's or a remembered rule, so it is not הצעה. */
  project_suggested?: boolean;
};

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

export function ChangeForm({ sample: given }: { sample?: ChangeSample } = {}) {
  const [params] = useSearchParams();
  const sample: ChangeSample | undefined = given ?? (reviewE2e != null && params.get("e2e") === "list" ? reviewE2e.e2eChangeSample : undefined);
  const search = useFlowSearch();
  const preview = useHomePreview();
  const navigate = useNavigate();
  const toast = useToast();
  const blocked = useBlockedPreview();
  const holdWrites = useHoldWrites();
  const writeGate = useWriteGate("/review");
  const invalidate = useInvalidateBooks();
  const dashboard = useDashboardQuery(sample == null);
  const categories = useCategoriesQuery(sample == null);
  const review = useReviewQuery(sample == null);
  const item = params.get("item") ?? "";
  const live = (review.data ?? []).find((entry) => entry.id === item);
  const [kept, setKept] = useState<ReviewRow | null>(null);
  useEffect(() => {
    if (live) setKept(live);
  }, [live]);
  const row = live ?? (kept?.id === item ? kept : null);
  const jev = useJevReview(
    sample || preview !== "off" ? null : (row?.transaction_id ?? null),
    sample == null && preview === "off",
  );
  const [projectId, setProjectId] = useState(sample?.projectId ?? sample?.suggestionId ?? "");
  const [categoryId, setCategoryId] = useState(sample?.categoryId ?? sample?.suggestionCategoryId ?? "");
  const [remember, setRemember] = useState(true);
  const [hold, setHold] = useState("");
  const [leaveNote, setLeaveNote] = useState("");
  const [savedRemember, setSavedRemember] = useState(true);
  const wroteReview = useRef(false);
  const closedReview = useRef(false);
  closedReview.current = wroteReview.current || (kept != null && live == null);
  const picked = useRef({ projectId, categoryId, remember });
  const sharedTx = useRef<string | null>(null);
  sharedTx.current = row?.transaction_id ?? null;
  const [extraProjects, setExtraProjects] = useState<ChangeChoice[]>([]);
  const seeded = useRef(false);
  const baseline = useRef({ projectId: "", categoryId: "", remember: true });
  const toasted = useRef(false);
  const phase = sample
    ? ({ kind: "ready" } as const)
    : combinePhase(combinePhase(screenPhase(preview, dashboard), screenPhase(preview, categories)), screenPhase(preview, review));
  const direction = sample?.direction ?? row?.direction ?? "expense";
  const formPhase = phase.kind === "ready" && sample == null && row == null ? ({ kind: "empty" } as const) : phase;
  const income = direction === "income";
  const splitReview = sample?.split === true || reviewIsSplit(row);
  useEffect(() => {
    if (hold === "") return;
    const complete = splitReview ? categoryId !== "" : projectId !== "" && categoryId !== "";
    if (complete) setHold("");
  }, [hold, splitReview, projectId, categoryId]);
  useEffect(() => {
    if (leaveNote !== "" && remember === savedRemember) setLeaveNote("");
  }, [leaveNote, remember, savedRemember]);
  useEffect(() => {
    if (sample || !row || seeded.current) return;
    if (jev.loading) return;
    seeded.current = true;
    const filled = withJev(row, jev);
    const nextProject = filled.project_id ?? "";
    const nextCategory = filled.category_id ?? "";
    // FLOW-703: a category seeded from Jev's guess is not a supplier rule until the owner says so.
    const jevSeeded = filled.category_id !== row.category_id;
    baseline.current = { projectId: nextProject, categoryId: nextCategory, remember: !jevSeeded };
    setProjectId(nextProject);
    setCategoryId(nextCategory);
    if (jevSeeded) {
      setRemember(false);
      setSavedRemember(false);
    }
  }, [sample, row, jev]);
  useEffect(() => {
    if (!sample?.saveError || toasted.current) return;
    toasted.current = true;
    toast.show({
      tone: "bad",
      message: CHANGE_SAVE_FAILURE,
      action: "ניסיון חוזר",
      onAction: () => undefined,
    });
  }, [sample?.saveError, toast]);
  const filledRow = row ? withJev(row, jev) : row;
  const suggestionProjectId = sample
    ? (sample.project_suggested === false ? "" : (sample.suggestionId ?? ""))
    : (filledRow?.project_suggested === true ? (filledRow.project_id ?? "") : "");
  const suggestionCategoryId = sample?.suggestionCategoryId ?? sample?.categoryId ?? filledRow?.category_id ?? "";
  const projectOptions = withChoice(
    [...(sample?.projects ?? (dashboard.data?.projects ?? []).map((project) => ({
      id: project.id,
      name: project.name,
      status: project.status,
    }))), ...extraProjects],
    projectId,
    row?.project_name,
  );
  const reversalOptions = splitReview ? [] : reversalChoices(sample?.categories ?? categories.data ?? [], income ? "income" : "expense", sample?.categoryId ?? row?.category_id);
  const isReversalId = (id: string) => reversalOptions.some((option) => option.id === id);
  // The switch is hidden on a reversal, so it must not hold the sheet open.
  const rememberDirty = !income && !splitReview && !isReversalId(categoryId) && remember !== savedRemember;
  const categoryOptions = withChoice(
    (sample?.categories ?? categories.data ?? []).filter((category) => {
      if (category.hidden) return false;
      return income ? category.kind === "income" : category.kind !== "income";
    }).map((category) => ({ id: category.id, name: category.name })),
    isReversalId(categoryId) ? "" : categoryId,
    row?.category_name,
  );
  const save = useWrite({
    failure: changeSaveFailure,
    success: "השיוך נשמר",
    keys: ["review", "dashboard", "project", "project-category", "project-waiting"],
    onSplit: () => {
      if (!row?.transaction_id) return;
      void navigate(`/transactions/${row.transaction_id}/split${search}`, { replace: true });
    },
    onSuccess: () => {
      setSavedRemember(picked.current.remember);
      setProjectId(picked.current.projectId);
      setCategoryId(picked.current.categoryId);
      wroteReview.current = true;
    },
    run: async () => {
      const supabase = getSupabase();
      const next = picked.current;
      if (!supabase || item === "") throw new Error("supabase");
      assertNoError(await supabase.rpc("resolve_review", {
        p_id: item,
        p_action: "changed",
        p_project_id: next.projectId,
        p_category_id: next.categoryId,
        p_remember: next.remember,
      }));
    },
  });
  const lineField = useRef(false);
  const setSharedCategory = useWrite({
    failure: changeSaveFailure,
    keys: ["review", "dashboard", "project", "project-category", "project-waiting", "txn"],
    onSuccess: () => {
      setCategoryId(picked.current.categoryId);
      toast.show({
        message: "השיוך נשמר",
        ...(lineField.current ? { place: "page" as const } : {}),
      });
    },
    run: async () => {
      const supabase = getSupabase();
      const transactionId = sharedTx.current;
      const nextCategory = picked.current.categoryId;
      if (!supabase || transactionId == null || nextCategory === "") throw new Error("supabase");
      assertNoError(await supabase.rpc("set_transaction_category", {
        p_id: transactionId,
        p_category_id: nextCategory,
        ...(lineField.current ? { p_resolve: false } : {}),
      }));
    },
  });
  const fieldSave = useRef<{ kind: "project" | "category"; id: string } | null>(null);
  const saveField = useWrite({
    failure: changeSaveFailure,
    keys: ["review", "dashboard", "project", "project-category", "project-waiting", "txn"],
    onSuccess: () => {
      const pickedField = fieldSave.current;
      if (pickedField?.kind === "project") setProjectId(pickedField.id);
      else if (pickedField) setCategoryId(pickedField.id);
      toast.show({ message: "השיוך נשמר", place: "page" });
    },
    run: async () => {
      const supabase = getSupabase();
      const next = fieldSave.current;
      if (!supabase || item === "" || next == null) throw new Error("supabase");
      assertNoError(await supabase.rpc("resolve_review", {
        p_id: item,
        p_action: "changed",
        p_resolve: false,
        ...(next.kind === "project" ? { p_project_id: next.id } : { p_category_id: next.id }),
      }));
    },
  });
  const sharedUndoId = useRef<string | null>(null);
  const undoShared = useWrite({
    failure: "לא הצלחנו לבטל את השיוך.",
    success: "השיוך הקודם חזר",
    keys: ["review", "dashboard", "project", "project-category", "project-waiting", "txn"],
    run: async () => {
      const supabase = getSupabase();
      if (!supabase || sharedUndoId.current == null) throw new Error("supabase");
      assertNoError(await supabase.rpc("undo_reassign", { p_id: sharedUndoId.current }));
    },
  });
  const reassignClosed = useWrite({
    failure: changeSaveFailure,
    success: "השיוך נשמר",
    keys: ["review", "dashboard", "project", "project-category", "project-waiting", "txn"],
    onSuccess: () => {
      setProjectId(picked.current.projectId);
      setCategoryId(picked.current.categoryId);
      baseline.current = { ...baseline.current, projectId: picked.current.projectId, categoryId: picked.current.categoryId };
    },
    run: async () => {
      const supabase = getSupabase();
      const next = picked.current;
      const transactionId = sharedTx.current;
      if (!supabase || transactionId == null || next.categoryId === "") throw new Error("supabase");
      if (next.projectId === "") throw new Error("supabase");
      assertNoError(await supabase.rpc("reassign_transaction", {
        p_id: transactionId,
        p_project_id: next.projectId,
        p_category_id: next.categoryId,
      }));
    },
  });
  const collapseShared = useWrite({
    failure: changeSaveFailure,
    keys: ["review", "dashboard", "project", "project-category", "project-waiting", "txn"],
    onSuccess: () => {
      setProjectId(picked.current.projectId);
      const id = sharedUndoId.current;
      toast.show({
        message: "השיוך נשמר",
        ...(id ? { action: "ביטול", onAction: () => { undoShared.mutate(); } } : {}),
      });
    },
    run: async () => {
      sharedUndoId.current = await collapseSplit(sharedTx.current ?? "", picked.current.projectId);
    },
  });

  async function createProject(name: string): Promise<ChangeChoice> {
    if (holdWrites) throw new Error("preview");
    return saveNewProject(name, blocked, toast, (project) => {
      setExtraProjects((list) => [...list, project]);
    }, invalidate);
  }

  const fromList = (params.get("from") === "all" || params.get("list") === "all") && item !== "";
  const closeTo = fromList ? reviewFocusPath(search, item) : `/review${search}`;
  const linePick = params.get("from") === "line" ? params.get("pick") : null;
  const returnFocusRef = linePick === "project"
    ? reviewLineFocus.project
    : linePick === "category"
      ? reviewLineFocus.category
      : undefined;
  if (writeGate === "wait") return null;
  if (writeGate !== "show") return writeGate;
  if (formPhase.kind !== "ready") {
    return (
      <RouteSheet title="שינוי שיוך" closeTo={closeTo} returnFocusRef={returnFocusRef}>
        <ScreenState title="שינוי שיוך" phase={formPhase} onRetry={() => { void dashboard.refetch(); void categories.refetch(); void review.refetch(); }} />
      </RouteSheet>
    );
  }

  return (
    <ChangeAssignment
      host="route"
      closeTo={closeTo}
      returnFocusRef={returnFocusRef}
      supplier={sample?.supplier ?? row?.supplier_name ?? row?.description ?? ""}
      amount={sample?.amount ?? (row ? formatAmountText(absAgorot(row.amount_net), row.currency, {
        direction: income ? "income" : "expense",
        detail: true,
      }) : "")}
      direction={income ? "income" : "expense"}
      projects={projectOptions}
      categories={categoryOptions}
      reversals={reversalOptions}
      projectId={projectId}
      categoryId={categoryId}
      suggestionProjectId={suggestionProjectId}
      suggestionCategoryId={suggestionCategoryId}
      onProjectId={setProjectId}
      onCategoryId={setCategoryId}
      {...(income || splitReview ? {} : { remember, onRemember: setRemember })}
      categorySuggested={sample ? sample.categorySuggested !== false : filledRow?.category_suggested !== false}
      hold={hold || leaveNote}
      pending={rememberDirty && !wroteReview.current && !closedReview.current}
      projectNote={splitReview ? COLLAPSE_SPLIT_NOTE : undefined}
      projectTitle={sample?.splitTitle ?? (splitReview && row ? reviewSplitTitle(row) : undefined)}
      initialQuery={sample?.initialQuery}
      loading={sample?.loading}
      onDiscard={() => {
        setProjectId(baseline.current.projectId);
        setCategoryId(baseline.current.categoryId);
        setRemember(baseline.current.remember);
        setSavedRemember(baseline.current.remember);
        setHold("");
        setLeaveNote("");
      }}
      onCommitPick={async (kind, id) => {
        if (sample || holdWrites) return undefined;
        if (blocked()) throw new Error("preview");
        const nextProject = kind === "project" ? id : projectId;
        const nextCategory = kind === "category" ? id : categoryId;
        // A supplier rule never learns a reversal: the next line from this supplier is the usual kind.
        picked.current = { projectId: nextProject, categoryId: nextCategory, remember: remember && !isReversalId(nextCategory) };
        const fromLine = params.get("from") === "line";
        if (splitReview) {
          if (kind === "project") {
            if (!row?.transaction_id || id === "") throw new Error("supabase");
            await collapseShared.mutateAsync();
            return undefined;
          }
          if (!row?.transaction_id) throw new Error("supabase");
          lineField.current = fromLine;
          await setSharedCategory.mutateAsync();
          return undefined;
        }
        if (fromLine) {
          fieldSave.current = { kind, id };
          await saveField.mutateAsync();
          return undefined;
        }
        const complete = nextProject !== "" && nextCategory !== "";
        if (!complete) {
          setHold("בחרו פרויקט וקטגוריה.");
          return "hold";
        }
        setHold("");
        if (closedReview.current) {
          await reassignClosed.mutateAsync();
          return undefined;
        }
        await save.mutateAsync();
        return undefined;
      }}
      onCloseCheck={() => {
        if (sample) return Promise.resolve();
        if (blocked()) return Promise.reject(new Error("preview"));
        const complete = splitReview ? categoryId !== "" : projectId !== "" && categoryId !== "";
        if (!complete) {
          setHold(splitReview ? "בחרו קטגוריה." : "בחרו פרויקט וקטגוריה.");
          return Promise.reject(new Error("incomplete"));
        }
        if (rememberDirty && (wroteReview.current || closedReview.current)) {
          setLeaveNote("הזכירה נשמרת עם השיוך. החזירו את המתג כדי לסגור.");
          return Promise.reject(new Error("remember"));
        }
        return Promise.resolve();
      }}
      onCommitPending={async () => {
        if (sample || holdWrites) return;
        if (blocked()) throw new Error("preview");
        setHold("");
        picked.current = { projectId, categoryId, remember: remember && !isReversalId(categoryId) };
        await save.mutateAsync();
      }}
      onSplit={() => {
        if (row?.transaction_id) {
          void navigate(`/transactions/${row.transaction_id}/split${search}`, { replace: true });
          return;
        }
        toast.show({ message: "הפיצול נעשה ממסך התנועה, אחרי השיוך." });
      }}
      onCreateProject={createProject}
    />
  );
}

export function AddForm() {
  const search = usePreviewSearch();
  const goBack = useGoBack();
  const writeGate = useWriteGate("/");
  if (writeGate === "wait") return null;
  if (writeGate !== "show") return writeGate;
  return (
    <RouteSheet
      title="הוספה"
      closeTo={`/${search}`}
      returnFocusRef={addTriggerRef}
    >
      <p className="t-hint">הצילום וההזנה הידנית יגיעו בהמשך.</p>
      <div className="ui-add-rows">
        <ListRow
          variant="button"
          disabled
          title="צילום חשבונית"
          hint="מצלמה או PDF · קורא ספק, סכום, מע״מ ותאריך"
          wrapHint
          icon={<CameraIcon size={26} />}
        />
        <ListRow
          variant="button"
          disabled
          title="הזנה ידנית"
          hint="סכום, פרויקט וקטגוריה – רק במקרה הצורך"
          icon={<PencilIcon size={26} />}
        />
      </div>
      <Button variant="ghost" full onClick={() => { goBack(`/${search}`); }}>ביטול</Button>
    </RouteSheet>
  );
}
