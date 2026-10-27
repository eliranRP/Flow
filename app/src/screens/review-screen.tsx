import type { ReviewRow } from "@flow/shared";
import { useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useHoldWrites } from "../use-is-viewer";
import { useFlowSearch, useHomePreview } from "../preview";
import { screenPhase } from "../query-phase";
import { useDashboardQuery, useProjectWaitingQuery, useReviewQuery } from "../use-books";
import { reviewFocusPath } from "../review-paths";
import { SetupSampleReview } from "../setup/sample-review";
import { useOnline } from "../ui/band-states";
import { ScreenState, usePreviewRetry } from "../ui/screen-state";
import { ProjectWaitingList, ReviewAllList, reviewListReturn, type ReviewListState } from "./review-lists";
import { EMPTY_REVIEW, listFocusId, listPlace, queueAfterFocus, reviewE2e, ReviewEmpty, reviewLineFocus, reviewListPath, rotateReview, useE2eReviewRows } from "./review-shared";
import { E2E_DONE_COUNTS } from "../dev/review-e2e-fixture";
import { type ReviewPreviewWrite, ReviewQueue } from "./review-queue";
import { useJevBookingsQuery } from "../jev-bookings";
import { JevBookingReview } from "./jev-booking-review";
import type { ReviewCase } from "../dev/review-e2e-fixture";

/** FLOW-365: the dev `case` param names a board state for the proofs; anything else is the default queue. */
function reviewCaseOf(value: string | null): ReviewCase | null {
  return value === "suggest" || value === "none" || value === "split" || value === "photo" ? value : null;
}

/** FLOW-365b: `&rows=N` seeds N cards; `rows=0` is an empty queue (the done frame). */
function reviewRowsParam(value: string | null): number | undefined {
  if (value == null || value === "") return undefined;
  const size = Number(value);
  return Number.isInteger(size) && size >= 0 ? size : undefined;
}

export function resetReviewListFocus(): void {
  reviewListReturn.current = null;
  reviewLineFocus.project.current = null;
  reviewLineFocus.category.current = null;
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
  const bookings = useJevBookingsQuery(projectFilter == null);
  const waiting = useProjectWaitingQuery(projectFilter ?? "");
  // FLOW-971: the waiting list's Back and subtitle name the project.
  const dashboard = useDashboardQuery(projectFilter != null && preview === "off");
  const projectName = dashboard.data?.projects.find((project) => project.id === projectFilter)?.name;
  const online = useOnline();
  const retryReview = usePreviewRetry(() => { void review.refetch(); });
  const retryWaiting = usePreviewRetry(() => { void waiting.refetch(); });
  const focusedOrder = useRef<ReviewRow[] | null>(null);
  const e2eList = reviewE2e != null && params.get("preview") != null && params.get("e2e") === "list";
  // FLOW-365b: `&board=` opens one board state for the proofs: sheet (the project picker open),
  // nosuggestion (three cards handled before this one), done (the queue just emptied).
  const e2eBoard = e2eList ? params.get("board") : null;
  const e2eRows = useE2eReviewRows(e2eList, reviewRowsParam(params.get("rows")), reviewCaseOf(params.get("case")));
  // FLOW-309: `&fit=1` is the short-phone worst case (a wrapping supplier, Jev's reason, the banner).
  const e2eFit = e2eList && reviewE2e != null && params.get("fit") === "1";
  // FLOW-365: the suggest case shows Jev's repeat-supplier line under the card.
  const e2eSuggest = e2eList && params.get("case") === "suggest";
  // The none and split cards carry Jev's reason line too (the board's two-line copy under the card).
  const e2eCaseJev = e2eList && reviewE2e != null ? reviewE2e.e2eCaseJev(params.get("case")) : undefined;
  const e2eShown = useMemo(() => (e2eFit && reviewE2e != null ? reviewE2e.e2eFitRows(e2eRows) : e2eRows), [e2eFit, e2eRows]);
  const phase = e2eList ? ({ kind: "ready" } as const) : screenPhase(preview, review);
  const source = e2eList ? e2eShown : (review.data ?? EMPTY_REVIEW);
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
    reviewListReturn.current ??= urlId;
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
    if (waitingPhase.kind === "loading") {
      return <ScreenState title="לאישור" backTo={back} phase={waitingPhase} onRetry={() => { void waiting.refetch(); }} />;
    }
    if (waitingPhase.kind === "error") {
      return <ProjectWaitingList rows={[]} search={search} backTo={back} backText={projectName} state={{ failed: { offline: waitingPhase.offline, onRetry: retryWaiting } }} />;
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
      if (listing) return <ReviewAllList rows={rows} search={search} backTo={`/review${search}`} />;
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
    return (
      <ProjectWaitingList
        rows={held}
        search={search}
        backTo={back}
        backText={projectName}
        projectName={projectName}
        state={{ offlineSince: !online && waiting.dataUpdatedAt > 0 ? waiting.dataUpdatedAt : null }}
      />
    );
  }
  const rows = source;
  const fromList = listFocusId(params) != null;
  // FLOW-955: Jev's bookings wait at the head of the queue, before its own cards (not in a dev proof).
  // The first draw waits for their read, so the queue never jumps from a card to a booking; a failed
  // read leaves the queue as it is.
  const bookingsLive = !e2eList && preview === "off";
  if (bookingsLive && bookings.isPending) {
    return <ScreenState title="לאישור" phase={{ kind: "loading" }} onRetry={() => { void bookings.refetch(); }} backTo={listing ? `/review${search}` : undefined} />;
  }
  const listedBookings = bookingsLive ? (bookings.data ?? []) : [];
  const waitingBookings = listing || fromList ? [] : listedBookings;
  if (waitingBookings.length > 0) {
    const head = phase.kind === "ready" ? rows[0] : undefined;
    return (
      <JevBookingReview
        bookings={waitingBookings}
        queued={phase.kind === "ready" ? rows.length : 0}
        next={head != null ? { name: head.supplier_name ?? head.description, minor: head.amount_net, currency: head.currency ?? "ILS" } : null}
        search={search}
      />
    );
  }
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
  // FLOW-971: the full list keeps its page on a failed read and offline, and says so under its title.
  const listState: ReviewListState = phase.kind === "error"
    ? { failed: { offline: phase.offline, onRetry: retryReview } }
    : { offlineSince: !online && review.dataUpdatedAt > 0 ? review.dataUpdatedAt : null };
  if (listing && phase.kind === "error") return <ReviewAllList rows={EMPTY_REVIEW} search={search} backTo={`/review${search}`} state={listState} />;
  if (phase.kind === "empty" || (phase.kind === "ready" && rows.length === 0)) {
    if (listing) return <ReviewAllList rows={EMPTY_REVIEW} bookings={listedBookings} search={search} backTo={`/review${search}`} state={listState} />;
    return (
      <ReviewEmpty
        search={search}
        backTo={fromList ? `/review${search}` : undefined}
        pushPrompt={e2eBoard == null}
        done={e2eBoard === "done" ? E2E_DONE_COUNTS : undefined}
      />
    );
  }
  if (phase.kind !== "ready") {
    return <ScreenState title="לאישור" phase={phase} onRetry={() => { void review.refetch(); }} backTo={listing ? `/review${search}` : undefined} />;
  }
  if (listing) return <ReviewAllList rows={rows} bookings={listedBookings} search={search} backTo={`/review${search}`} state={listState} />;
  const ordered = rowsForFocus(rows);
  const setupRun = params.get("setup") === "1";
  const setupFromCard = params.get("from") === "card";
  return (
    <ReviewQueue
      rows={ordered}
      search={search}
      previewWrite={e2eWrite}
      sampleJev={e2eFit && reviewE2e != null ? reviewE2e.e2eFitJev : e2eSuggest && reviewE2e != null ? reviewE2e.e2eSuggestJev : e2eCaseJev}
      listPlace={listPlace(rows, ordered, fromList)}
      backTo={fromList ? reviewListPath(search) : undefined}
      setupHandoff={setupRun ? { fromCard: setupFromCard } : undefined}
      openPicker={e2eBoard === "sheet"}
      handledBefore={e2eBoard === "nosuggestion" ? 3 : undefined}
    />
  );
}
