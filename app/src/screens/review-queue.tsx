import { formatMoney, type ReviewRow } from "@flow/shared";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useHoldWrites, ViewerNote, ViewerScope } from "../use-is-viewer";
import { getSupabase } from "../lib/supabase";
import { useHomePreview } from "../preview";
import { useCategoriesQuery, useInvalidateBooks, useLineMetaPageQuery, useLineMetaQuery } from "../use-books";
import { ApproveNotice, isApproveRetry, readApproveOutcome } from "../approve-review";
import { LEDGER_FOCUS_KEYS } from "../books-focus";
import { filedTodayBannerTitle } from "../filed-today-copy";
import { useHeldOrder } from "../list-hold";
import { pinReviewHead, pinReviewLine, releaseReviewHold, reviewHold, reviewPin } from "../review-pin";
import { emptyVisit, noteHandled, notePresence, visitPlace } from "../visit-meter";
import { assertNoError, isTransientWriteError, useWrite } from "../use-write";
import { SAMPLE_TOAST } from "../setup/copy";
import { useJevQueue, useReviewFlags } from "./jev-review-card";
import { jevFilledOnCard, jevShown, withJev, type JevQueueData } from "./jev-review";
import { useJevUndo } from "./jev-undo";
import { useReviewSwap } from "./review-swap";
import { focusReviewEmptyAction, handReviewFocus, takeReviewFocus } from "./review-focus";
import { ReviewCount, reviewCountDigits } from "../ui/review-count";
import { Banner } from "../ui/banner";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { CheckIcon, CloseIcon, ReviewIcon } from "../ui/icons";
import { changeSaveFailure } from "../ui/change-sheet";
import { ProgressBar } from "../ui/progress-bar";
import { REVIEW_MISMATCH_ID, REVIEW_MISSING_ID, ReviewCard, SPLIT_MISMATCH_ACTION, SPLIT_MISMATCH_KEEP } from "../ui/review-card";
import { ActionBar, ActionBarRow } from "../ui/action-bar";
import { jevReasonText, reviewFlagView } from "../review-copy";
import { ScreenHeader } from "../ui/screen-header";
import { TextLink } from "../ui/text-link";
import { useToast } from "../ui/toast";
import { isReversal } from "../reversal";
import { useLineSplitQuery } from "./line-split";
import { invoiceDate, useBlockedPreview } from "./screen-shared";
import { assignmentPath, listFocusId, ReviewEmpty, reviewHasParty, reviewIsSplit, reviewLineFocus, reviewListPath, reviewSuggestion } from "./review-shared";

export type ReviewPreviewWrite = {
  run: () => Promise<void>;
  onDone: (id: string) => void;
  onUndo: (id: string) => void;
};

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
  sampleJev,
}: {
  rows: ReviewRow[];
  search: string;
  sample?: boolean;
  /** FLOW-333 C13: Jev's answers for a sample queue (a story or an e2e preview); the live read never runs there. */
  sampleJev?: JevQueueData;
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
  const { shown, motion } = useReviewSwap(rows[0] ?? null);
  useEffect(() => {
    // While ביטול holds the undone line, this pin of another card is ignored (review-pin.ts).
    if (!fromList && shown != null) pinReviewLine(shown.transaction_id);
  }, [fromList, shown]);
  const shownRef = useRef(shown);
  const rowsRef = useRef(rows);
  useLayoutEffect(() => {
    shownRef.current = shown;
    rowsRef.current = rows;
  });
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
  // FLOW-315: one read for the bank details of the cards ahead (and the one on screen) fills each
  // card's cache, so every next card's meta line paints with it. The card's own read runs only if
  // that read failed. The details stay supplementary: the card never waits for them.
  const metaIds = useMemo(() => {
    const head = rows.slice(0, META_AHEAD).map((item) => item.transaction_id);
    return shownId == null || head.includes(shownId) ? head : [...head, shownId];
  }, [rows, shownId]);
  const metaPage = useLineMetaPageQuery(metaIds, metaLive);
  const lineMeta = useLineMetaQuery(shownId, metaLive && metaPage.isError);
  const jevUndo = useJevUndo();
  const seededJev = sampleJev != null && shownId != null
    ? { connectorOn: sampleJev.connectorOn, prefill: sampleJev.byId[shownId] ?? null }
    : null;
  const jev = jevUndo.stateFor(shownId, seededJev ?? jevQueue.stateFor(shownId));
  const flagsFor = useReviewFlags(
    rows.map((item) => item.transaction_id),
    !sample && preview === "off" && previewWrite == null,
  );
  const visit = useRef(emptyVisit());
  const approvedId = useRef<string | null>(null);
  const approvedLine = useRef<string | null>(null);
  const skippedId = useRef<string | null>(null);
  const skippedLine = useRef<string | null>(null);
  const approveSlot = useRef<HTMLDivElement>(null);
  const queueRoot = useRef<HTMLDivElement>(null);
  /** Focus was last in the action bar (a keyboard, or a tap that focuses on Android). */
  const barFocus = useRef(false);
  /** FLOW-309: ביטול pressed with focus on the toast brings focus back to the returning card's bar. */
  const keepToastFocus = () => {
    if (document.activeElement?.closest(".ui-toast") == null) return;
    barFocus.current = true;
    handReviewFocus();
  };
  // The screen swaps this queue for its empty state when the last card leaves: hand focus over.
  useEffect(() => {
    if (takeReviewFocus()) barFocus.current = true;
    const path = window.location.pathname;
    return () => {
      // Still on this screen and focus fell with the bar: the queue went empty. Leaving for another
      // screen, or focus the owner moved elsewhere, hands nothing over.
      const active = document.activeElement;
      const lost = active == null || active === document.body;
      if (barFocus.current && lost && window.location.pathname === path) handReviewFocus();
    };
  }, []);
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
            keepToastFocus();
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
          keepToastFocus();
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
          keepToastFocus();
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
  const barKind = shown?.reason === "split_mismatch";
  // A passive effect, so it runs after the header's own title focus when the queue comes back from
  // empty (FLOW-309); that title is not a place the owner chose. Focus is moved only when it was
  // lost (the page, or that title): focus the owner took outside the queue stays there.
  useEffect(() => {
    // No queue on screen (it shows the empty state itself): the effect below handles that.
    const root = queueRoot.current;
    if (!barFocus.current || root == null) return;
    const active = document.activeElement;
    const lost = active == null || active === document.body || isQueueTitle(active, root);
    if (!lost) {
      if (!root.contains(active)) barFocus.current = false;
      return;
    }
    const target = root.querySelector<HTMLElement>(".ui-action-bar button, .ui-action-bar a[href]");
    if (target == null) return;
    target.focus({ preventScroll: true });
    takeReviewFocus();
  }, [barKind, shown?.id, leaving, jevLoading]);
  // FLOW-309: the last card left with focus in the bar, and this queue shows the empty state itself
  // (a sample, a project's queue). Its action takes focus after the title's own (a parent's effect
  // runs after its children's).
  const emptied = shown == null;
  useEffect(() => {
    if (emptied && barFocus.current) focusReviewEmptyAction();
  }, [emptied]);
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
  // FLOW-702: the auto job's fill still stands on the stored row; ביטול takes it back (a viewer reads it only).
  const jevFilled = !jevLoading && card.transaction_id && jevFilledOnCard(card, jev) ? {
    busy: jevUndo.pendingFor(card.transaction_id),
    // FLOW-706: with Jev off the card has no הצעת Jev pill, and the fill stays undoable.
    alone: true,
    ...(holdWrites || leaving ? {} : {
      onUndo: () => {
        if (previewWrite == null && blocked(sample ? "empty" : preview)) return;
        jevUndo.undo(card.transaction_id, jev.prefill?.auto ?? null);
      },
    }),
  } : null;
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
        // The header's title focuses itself on mount; that is not where the owner went. A sheet's
        // title (portalled, so outside this root) still counts as leaving the bar.
        if (isQueueTitle(event.target, queueRoot.current)) return;
        barFocus.current = event.target instanceof Element
          && (queueRoot.current?.contains(event.target) ?? false)
          && event.target.closest(".ui-action-bar") != null;
      }}
      onBlurCapture={(event) => {
        // Focus went somewhere outside the queue (the toast, the tab bar, a sheet): it is the owner's.
        const next = event.relatedTarget;
        if (next instanceof Element && !(queueRoot.current?.contains(next) ?? false)) barFocus.current = false;
      }}
    >
      <ScreenHeader title="לאישור" subtitle="תנועות שמחכות לשיוך" backTo={backTo} layout="inline" />
      {rows.length > 0 ? (
        <div className="ui-review-meter">
          {/* FLOW-327 r1: on the start side, near the thumb. A card opened from the list leaves it
              out: Back already goes to the list. */}
          {changeTo == null && listPlace == null ? (
            <TextLink className="ui-review-show-all" to={reviewListPath(search)} chevron={false}>הצגת הכול</TextLink>
          ) : null}
          {/* FLOW-507: a viewer doesn't work through the queue, so no visit meter. */}
          {listPlace == null && !holdWrites ? (
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
              <>
                <ReviewCount value={total} digits={reviewCountDigits(total)} side="total" />
                {total === 1 ? " ממתינה" : " ממתינות"}
              </>
            ) : (
              <>
                <ReviewCount value={index} digits={reviewCountDigits(total)} side="index" />
                {" מתוך "}
                <ReviewCount value={total} digits={reviewCountDigits(total)} side="total" />
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
          jevFilled={jevFilled}
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

/** The queue's own header title (it focuses itself on mount), not a sheet's title. */
function isQueueTitle(node: EventTarget | null, root: HTMLElement | null): boolean {
  return node instanceof Element && root != null && root.contains(node) && node.matches(".ui-focus-title")
    && node.closest("[role='dialog'], [data-vaul-drawer]") == null;
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

/** How long after ביטול's reopen lands the queue waits for the line before it drops the hold. */
const REVIEW_HOLD_SETTLE_MS = 1000;
/** FLOW-315: how many cards ahead the bank details read covers. */
const META_AHEAD = 50;

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
