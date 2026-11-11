import "../ui/lazy.css";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { LoanSplitPart } from "@flow/shared";
import { useSheetHistory } from "../ui/back";
import { Button } from "../ui/button";
import { ConfirmSheet } from "../ui/confirm-sheet";
import { israelToday } from "../ui/date-math";
import { EmptyState } from "../ui/empty-state";
import { LoanIcon } from "../ui/icons-later";
import { SectionHead } from "../ui/layout";
import { List, ListRow } from "../ui/list-row";
import { ScreenHeader } from "../ui/screen-header";
import { Sheet } from "../ui/sheet";
import { Skeleton } from "../ui/skeleton";
import { useToast } from "../ui/toast";
import { useHomePreview, usePreviewSearch } from "../preview";
import { useDashboardQuery } from "../use-books";
import { useHoldWrites, ViewerNote, ViewerScope } from "../use-is-viewer";
import {
  LOAN_KIND_LIST_LABEL,
  LOAN_PART_LABEL,
  LOAN_STATUS_LABEL,
  loanClosedLine,
  loanClosedToast,
  loanDeleteConsequence,
  loanDeletedToast,
  loanFailure,
  loanRefusalOf,
  loanRefusalPlace,
  type LoanCopyContext,
  type LoanRefusalPlace,
} from "./loan-copy";
import {
  kindValue,
  lastPaymentDate,
  partCategoryValue,
  type LoanRateRow,
} from "./loan-detail-data";
import { LoanBand, loanBandRows, LoanCheckCard, LoanClosedCard, LoanNextCard, LoanRateChangesCard, LoanPaidCard, LoanRecentCard, LoanRowsCard, RateValue, type LoanTermRow } from "./loan-detail-cards";
import { LoanPaymentsView, type LoanPaymentsTab } from "./loan-payments-view";
import { LoanPartSheet } from "./loan-detail-sheets";
import { LoanRateSheet } from "./loan-rate-sheet";
import { LoanCloseSheet, LoanLinkPicker, type LoanLinkChoice } from "./loan-close-sheet";
import { BandOfflineLine, PageLoadFailed, useOnline } from "../ui/band-states";
import { LoanKindSheet } from "./loan-kind-sheet";
import { CLOSING_PAID_LABEL, LoanClosingPaidSheet, closingPaidRefusal, closingPaidToast, closingPaidValue, showsClosingPaid } from "./loan-closing-paid-sheet";
import {
  inversePatch,
  liveLoanWrites,
  useLiveLoan,
  useMemoryLoanStore,
  type LoanBundle,
  type LoanPatch,
  type LoanRead,
  type LoanWrites,
  type MemoryLoanStore,
} from "./loan-detail-store";
import { showsLoanBalance, useLoanList } from "./loan-list";
import { LOAN_WRITE_KEYS } from "./loan-match-api";
import { LoanProjectPicker, NO_PROJECT, type LoanProjectSource } from "./loan-project-picker";
import { loanOutlook, paymentsLeft } from "./loan-outlook";



/**
 * FLOW-106 B and FLOW-110: `/loans/:loanId`, one loan's page (template A with the tab
 * bar). The balance with its status, then פרטים, שינויי ריבית, קטגוריות לחלקים and תשלומים;
 * each row opens a small sheet that saves alone, with its own refusal and undo (0075). The
 * owner deletes the loan at the bottom (decision 0142); a viewer reads static rows.
 */

export const LOAN_ERROR_TITLE = "ההלוואה לא נטענה";
export const LOAN_MISSING_TITLE = "ההלוואה לא נמצאה";

type SheetName = "kind" | "rate" | "close" | "link" | "part" | "project" | "closing" | "delete";

/** FLOW-962: the loan page's toasts hang under its bar, and an undo stays 5s (decision 0214, extending 0212). */
const LOAN_TOAST = { place: "top", durationMs: 5000 } as const;

export type LoanView = "summary" | "payments";

export function LoanDetailScreen({
  store: givenStore,
  listPath,
  today: givenToday,
  view = "summary",
  offlineSince: givenOffline,
}: {
  /** FLOW-962 stories: draw the page offline, its figures from this moment. */
  offlineSince?: number;
  /** The page, or its all-payments page (FLOW-139c). */
  view?: LoanView;
  /** Stories, tests and the dev route pass a memory store. Live omits it. */
  store?: MemoryLoanStore;
  /** Where Back and a delete go. Default: the list this page sits under. */
  listPath?: string;
  /** Stories pin the day, so the rate in force and the accrual stay put. */
  today?: string;
} = {}) {
  const { loanId = "" } = useParams();
  const location = useLocation();
  const search = usePreviewSearch();
  const preview = useHomePreview();
  // `?preview=1` reads invented loans. They load on demand, so the sample module stays out of
  // the main bundle and a signed-in owner never downloads it.
  const [previewStore, setPreviewStore] = useState<MemoryLoanStore | null>(null);
  const wantsPreview = givenStore == null && preview !== "off";
  useEffect(() => {
    if (!wantsPreview) return;
    let current = true;
    void import("../dev/loan-detail-sample").then((sample) => {
      if (current) setPreviewStore(sample.previewLoanStore());
    });
    return () => { current = false; };
  }, [wantsPreview]);
  const store = givenStore ?? (wantsPreview ? previewStore : null);
  useMemoryLoanStore(store);
  const isLive = givenStore == null && !wantsPreview;
  const live = useLiveLoan(loanId, isLive);
  const online = useOnline();
  const dashboard = useDashboardQuery(isLive);
  // The all-payments page sits under the loan's own path, so Back steps up to the loan page.
  const loanPath = loanId === "" ? location.pathname : location.pathname.slice(0, location.pathname.lastIndexOf(loanId) + loanId.length);
  const listBack = listPath ?? `${loanPath.replace(/\/[^/]*\/?$/, "")}${search}`;
  const back = view === "payments" ? `${loanPath}${search}` : listBack;
  const read: LoanRead = preview === "loading"
    ? { phase: "loading" }
    : preview === "error" || preview === "error-server"
      ? { phase: "error", retry: () => undefined, retrying: false }
      : store ? store.read(loanId) : wantsPreview ? { phase: "loading" } : live;
  const projects: LoanProjectSource = store
    ? { rows: store.projects }
    : {
      rows: (dashboard.data?.projects ?? []).map((project) => ({ id: project.id, name: project.name, status: project.status, code: project.code })),
      loading: dashboard.isLoading,
      error: dashboard.isError,
      retrying: dashboard.isFetching,
      onRetry: () => { void dashboard.refetch(); },
    };
  // FLOW-962: the company's other loans, for a refinance's link and its name on a closed page.
  const liveList = useLoanList(isLive && read.phase === "ready" ? read.bundle.loan.companyId : null);
  const loanChoices: LoanLinkChoice[] = (store ? store.rows() : (liveList.data ?? [])).map((row) => ({ id: row.id, name: row.name }));
  if (read.phase === "loading") return <LoanDetailLoading back={back} />;
  if (read.phase === "error") {
    return (
      <div>
        <ScreenHeader title="הלוואה" kicker="הלוואות" backTo={listBack} />
        <div className="ui-page-pad">
          <PageLoadFailed title={LOAN_ERROR_TITLE} offline={givenOffline != null || !online} onRetry={read.retry} />
        </div>
      </div>
    );
  }
  if (read.phase === "missing") {
    return (
      <div>
        <ScreenHeader title="הלוואה" kicker="הלוואות" backTo={listBack} />
        <EmptyState
          icon={<LoanIcon />}
          title={LOAN_MISSING_TITLE}
          body="ייתכן שנמחקה או שייכת לעסק אחר."
          action={<Button variant="secondary" to={listBack}>לרשימת ההלוואות</Button>}
        />
      </div>
    );
  }
  return (
    <LoanDetailReady
      key={read.bundle.loan.id}
      bundle={read.bundle}
      writes={store ?? liveLoanWrites}
      liveKeys={isLive}
      projects={projects}
      back={back}
      listBack={listBack}
      loanPath={loanPath}
      view={view}
      today={givenToday ?? israelToday()}
      search={search}
      offlineSince={givenOffline ?? (!online && read.readAt != null && read.readAt > 0 ? read.readAt : null)}
      loanChoices={loanChoices.filter((choice) => choice.id !== read.bundle.loan.id)}
    />
  );

}

function LoanDetailLoading({ back }: { back: string }) {
  return (
    <div aria-busy="true">
      <ScreenHeader barOnly kicker="הלוואות" backTo={back} />
      <p className="sr-only" role="status">טוען…</p>
      {/* FLOW-115: the name, the balance and the status hold their loaded lines, so nothing moves when the read lands. */}
      <div className="ui-page-pad" aria-hidden="true">
        <p className="t-total ui-loan-skel-title ui-loan-skel-line"><Skeleton width="md" /></p>
        <div className="ui-loan-head">
          <p className="t-detail ui-loan-skel-line"><Skeleton width="lg" /></p>
          <div className="ui-status-row">
            <span className="ui-status ui-skeleton-bar ui-loan-skel-pill"><span className="ui-chip-label">{"\u00a0"}</span></span>
          </div>
        </div>
      </div>
      <SectionHead title="פרטים" />
      <List className="ui-loan-skel-rows">
        {["a", "b", "c", "d", "e", "f"].map((key) => <ListRow key={key} variant="skeleton" icon eyebrow end={false} />)}
      </List>
    </div>
  );
}

function LoanDetailReady({
  bundle,
  writes,
  liveKeys,
  projects,
  back,
  listBack,
  loanPath,
  view,
  today,
  search,
  offlineSince,
  loanChoices,
}: {
  offlineSince: number | null;
  loanChoices: readonly LoanLinkChoice[];
  bundle: LoanBundle;
  writes: LoanWrites;
  liveKeys: boolean;
  projects: LoanProjectSource;
  back: string;
  listBack: string;
  loanPath: string;
  view: LoanView;
  today: string;
  search: string;
}) {
  const { loan, payments, categories } = bundle;
  const holdWrites = useHoldWrites();
  const toast = useToast();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // FLOW-1046: התשלום הבא opens the payments on הבאים.
  const initialTab: LoanPaymentsTab = params.get("tab") === "upcoming" ? "upcoming" : "paid";
  const [sheet, setSheetState] = useState<SheetName | null>(null);
  const [part, setPart] = useState<LoanSplitPart | null>(null);
  const [rate, setRate] = useState<LoanRateRow | null>(null);
  const [projectSaving, setProjectSaving] = useState<{ id: string | null } | undefined>(undefined);
  const [deleting, setDeleting] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [linkSaving, setLinkSaving] = useState(false);
  /** Saves in flight: the sheet stays open while any runs, so an overlapping save ending first does not release it. */
  const writesInFlight = useRef(0);
  const returnRef = useRef<HTMLElement | null>(null);
  // A close swaps סגירת ההלוואה for החזרה לפעילות, so focus goes back to whichever is mounted now.
  const statusRef = useRef<HTMLButtonElement | null>(null);
  const setSheet = useSheetHistory("loan-detail", sheet != null, (next) => {
    if (!next) setSheetState(null);
  }, () => writesInFlight.current === 0);
  const ctx: LoanCopyContext = { currency: loan.currency, closedOn: loan.closedOn, startDate: loan.startDate };

  function open(name: SheetName) {
    if (holdWrites) return;
    returnRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSheetState(name);
    setSheet(true);
  }

  async function refresh(keys: readonly string[] = ["loans", "project", "dashboard", "categories"]) {
    if (!liveKeys) return;
    await Promise.all(keys.map((key) => client.invalidateQueries({ queryKey: [key] })));
  }

  /**
   * One write: on success the toast (with ביטול when `undo` is given); on failure a refusal that
   * belongs to the open sheet comes back for the sheet to show, and anything else is a toast
   * ("השינוי לא נשמר" with ניסיון חוזר when it may pass next time).
   */
  async function save(run: () => Promise<void>, options: {
    success: string;
    undo?: () => Promise<void>;
    undone?: string;
    place?: LoanRefusalPlace;
    /** A refusal the open sheet shows on its own line (FLOW-466); null sends it to a toast. */
    inSheet?: (error: Error) => string | null;
  }): Promise<string | null> {
    writesInFlight.current += 1;
    try {
      await run();
    } catch (raw) {
      const error = raw instanceof Error ? raw : new Error("failed");
      const own = options.inSheet?.(error) ?? null;
      if (own != null) return own;
      const reason = loanRefusalOf(error);
      const failure = loanFailure(error, ctx);
      const message = typeof failure === "string" ? failure : failure.message;
      if (reason != null && options.place != null && loanRefusalPlace(reason) === options.place) return message;
      const retry = typeof failure !== "string" && failure.retry === true;
      toast.show({
        tone: "bad",
        message,
        place: LOAN_TOAST.place,
        ...(retry ? { action: "ניסיון חוזר", onAction: () => { void save(run, options); } } : {}),
      });
      return "";
    } finally {
      writesInFlight.current -= 1;
    }
    await refresh();
    const undo = options.undo;
    toast.show({
      message: options.success,
      ...LOAN_TOAST,
      ...(undo ? {
        action: "ביטול",
        onAction: () => {
          void (async () => {
            try {
              await undo();
              await refresh();
              toast.show({ message: options.undone ?? "השינוי בוטל", place: LOAN_TOAST.place });
            } catch (raw) {
              const failure = loanFailure(raw instanceof Error ? raw : new Error("failed"), ctx);
              toast.show({ tone: "bad", message: typeof failure === "string" ? failure : failure.message, place: LOAN_TOAST.place });
            }
          })();
        },
      } : {}),
    });
    return null;
  }

  function patchSave(patch: LoanPatch, success: string, place?: LoanRefusalPlace, undone?: string) {
    const back = inversePatch(loan, patch);
    return save(() => writes.update(loan.id, patch), {
      success,
      place,
      undone,
      undo: () => writes.update(loan.id, back),
    });
  }

  async function reopen() {
    if (reopening) return;
    setReopening(true);
    await patchSave({ status: "open", closedOn: null, refinancedIntoId: null }, "ההלוואה חזרה לפעילות", undefined, "ההלוואה נסגרה שוב");
    setReopening(false);
  }

  const projectName = loan.projectId == null ? null : (projects.rows.find((row) => row.id === loan.projectId)?.name ?? null);
  const flagged = payments.filter((item) => item.needsReview);
  const closed = loan.status !== "open";
  const linked = loan.refinancedIntoId == null ? null : (loanChoices.find((choice) => choice.id === loan.refinancedIntoId) ?? null);
  const outlook = loanOutlook(loan, today);
  const lastPaid = lastPaymentDate(payments);
  const termRows: LoanTermRow[] = [
    { key: "kind", label: "סוג", value: LOAN_KIND_LIST_LABEL[loan.kind], onOpen: holdWrites ? null : () => { open("kind"); } },
    { key: "rate", label: "ריבית", value: <RateValue loan={loan} today={today} />, onOpen: holdWrites ? null : () => { setRate(null); open("rate"); } },
    { key: "project", label: "פרויקט", value: projectName ?? NO_PROJECT, onOpen: holdWrites ? null : () => { open("project"); } },
    // FLOW-466: a loan paid out at closing says what it paid, for the purchase price. FLOW-473: only
    // such a loan (Sub2), or one with an amount stored, so it can still be seen and cleared.
    ...(showsClosingPaid(loan, bundle.paidAtClosing === true) ? [{ key: "closing", label: CLOSING_PAID_LABEL, value: closingPaidValue(loan), onOpen: holdWrites ? null : () => { open("closing"); } }] : []),
    // FLOW-962: the status only reads. סגירת ההלוואה and החזרה לפעילות below change it.
    { key: "status", label: "סטטוס", value: loan.status === "open" ? LOAN_STATUS_LABEL.open : loanClosedLine(loan.status, loan.closedOn), onOpen: null },
  ];
  const upcomingSearch = (() => {
    const params = new URLSearchParams(search);
    params.set("tab", "upcoming");
    return `?${params.toString()}`;
  })();
  const onClose = holdWrites || closed ? null : () => { open("close"); };

  return (
    <ViewerScope>
      {view === "payments" ? (
          <LoanPaymentsView
            loan={loan}
            payments={payments}
            upcoming={paymentsLeft(loan, today)}
            projectName={projectName}
            search={search}
            back={`${loanPath}${search}`}
            initialTab={initialTab}
          />
        ) : (
          <div className="ui-loan-page">
            <LoanBand
              loan={loan}
              projectName={projectName}
              outlook={closed ? null : outlook}
              rows={loanBandRows(loan, closed ? null : outlook, payments, today)}
              back={back}
              onMore={onClose}
              ended={!showsLoanBalance(loan)}
              next={outlook == null || closed ? null : <LoanNextCard loan={loan} outlook={outlook} to={`${loanPath}/payments${upcomingSearch}`} />}
            />
            <ViewerNote />
            {offlineSince == null ? null : <BandOfflineLine since={offlineSince} onPage />}
            {loan.status === "open" ? null : (
              <LoanClosedCard
                status={loan.status}
                closedOn={loan.closedOn}
                link={linked == null ? null : { name: linked.name, to: `${loanPath.slice(0, loanPath.lastIndexOf("/"))}/${linked.id}${search}` }}
                // A link whose loan is still loading draws neither row.
                onLink={loan.status === "closed" && !holdWrites && loan.refinancedIntoId == null ? () => { open("link"); } : null}
              />
            )}
            {flagged.length > 0 && !closed ? (
              <LoanCheckCard
                loanId={loan.id}
                count={flagged.length}
                editHref={`/transactions/${flagged[0]?.transactionId ?? ""}${search}`}
                onChecked={(undo) => {
                  toast.show({ message: "סומן כנבדק", ...LOAN_TOAST, action: "ביטול", onAction: undo });
                }}
              />
            ) : null}
            <LoanPaidCard loan={loan} payments={payments} categories={categories} today={today} onOpenPart={holdWrites ? null : (item) => { setPart(item); open("part"); }} />
            <LoanRowsCard className="ui-loan-terms" rows={termRows} />
            {loan.rates.length > 0 ? (
              <LoanRateChangesCard rates={loan.rates} onOpen={holdWrites ? null : (rate) => { setRate(rate); open("rate"); }} />
            ) : null}
            <LoanRecentCard loan={loan} payments={payments} search={search} loanPath={loanPath} year={today.slice(0, 4)} />
            {holdWrites ? null : closed ? (
              <Button variant="secondary" full buttonRef={statusRef} busy={reopening} onClick={() => { void reopen(); }}>החזרה לפעילות</Button>
            ) : (
              <div className="ui-loan-close-entry">
                <Button variant="secondary" full buttonRef={statusRef} onClick={() => { open("close"); }}>סגירת ההלוואה</Button>
                <p className="ui-loan-card-note">לפירעון מוקדם או למימון מחדש.</p>
              </div>
            )}
            {holdWrites ? null : (
              <button type="button" className="ui-loan-delete" onClick={() => { open("delete"); }}>מחיקת ההלוואה</button>
            )}
          </div>
        )}
      {holdWrites ? null : (
          <>
            <LoanKindSheet
              loan={loan}
              open={sheet === "kind"}
              onOpenChange={setSheet}
              returnFocusRef={returnRef}
              onSave={(patch) => patchSave(patch, `סוג · ${kindValue({ ...loan, ...patch })}`, "kind")}
            />
            <LoanRateSheet
              loan={loan}
              rate={rate}
              open={sheet === "rate"}
              today={today}
              paymentDates={payments.map((payment) => payment.docDate)}
              nextDue={outlook?.next.dueDate ?? null}
              onOpenChange={setSheet}
              returnFocusRef={returnRef}
              onSave={(next) => {
                const previous = next.id == null
                  ? loan.rates.find((item) => item.effectiveDate === next.effectiveDate) ?? null
                  : loan.rates.find((item) => item.id === next.id) ?? null;
                let savedId: string | null = null;
                return save(async () => { savedId = await writes.saveRate(loan, next); }, {
                  success: "הריבית עודכנה",
                  place: "rate",
                  undone: "הריבית הקודמת חזרה",
                  undo: async () => {
                    if (previous != null) {
                      await writes.saveRate(loan, { id: savedId ?? previous.id, effectiveDate: previous.effectiveDate, annualRatePpm: previous.annualRatePpm });
                    } else if (savedId != null) {
                      await writes.deleteRate(savedId);
                    }
                  },
                });
              }}
              onRemove={(removed) => save(() => writes.deleteRate(removed.id), {
                success: "השינוי הוסר",
                place: "rate",
                undone: "השינוי חזר",
                undo: async () => { await writes.saveRate(loan, { effectiveDate: removed.effectiveDate, annualRatePpm: removed.annualRatePpm }); },
              })}
            />
            <LoanCloseSheet
              loanName={loan.name}
              open={sheet === "close"}
              onOpenChange={setSheet}
              returnFocusRef={statusRef}
              lastPayment={lastPaid}
              defaultDate={today}
              today={today}
              nextDue={outlook?.next.dueDate ?? null}
              linkChoices={loanChoices}
              onSave={(next) => patchSave(next, loanClosedToast(loan.name, next.status, loan.balanceMinor, loan.currency), "status", "ההלוואה חזרה לפעילות")}
            />
            <Sheet
              open={sheet === "link"}
              onOpenChange={(next) => {
                if (!next && linkSaving) return false;
                setSheet(next);
              }}
              title="ההלוואה החדשה"
              hint={loan.name}
              returnFocusRef={returnRef}
              panelClassName="ui-sheet-fit"
            >
              <LoanLinkPicker
                choices={loanChoices}
                selectedId={loan.refinancedIntoId}
                disabled={linkSaving}
                onSelect={(id) => {
                  if (linkSaving) return;
                  if (id === loan.refinancedIntoId) {
                    setSheet(false);
                    return;
                  }
                  setLinkSaving(true);
                  void patchSave({ refinancedIntoId: id }, id == null ? "הקישור להלוואה החדשה הוסר" : "ההלוואה החדשה קושרה").then((failed) => {
                    setLinkSaving(false);
                    if (failed == null) setSheet(false);
                  });
                }}
              />
            </Sheet>
            <LoanPartSheet
              part={part}
              loan={loan}
              categories={categories}
              open={sheet === "part"}
              onOpenChange={setSheet}
              returnFocusRef={returnRef}
              onSave={({ part: which, categoryId }) => patchSave(
                { categoryIds: { [which]: categoryId } },
                `${LOAN_PART_LABEL[which]} · ${partCategoryValue({ categoryIds: { ...loan.categoryIds, [which]: categoryId } }, categories, which)}`,
                "category",
              )}
            />
            <Sheet
              open={sheet === "project"}
              onOpenChange={(next) => {
                if (!next && projectSaving != null) return false;
                setSheet(next);
              }}
              title="פרויקט"
              hint={loan.name}
              returnFocusRef={returnRef}
              panelClassName="ui-sheet-fit"
            >
              <LoanProjectPicker
                source={projects}
                selectedId={loan.projectId}
                saving={projectSaving}
                onSelect={(id) => {
                  if (projectSaving != null) return;
                  if (id === loan.projectId) {
                    setSheet(false);
                    return;
                  }
                  setProjectSaving({ id });
                  void patchSave({ projectId: id }, id == null ? "ההלוואה הוסרה מהפרויקט" : "ההלוואה שויכה לפרויקט").then((failed) => {
                    setProjectSaving(undefined);
                    if (failed == null) setSheet(false);
                  });
                }}
              />
            </Sheet>
            <LoanClosingPaidSheet
              loan={loan}
              open={sheet === "closing"}
              onOpenChange={setSheet}
              returnFocusRef={returnRef}
              onSave={(minor) => {
                let prior = loan.closingPaidMinor;
                return save(async () => { prior = (await writes.setClosingPaid(loan.id, minor)).prior; }, {
                  success: closingPaidToast(minor, loan),
                  undone: "הסכום הקודם חזר",
                  inSheet: (error) => closingPaidRefusal(error, loan),
                  undo: async () => { await writes.setClosingPaid(loan.id, prior); },
                });
              }}
            />
            <ConfirmSheet
              open={sheet === "delete"}
              onOpenChange={(next) => {
                if (!next && deleting) return;
                setSheet(next);
              }}
              title="למחוק את ההלוואה?"
              item={loan.name}
              consequence={loanDeleteConsequence(payments.length)}
              confirmLabel="מחיקת ההלוואה"
              destructive
              busy={deleting}
              returnFocusRef={returnRef}
              onConfirm={() => {
                if (deleting) return;
                setDeleting(true);
                void deleteLoan();
              }}
            />
          </>
      )}
    </ViewerScope>
  );


  async function deleteLoan() {
    const loanId = loan.id;
    const name = loan.name;
    try {
      await writes.deleteLoan(loanId);
    } catch (raw) {
      setDeleting(false);
      const failure = loanFailure(raw instanceof Error ? raw : new Error("failed"), ctx);
      toast.show({ tone: "bad", message: typeof failure === "string" ? failure : failure.message, place: LOAN_TOAST.place });
      return;
    }
    // The payments count whole again under their own categories: every P&L read changes.
    await refresh(LOAN_WRITE_KEYS);
    // The list is the page under this one; replace keeps Back from landing on the deleted loan.
    void navigate(listBack, { replace: true });
    toast.show({
      message: loanDeletedToast(name),
      ...LOAN_TOAST,
      action: "ביטול",
      onAction: () => {
        void (async () => {
          try {
            await writes.restoreLoan(loanId);
            await refresh(LOAN_WRITE_KEYS);
            toast.show({ message: "ההלוואה חזרה", place: LOAN_TOAST.place });
          } catch (raw) {
            const failure = loanFailure(raw instanceof Error ? raw : new Error("failed"), ctx);
            toast.show({ tone: "bad", message: typeof failure === "string" ? failure : failure.message, place: LOAN_TOAST.place });
          }
        })();
      },
    });
  }
}
