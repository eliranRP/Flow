import { formatMoney, type ReviewRow } from "@flow/shared";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useHoldWrites, ViewerNote, ViewerScope } from "../use-is-viewer";
import { getSupabase } from "../lib/supabase";
import { useHomePreview } from "../preview";
import { useCategoriesQuery, useDashboardQuery, useInvalidateBooks, useLineMetaPageQuery, useLineMetaQuery } from "../use-books";
import { projectChoices } from "../project-groups";
import { Picker } from "../ui/change-picker";
import type { ChangeChoice } from "../ui/change-sheet-copy";
import { Sheet } from "../ui/sheet";
import { Toggle } from "../ui/toggle";
import { approveFailure, approveShown } from "../approve-review";
import { LEDGER_FOCUS_KEYS } from "../books-focus";
import { useHeldOrder } from "../list-hold";
import { pinReviewHead, pinReviewLine, releaseReviewHold, reviewHold, reviewPin } from "../review-pin";
import { emptyVisit, noteHandled, notePresence, visitPlace } from "../visit-meter";
import { assertNoError, useWrite } from "../use-write";
import { SAMPLE_TOAST } from "../setup/copy";
import { useJevQueue, useReviewFlags } from "./jev-review-card";
import { jevFilledOnCard, jevShown, withJev, type JevQueueData } from "./jev-review";
import { useJevUndo } from "./jev-undo";
import { useReviewSwap } from "./review-swap";
import { focusReviewEmptyAction, handReviewFocus, takeReviewFocus } from "./review-focus";
import { ReviewCount, ReviewSegments, reviewCountDigits } from "../ui/review-count";
import { Button } from "../ui/button";
import { CheckIcon } from "../ui/icons";
import { changeSaveFailure } from "../ui/change-sheet";
import { REVIEW_MISMATCH_ID, REVIEW_MISSING_ID, ReviewCard, SPLIT_MISMATCH_ACTION, SPLIT_MISMATCH_KEEP } from "../ui/review-card";
import { ActionBar, ActionBarRow } from "../ui/action-bar";
import { jevReasonText, reviewFlagView, reviewPaidView } from "../review-copy";
import { ScreenHeader } from "../ui/screen-header";
import { TextLink } from "../ui/text-link";
import { useToast } from "../ui/toast";
import { isReversal } from "../reversal";
import { useLineSplitQuery } from "./line-split";
import { invoiceDate, useBlockedPreview } from "./screen-shared";
import { assignmentPath, listFocusId, ReviewEmpty, reviewE2e, reviewHasParty, reviewIsSplit, reviewLineFocus, reviewListPath, reviewSuggestion } from "./review-shared";

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
  openPicker = false,
  handledBefore,
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
  /** FLOW-365b dev board state: the project picker opens on the first card. */
  openPicker?: boolean;
  /** FLOW-365b dev board state: this many cards of the visit were handled before the first one shown. */
  handledBefore?: number;
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
  // FLOW-365: דלג sends a card to the end of this queue. The order lives on this device only.
  const [deferred, setDeferred] = useState<string[]>([]);
  const skippedNow = useRef(false);
  const ordered = useMemo(() => deferOrder(held, deferred), [held, deferred]);
  const rows = fromList ? ordered : pinReviewHead(ordered, reviewPin());
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
  const visit = useRef(seededVisit(handledBefore));
  /** The card whose אישור is in flight. Only a second tap on that same card waits for it (decision 0180). */
  const approving = useRef<string | null>(null);
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
  const setupHandoffShown = useRef(false);
  /** FLOW-365b: the day's auto count from the last card on screen, read by the done copy after the queue empties. */
  const lastAuto = useRef(0);
  const [, bumpVisit] = useState(0);
  const openIds = rows.map((item) => item.id);
  const present = notePresence(visit.current, openIds);
  if (present !== visit.current) visit.current = present;
  function markHandled(id: string) {
    visit.current = noteHandled(visit.current, id);
    bumpVisit((value) => value + 1);
  }
  const leaving = motion === "out";
  // The card leaves the queue at once; a failure puts it back (decision 0180).
  const approve = useWrite<ReviewRow>({
    failure: (error) => (previewWrite ? changeSaveFailure(error) : approveFailure(error)),
    place: "bar",
    keys: ["review", "dashboard", "unpaid", "project", "project-category", "project-waiting", "filed-today", "txn"],
    optimistic: (target) => (previewWrite ? [] : [{
      key: ["review", preview],
      update: (old: unknown) => (Array.isArray(old) ? (old as ReviewRow[]).filter((row) => row.id !== target.id) : old),
    }]),
    retryFocus: () => {
      approveSlot.current?.querySelector("button")?.focus();
    },
    onError: (_error, target) => {
      if (approving.current === target.id) approving.current = null;
    },
    run: async (target) => {
      if (previewWrite) {
        await previewWrite.run();
        markHandled(target.id);
        return;
      }
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
      await approveShown(supabase, {
        id: filled.id,
        projectId: filled.project_id,
        categoryId: filled.category_id,
        shownProjectId: target.project_id,
        shownCategoryId: target.category_id,
      }, () => invalidate([...LEDGER_FOCUS_KEYS]));
      markHandled(target.id);
    },
    onSuccess: (target) => {
      if (approving.current === target.id) approving.current = null;
      const id = target.id;
      // ביטול brings the undone card back to the front.
      const line = target.transaction_id;
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
  /** FLOW-365: דלג sends the card on screen to the end of the queue. Nothing is written. */
  function skipCard() {
    const target = shown;
    if (target == null || leaving) return;
    // The pin keeps the card on screen at the head; once it is sent away, the pin moves on.
    pinReviewLine(null);
    // Focus was on this card's דלג; the next card's אישור takes it (FLOW-327 r2).
    skippedNow.current = true;
    // A skip is a visit to this card: the meter counts it, as it counts an approval.
    markHandled(target.id);
    setDeferred((list) => [...list.filter((id) => id !== target.id), target.id]);
  }
  // FLOW-365: the project picker (a sheet over the card) saves that one field and returns to the card.
  const [pickProject, setPickProject] = useState(openPicker);
  const [pickQuery, setPickQuery] = useState("");
  const [rememberPick, setRememberPick] = useState(true);
  async function savePickedProject(choice: ChangeChoice) {
    setPickProject(false);
    setPickQuery("");
    const target = shown;
    if (target == null || previewWrite != null) return;
    try {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("resolve_review", {
        p_id: target.id,
        p_action: "changed",
        p_resolve: false,
        p_project_id: choice.id,
        p_remember: rememberPick,
      }));
      await invalidate(["review", "dashboard", "project", "project-waiting", "txn"]);
    } catch {
      toast.show({ message: "לא הצלחנו לשמור.", tone: "bad", place: "bar" });
    }
  }
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
    const lost = active == null || active === document.body || isQueueTitle(active, root) || skippedNow.current;
    if (!lost) {
      if (!root.contains(active)) barFocus.current = false;
      return;
    }
    const target = root.querySelector<HTMLElement>(".ui-action-bar button, .ui-action-bar a[href]");
    if (target == null) return;
    target.focus({ preventScroll: true });
    // A disabled אישور takes no focus yet: the flag waits for the card that can take it.
    if (document.activeElement === target) skippedNow.current = false;
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
  // FLOW-365: a saved split shows its parts on the card. Read only for a card that is a split.
  const splitShown = shown != null && (shown.share_count ?? 0) > 1 && shown.reason !== "unallocated_shared";
  const summaryRead = useLineSplitQuery(splitShown ? shown.transaction_id : "", splitShown && !sample && previewWrite == null);
  const devParts = previewWrite != null && reviewE2e != null ? reviewE2e.e2eSplitParts(shown?.transaction_id) : null;
  const splitSummary = devParts != null ? {
    total: "$1,284.50",
    parts: devParts.map((part, index) => ({ key: String(index), amount: part.amount, project: part.project, category: part.rest ? `${part.category} · השאר` : part.category })),
  } : summaryRead.data != null && summaryRead.data.parts.length > 0 ? {
    total: formatMoney(summaryRead.data.lineMinor, summaryRead.data.currency),
    parts: summaryRead.data.parts.map((part, index) => ({
      key: String(index),
      amount: formatMoney(part.amount_minor, summaryRead.data?.currency ?? "ILS"),
      project: part.project_name ?? "ללא פרויקט",
      category: part.rest ? `${part.category_name ?? ""} · השאר` : (part.category_name ?? ""),
    })),
  } : null;
  const splitParts: number | "loading" | undefined = splitRead.data != null
    ? splitRead.data.parts.length
    : splitRead.isPending && splitRead.fetchStatus === "fetching" ? "loading" : undefined;
  const card = shown;
  if (!card) {
    // FLOW-365b: the queue emptied after this visit's cards: the done copy counts what this visit approved.
    const approved = visit.current.handled.size;
    return <ReviewEmpty search={search} homeTo={homeTo} homeLabel={homeLabel} backTo={backTo} done={approved > 0 ? { approved, auto: lastAuto.current } : undefined} />;
  }
  const current = card;
  const change = assignmentPath(changeTo, search, current.id, undefined, fromList);
  function openProject() {
    if (reviewIsSplit(current)) {
      if (!current.transaction_id) return;
      if (onShared) {
        onShared(current.transaction_id);
        return;
      }
      void navigate(`/transactions/${current.transaction_id}/split-category${search}`);
      return;
    }
    // FLOW-365: the owner's project row opens the picker sheet; a route change (changeTo) keeps the reviewer's own screen.
    if (changeTo == null) {
      setPickProject(true);
      return;
    }
    void navigate(assignmentPath(changeTo, search, current.id, "project", fromList, true));
  }
  /** FLOW-365: the card's split link opens the split screen for this line (FLOW-370 owns that screen). */
  function openSplit() {
    if (!current.transaction_id) return;
    void navigate(`/transactions/${current.transaction_id}/split-category${search}`);
  }
  function openCategory() {
    void navigate(assignmentPath(changeTo, search, current.id, "category", fromList, true));
  }
  const auto = card.auto_approved_today ?? 0;
  lastAuto.current = auto;
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
  // FLOW-365: אישור always reads אישור; a card with no project is disabled, and its line says why.
  const approveLabel = "אישור";
  const barHint = nextPick === "project" && !splitCard
    ? "בחרו פרויקט כדי לאשר"
    : nextPick === "category"
      ? "בחרו קטגוריה כדי לאשר"
      : splitCard
        ? "אישור שומר את הפיצול: כל חלק נספר בפרויקט ובקטגוריה שלו"
        : "שינוי של פרויקט או קטגוריה נשמר כחוק לספק";
  // FLOW-327 1.5: with both fields missing the card says why, and the button points at it.
  const missingBoth = settled && needProject && needCategory;
  // FLOW-333 C2: a split whose bank amount changed leads with עדכון הפיצול; להשאיר כך approves it as it stands.
  const mismatch = card.reason === "split_mismatch";
  const jevWhy = jev.prefill?.why == null ? null : jevReasonText(jev.prefill.why, card.direction, reviewHasParty(card), jev.prefill.project?.name);
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
    if (approving.current === current.id || !settled) return;
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
      void navigate(`/transactions/${current.transaction_id}/split-category${search}`);
      return;
    }
    approving.current = current.id;
    approve.mutate(current);
  }
  const skipButton = (
    <Button
      variant="ghost"
      disabled={leaving}
      onClick={() => {
        if (leaving) return;
        if (previewWrite == null && blocked(sample ? "empty" : preview)) return;
        skipCard();
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
      {/* FLOW-365: "הצגת הכול" sits on the bar's end side; a card opened from the list leaves it out. */}
      <ScreenHeader
        title="לאישור"
        backTo={backTo ?? "/"}
        backText={backTo == null ? "בית" : undefined}
        trailing={changeTo == null && listPlace == null ? <TextLink className="ui-review-show-all" to={reviewListPath(search)} chevron={false}>הצגת הכול</TextLink> : undefined}
      />
      {rows.length > 0 ? (
        <>
          {/* FLOW-507: a viewer doesn't work through the queue, so no visit meter. */}
          {/* FLOW-365: the counter line ("פריט i מתוך n" and the auto count) sits above the visit bar. */}
          <div className="ui-review-counts">
            {holdWrites ? (
              <span className="t-hint ui-review-counter">
                <ReviewCount value={total} digits={reviewCountDigits(total)} side="total" />
                {total === 1 ? " ממתינה" : " ממתינות"}
              </span>
            ) : (
              <span className="t-hint ui-review-counter">
                {"פריט "}
                <ReviewCount value={index} digits={reviewCountDigits(total)} side="index" />
                {" מתוך "}
                <ReviewCount value={total} digits={reviewCountDigits(total)} side="total" />
              </span>
            )}
            {auto > 0 ? (
              <TextLink className="ui-review-auto" to={filedTo ?? `/review/filed${search}`} chevron={false}>
                <ReviewCount value={auto} digits={reviewCountDigits(auto)} side="total" />
                {" אושרו אוטומטית היום"}
              </TextLink>
            ) : null}
          </div>
          {listPlace == null && !holdWrites ? <ReviewSegments index={index} total={total} /> : null}
        </>
      ) : null}
      <div className="ui-review-motion" data-motion={motion === "still" ? undefined : motion} key={card.id}>
        <ReviewCard
          supplier={card.supplier_name ?? card.customer_name ?? card.description}
          netAgorot={card.amount_net}
          currency={card.currency}
          vatLine={reviewVatLine(card.vat_agorot, card.currency)}
          paid={reviewPaidView(card)}
          suggestion={shownSuggestion}
          sourcePill={card.source === "mercury" ? "שורת בנק" : "חשבונית מצולמת"}
          photo={card.source === "photo"}
          sourceLine={`${invoiceDate(card.doc_date)} · ${card.direction === "income" ? "הכנסה" : "הוצאה"}`}
          onSplit={holdWrites || leaving ? undefined : openSplit}
          splitSummary={splitSummary}
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
      {pickProject ? (
        <ProjectPickSheet
          query={pickQuery}
          onQuery={setPickQuery}
          selectedId={current.project_id ?? ""}
          suggestionId={current.project_suggested === true ? (current.project_id ?? "") : ""}
          supplier={current.supplier_name ?? current.description}
          remember={rememberPick}
          onRemember={setRememberPick}
          onClose={() => {
            setPickProject(false);
            setPickQuery("");
          }}
          onPick={(choice) => { void savePickedProject(choice); }}
          onCreate={() => {
            setPickProject(false);
            void navigate(assignmentPath(changeTo, search, current.id, "project", fromList, true));
          }}
        />
      ) : null}
      {/* FLOW-365: the card after this one, dashed, so the owner sees what comes next. */}
      {!holdWrites && rows[1] != null ? (
        <div className="ui-review-next t-hint">
          <span>{`הבא בתור: ${rows[1].supplier_name ?? rows[1].description}`}</span>
          <bdi className="ui-num" dir="ltr">{formatMoney(rows[1].amount_net < 0n ? -rows[1].amount_net : rows[1].amount_net, rows[1].currency ?? "ILS")}</bdi>
        </div>
      ) : null}
      {holdWrites ? <ViewerNote className="t-hint ui-viewer-note" /> : (
      <ActionBar>
        {mismatch ? (
          <>
            <Button
              full
              disabled={!card.transaction_id}
              onClick={() => {
                if (!card.transaction_id) return;
                void navigate(`/transactions/${card.transaction_id}/split-category${search}`);
              }}
            >
              {SPLIT_MISMATCH_ACTION}
            </Button>
            <ActionBarRow>
              <div className="ui-review-approve" ref={approveSlot}>
                <Button
                  variant="secondary"
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
            <div className="ui-action-bar-row ui-review-actions">
              <div className="ui-review-approve" ref={approveSlot}>
                <Button
                  full
                  disabled={!settled || nextPick != null || !approvable}
                  icon={<CheckIcon />}
                  aria-describedby={missingBoth ? REVIEW_MISSING_ID : undefined}
                  onClick={runApprove}
                >
                  {approveLabel}
                </Button>
              </div>
              <Button variant="secondary" to={change}>שינוי</Button>
              {skipButton}
            </div>
            <p className="t-hint ui-review-bar-hint">{barHint}</p>
          </>
        )}
      </ActionBar>
      )}
    </div>
    </ViewerScope>
  );
}

/** FLOW-365: the cards דלג sent to the end, in the order they were sent. The rest keep the queue's order. */
export function deferOrder<T extends { id: string }>(rows: readonly T[], deferred: readonly string[]): T[] {
  if (deferred.length === 0) return [...rows];
  const late = new Map(deferred.map((id, index) => [id, index] as const));
  const head = rows.filter((row) => !late.has(row.id));
  const tail = rows
    .filter((row) => late.has(row.id))
    .sort((a, b) => (late.get(a.id) ?? 0) - (late.get(b.id) ?? 0));
  return [...head, ...tail];
}

/** FLOW-365b dev board state: a visit that already handled `count` cards (none of them open). */
function seededVisit(count: number | undefined) {
  let meter = emptyVisit();
  for (let index = 1; index <= (count ?? 0); index += 1) meter = noteHandled(meter, `handled-${String(index)}`);
  return meter;
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
    await invalidate(["review", "dashboard", "project", "project-category", "project-waiting", "filed-today", "txn"]);
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

/**
 * FLOW-365: the project picker sheet over the card. It reads the books only while it is open. A pick
 * saves that one field (the caller) and the sheet closes; "לזכור לספק" is on by default.
 */
function ProjectPickSheet({
  query,
  onQuery,
  selectedId,
  suggestionId,
  supplier,
  remember,
  onRemember,
  onClose,
  onPick,
  onCreate,
}: {
  query: string;
  onQuery: (value: string) => void;
  selectedId: string;
  suggestionId: string;
  supplier: string;
  remember: boolean;
  onRemember: (value: boolean) => void;
  onClose: () => void;
  onPick: (choice: ChangeChoice) => void;
  onCreate: () => void;
}) {
  const dashboard = useDashboardQuery(true);
  const samplePreview = useHomePreview() !== "off" && reviewE2e != null;
  const projectOptions = useMemo(
    () => (samplePreview && reviewE2e != null ? reviewE2e.e2eProjectChoices : projectChoices(dashboard.data)),
    [dashboard.data, samplePreview],
  );
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }} title="בחירת פרויקט" panelClassName="ui-review-pick">
      <Picker
        kind="project"
        heading="פרויקטים פעילים"
        searchable
        query={query}
        onQuery={onQuery}
        loading={!samplePreview && dashboard.isPending}
        listed={projectOptions}
        selectedId={selectedId}
        suggestionId={suggestionId}
        savingId={null}
        onSelect={(id) => {
          const choice = projectOptions.find((option) => option.id === id);
          if (choice) onPick(choice);
        }}
        onCreate={onCreate}
        splitLink={false}
      />
      <Toggle label={`לזכור לספק ${supplier}`} checked={remember} onChange={onRemember} />
    </Sheet>
  );
}
