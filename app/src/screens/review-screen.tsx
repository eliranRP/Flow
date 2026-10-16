import { formatAmountText, type ProjectWaitingRow, type ReviewRow } from "@flow/shared";
import { useEffect, useMemo, useRef } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useHoldWrites } from "../use-is-viewer";
import { useFlowSearch, useHomePreview } from "../preview";
import { screenPhase } from "../query-phase";
import { useProjectWaitingQuery, useReviewQuery } from "../use-books";
import { useHeldOrder } from "../list-hold";
import { txnListState } from "../txn-nav";
import { reviewFocusPath } from "../review-paths";
import { SetupSampleReview } from "../setup/sample-review";
import { formatDayMonth } from "../ui/date-math";
import { KeptOutTag, rowSource } from "../ui/line-marks";
import { ListRow } from "../ui/list-row";
import { MonthList } from "../ui/month-list";
import { ScreenHeader } from "../ui/screen-header";
import { KEPT_OUT, invoiceDate } from "./screen-shared";
import { ChevronIcon } from "../ui/icons";
import { ScreenState } from "../ui/screen-state";
import { EMPTY_REVIEW, listFocusId, listPlace, queueAfterFocus, reviewE2e, ReviewEmpty, reviewLineFocus, reviewListPath, rotateReview, useE2eReviewRows } from "./review-shared";
import { type ReviewPreviewWrite, ReviewQueue } from "./review-queue";
import type { ReviewCase } from "../dev/review-e2e-fixture";

/** FLOW-365: the dev `case` param names a board state for the proofs; anything else is the default queue. */
function reviewCaseOf(value: string | null): ReviewCase | null {
  return value === "suggest" || value === "none" || value === "split" || value === "photo" ? value : null;
}

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
  const e2eRows = useE2eReviewRows(e2eList, Number(params.get("rows") ?? "") || undefined, reviewCaseOf(params.get("case")));
  // FLOW-309: `&fit=1` is the short-phone worst case (a wrapping supplier, Jev's reason, the banner).
  const e2eFit = e2eList && reviewE2e != null && params.get("fit") === "1";
  // FLOW-365: the suggest case shows Jev's repeat-supplier line under the card.
  const e2eSuggest = e2eList && params.get("case") === "suggest";
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
    if (listing) return <ReviewAllList rows={EMPTY_REVIEW} search={search} backTo={`/review${search}`} />;
    return <ReviewEmpty search={search} backTo={fromList ? `/review${search}` : undefined} pushPrompt />;
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
      sampleJev={e2eFit && reviewE2e != null ? reviewE2e.e2eFitJev : e2eSuggest && reviewE2e != null ? reviewE2e.e2eSuggestJev : undefined}
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
}: {
  rows: ReviewRow[];
  search: string;
  backTo: string;
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
  if (rows.length === 0) return <ReviewEmpty search={search} backTo={backTo} />;
  return (
    <div>
      {/* FLOW-365: the flat list's title, its count line, and one row per item (no date groups, no avatars). */}
      <ScreenHeader
        title="כל הפריטים לאישור"
        subtitle={`${String(rows.length)} פריטים מחכים • הקישו על פריט כדי לפתוח אותו`}
        backTo={backTo}
        backText="בית"
      />
      <ul className="ui-review-all">
        {ordered.map((row) => (
          <li key={row.id}>
            <ReviewAllRow row={row} href={reviewFocusPath(search, row.id)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** FLOW-365: a list row. The payee, then "<date> • חשבונית|בנק" (and "חסר פרויקט"), the amount and a chevron. */
function ReviewAllRow({ row, href }: { row: ReviewRow; href: string }) {
  const income = row.direction === "income";
  const shown = row.amount_net < 0n ? -row.amount_net : row.amount_net;
  const amount = formatAmountText(shown, row.currency ?? "ILS", income
    ? { detail: true, direction: "income", plus: true }
    : { detail: true });
  const meta = [
    invoiceDate(row.doc_date),
    row.source === "mercury" ? "בנק" : "חשבונית",
    row.project_id == null ? "חסר פרויקט" : null,
  ].filter((part): part is string => part != null).join(" • ");
  return (
    <Link className="ui-review-all-row ui-hit" to={href}>
      <span className="ui-review-all-text">
        <span className="ui-review-all-title">{row.supplier_name ?? row.description}</span>
        <span className="ui-review-all-meta">{meta}</span>
      </span>
      <bdi className={income ? "ui-review-all-amount ui-review-all-in ui-num" : "ui-review-all-amount ui-num"} dir="ltr">{amount}</bdi>
      <ChevronIcon size={16} />
    </Link>
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
  // FLOW-314: a card opened here walks the list's card rows; a row with a change to review opens its own screen.
  const location = useLocation();
  const listFrom = `${location.pathname}${location.search}`;
  const cardIds = ordered.filter((row) => row.review_id == null).map((row) => row.transaction_id);
  return (
    <div>
      <ScreenHeader title="לאישור" subtitle="הוצאות שמחכות לאישור בפרויקט הזה" backTo={backTo} layout="inline" />
      <MonthList
        rows={ordered}
        keyOf={(row) => row.transaction_id}
        dateOf={(row) => row.doc_date}
        amountOf={(row) => ({ minor: row.amount_net, currency: row.currency ?? "ILS", direction: "expense" })}
        renderRow={(row) => (
          <ListRow
            variant="transaction"
            title={row.description}
            hint={formatDayMonth(row.doc_date)}
            agorot={row.amount_net}
            currency={row.currency}
            sign="out"
            source={rowSource(row.source)}
            tag={row.kept_out === true ? <KeptOutTag label={KEPT_OUT} /> : undefined}
            href={hrefFor
              ? hrefFor(row)
              : row.review_id == null
                ? `/transactions/${row.transaction_id}${search}`
                : `/review/change${search}${search ? "&" : "?"}item=${row.review_id}`}
            state={hrefFor == null && row.review_id == null ? txnListState(cardIds, row.transaction_id, listFrom) : undefined}
          />
        )}
      />
    </div>
  );
}
