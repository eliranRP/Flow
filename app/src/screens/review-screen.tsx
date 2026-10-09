import { type ProjectWaitingRow, type ReviewRow } from "@flow/shared";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useHoldWrites } from "../use-is-viewer";
import { useFlowSearch, useHomePreview } from "../preview";
import { screenPhase } from "../query-phase";
import { useProjectWaitingQuery, useReviewQuery, useLineMetaPageQuery } from "../use-books";
import { useHeldOrder } from "../list-hold";
import { reviewFocusPath } from "../review-paths";
import { SetupSampleReview } from "../setup/sample-review";
import { formatDayMonth } from "../ui/date-math";
import { KeptOutTag, rowSource } from "../ui/line-marks";
import { ListRow } from "../ui/list-row";
import { MonthList } from "../ui/month-list";
import { statementMethodOf } from "../ui/statement";
import { ReviewSkippedSection, useSkippedReviewQuery } from "./review-skipped";
import { ScreenHeader } from "../ui/screen-header";
import { KEPT_OUT } from "./screen-shared";
import { ScreenState } from "../ui/screen-state";
import { EMPTY_REVIEW, listFocusId, listPlace, queueAfterFocus, REVIEW_NONE_WAITING, reviewE2e, ReviewEmpty, reviewLineFocus, reviewListPath, reviewSuggestion, rotateReview, statementSuggestion, useE2eReviewRows } from "./review-shared";
import { type ReviewPreviewWrite, ReviewQueue } from "./review-queue";
import { useJevQueue } from "./jev-review-card";
import { jevShown, withJev } from "./jev-review";

/** The row opened from the list. A later URL replace must not move this. */
let reviewReturnId: string | null = null;

export function resetReviewListFocus(): void {
  reviewReturnId = null;
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
  const waiting = useProjectWaitingQuery(projectFilter ?? "");
  const focusedOrder = useRef<ReviewRow[] | null>(null);
  const e2eList = reviewE2e != null && params.get("preview") != null && params.get("e2e") === "list";
  const e2eRows = useE2eReviewRows(e2eList, Number(params.get("rows") ?? "") || undefined);
  // FLOW-309: `&fit=1` is the short-phone worst case (a wrapping supplier, Jev's reason, the banner).
  const e2eFit = e2eList && reviewE2e != null && params.get("fit") === "1";
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
      sampleJev={e2eFit && reviewE2e != null ? reviewE2e.e2eFitJev : undefined}
      listPlace={listPlace(rows, ordered, fromList)}
      backTo={fromList ? reviewListPath(search) : undefined}
      setupHandoff={setupRun ? { fromCard: setupFromCard } : undefined}
    />
  );
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
  // FLOW-704: the same Jev read as the queue, so a line Jev fills reads "✦ Jev · …" here too.
  const preview = useHomePreview();
  const jevIds = useMemo(() => rows.map((row) => row.transaction_id), [rows]);
  const jevQueue = useJevQueue(jevIds, preview === "off");
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
        renderRow={(row) => {
          const jev = jevQueue.stateFor(row.transaction_id);
          const view = withJev(row, jev);
          // "✦ Jev" only when every value on the line is Jev's: a rule's or the owner's value is not.
          const parts = reviewSuggestion(view, false, jevShown(row, jev));
          const allJev = parts != null && (parts.projectJev === true || parts.categoryJev === true)
            && (parts.project == null || parts.projectJev === true)
            && (parts.category == null || parts.categoryJev === true);
          return (
            <ListRow
              variant="statement"
              title={row.supplier_name ?? row.description}
              fallback={row.source === "mercury" ? "bank" : "invoice"}
              method={statementMethodOf(row.source, row.doc_kind, lineMeta.data?.get(row.transaction_id))}
              suggestion={statementSuggestion(view)}
              suggestionJev={allJev}
              pending={row.line_status === "pending"}
              agorot={row.amount_net}
              currency={row.currency}
              sign={row.direction === "income" ? "in" : "out"}
              href={reviewFocusPath(search, row.id)}
            />
          );
        }}
      />
      {skipped ? <ReviewSkippedSection search={search} cardPath={cardPath} /> : null}
    </div>
  );
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
            source={rowSource(row.source)}
            tag={row.kept_out === true ? <KeptOutTag label={KEPT_OUT} /> : undefined}
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
