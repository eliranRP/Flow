import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { LoanSplitPart } from "@flow/shared";
import { useSheetHistory } from "../ui/back";
import { Banner } from "../ui/banner";
import { Button } from "../ui/button";
import { StatusDot } from "../ui/status-dot";
import { ConfirmSheet } from "../ui/confirm-sheet";
import { formatDisplay, israelToday } from "../ui/date-math";
import { EmptyState } from "../ui/empty-state";
import { AlertIcon, InfoIcon, LoanIcon, RefreshIcon } from "../ui/icons";
import { SectionHead } from "../ui/layout";
import { List, ListRow } from "../ui/list-row";
import { ScreenHeader } from "../ui/screen-header";
import { Sheet } from "../ui/sheet";
import { Skeleton } from "../ui/skeleton";
import { TextLink } from "../ui/text-link";
import { useToast } from "../ui/toast";
import { useHomePreview, usePreviewSearch } from "../preview";
import { useDashboardQuery } from "../use-books";
import { useHoldWrites, ViewerNote, ViewerScope } from "../use-is-viewer";
import {
  LOAN_KIND_LIST_LABEL,
  LOAN_PART_LABEL,
  loanDeleteConsequence,
  loanDeletedToast,
  loanFailure,
  loanRefusalOf,
  loanRefusalPlace,
  type LoanCopyContext,
  type LoanRefusalPlace,
} from "./loan-copy";
import {
  closeDateDefault,
  kindValue,
  lastPaymentDate,
  partCategoryValue,
  statusPill,
  statusToast,
  type LoanRateRow,
} from "./loan-detail-data";
import { LoanBalanceCard, LoanNextCard, LoanRateChangesCard, LoanRecentCard, LoanRowsCard, LoanYtdCard, RateValue, type LoanTermRow } from "./loan-detail-cards";
import { LoanPaymentsView } from "./loan-payments-view";
import { loanSubtitle, paymentTotals, wholeMoney } from "./loan-detail-view-data";
import { TransactionTopBar } from "./transaction-top-bar";
import { LoanKindSheet, LoanPartSheet, LoanRateSheet, LoanStatusSheet } from "./loan-detail-sheets";
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
import { showsLoanBalance } from "./loan-list";
import { LOAN_WRITE_KEYS } from "./loan-match-api";
import { LoanProjectPicker, NO_PROJECT, type LoanProjectSource } from "./loan-project-picker";
import { loanOutlook, paidInYear } from "./loan-outlook";



/**
 * FLOW-106 B and FLOW-110: `/loans/:loanId`, one loan's page (template A with the tab
 * bar). The balance with its status, then פרטים, שינויי ריבית, קטגוריות לחלקים and תשלומים;
 * each row opens a small sheet that saves alone, with its own refusal and undo (0075). The
 * owner deletes the loan at the bottom (decision 0142); a viewer reads static rows.
 */

export const LOAN_ERROR_TITLE = "לא הצלחנו לטעון את ההלוואה";
export const LOAN_MISSING_TITLE = "ההלוואה לא נמצאה";

type SheetName = "kind" | "rate" | "status" | "part" | "project" | "delete";

export type LoanView = "summary" | "payments";

export function LoanDetailScreen({
  store: givenStore,
  listPath,
  today: givenToday,
  view = "summary",
}: {
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
  if (read.phase === "loading") return <LoanDetailLoading back={back} />;
  if (read.phase === "error") {
    return (
      <div>
        <ScreenHeader title="הלוואה" kicker="הלוואות" backTo={listBack} />
        <EmptyState
          icon={<InfoIcon size={36} />}
          title={LOAN_ERROR_TITLE}
          body="נסו שוב בעוד רגע"
          action={(
            <Button variant="pill" icon={<RefreshIcon />} busy={read.retrying} onClick={read.retry}>
              ניסיון חוזר
            </Button>
          )}
        />
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
          action={<Button variant="pill" to={listBack}>לרשימת ההלוואות</Button>}
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
        <p className="t-title-1 ui-loan-skel-title ui-loan-skel-line"><Skeleton width="md" /></p>
        <div className="ui-loan-head">
          <p className="t-display ui-loan-skel-line"><Skeleton width="lg" /></p>
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
}: {
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
  const [sheet, setSheetState] = useState<SheetName | null>(null);
  const [part, setPart] = useState<LoanSplitPart | null>(null);
  const [rate, setRate] = useState<LoanRateRow | null>(null);
  const [projectSaving, setProjectSaving] = useState<{ id: string | null } | undefined>(undefined);
  const [deleting, setDeleting] = useState(false);
  const busyClose = useRef(false);
  const returnRef = useRef<HTMLElement | null>(null);
  // The status opener is the מצב row, or "שינוי" beside the pill once the loan ended (FLOW-356). A
  // status change swaps one for the other, so the sheet returns focus to whichever is mounted now.
  const statusRef = useRef<HTMLButtonElement | null>(null);
  const setSheet = useSheetHistory("loan-detail", sheet != null, (next) => {
    if (!next) setSheetState(null);
  }, () => !busyClose.current);
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
  }): Promise<string | null> {
    try {
      busyClose.current = true;
      await run();
    } catch (raw) {
      const error = raw instanceof Error ? raw : new Error("failed");
      const reason = loanRefusalOf(error);
      const failure = loanFailure(error, ctx);
      const message = typeof failure === "string" ? failure : failure.message;
      if (reason != null && options.place != null && loanRefusalPlace(reason) === options.place) return message;
      const retry = typeof failure !== "string" && failure.retry === true;
      toast.show({
        tone: "bad",
        message,
        ...(retry ? { action: "ניסיון חוזר", onAction: () => { void save(run, options); } } : {}),
      });
      return "";
    } finally {
      busyClose.current = false;
    }
    await refresh();
    const undo = options.undo;
    toast.show({
      message: options.success,
      ...(undo ? {
        action: "ביטול",
        onAction: () => {
          void (async () => {
            try {
              await undo();
              await refresh();
              toast.show({ message: options.undone ?? "השינוי בוטל" });
            } catch (raw) {
              const failure = loanFailure(raw instanceof Error ? raw : new Error("failed"), ctx);
              toast.show({ tone: "bad", message: typeof failure === "string" ? failure : failure.message });
            }
          })();
        },
      } : {}),
    });
    return null;
  }

  function patchSave(patch: LoanPatch, success: string, place?: LoanRefusalPlace) {
    const back = inversePatch(loan, patch);
    return save(() => writes.update(loan.id, patch), {
      success,
      place,
      undo: () => writes.update(loan.id, back),
    });
  }

  const projectName = loan.projectId == null ? null : (projects.rows.find((row) => row.id === loan.projectId)?.name ?? null);
  const flagged = payments.filter((item) => item.needsReview);
  // FLOW-138 "Hide" (FLOW-356): a paid-off loan leads with "נפרעה · date" alone, as on the list.
  const ended = !showsLoanBalance(loan);
  const outlook = loanOutlook(loan, today);
  const paid = paidInYear(payments, today.slice(0, 4));
  const paidTotal = paymentTotals(payments).total;
  const lastPaid = lastPaymentDate(payments);
  const termRows: LoanTermRow[] = [
    { key: "kind", label: "סוג", value: LOAN_KIND_LIST_LABEL[loan.kind], onOpen: holdWrites ? null : () => { open("kind"); } },
    { key: "rate", label: "ריבית", value: <RateValue loan={loan} today={today} />, onOpen: holdWrites ? null : () => { setRate(null); open("rate"); } },
    { key: "project", label: "פרויקט", value: projectName ?? NO_PROJECT, onOpen: holdWrites ? null : () => { open("project"); } },
    { key: "status", label: "סטטוס", value: statusPill(loan), onOpen: holdWrites ? null : () => { open("status"); }, buttonRef: statusRef },
  ];
  const topBar = view === "payments"
    ? <TransactionTopBar fallback={`${loanPath}${search}`} backLabel={loan.name} title={`כל התשלומים · ${wholeMoney(paidTotal, loan.currency)}`} end={null} />
    : <TransactionTopBar fallback={back} backLabel="הלוואות" title={`${loan.name} · ${wholeMoney(loan.balanceMinor, loan.currency)}`} end={null} />;

  return (
    <ViewerScope>
      {topBar}
      {view === "payments" ? (
          <LoanPaymentsView loan={loan} payments={payments} projectName={projectName} search={search} />
        ) : (
          <div className="ui-loan-page">
            <ViewerNote />
            <header className="ui-loan-title">
              <h1 className="ui-loan-name">{loan.name}</h1>
              <p className="ui-loan-sub">{loanSubtitle(loan, projectName)}</p>
            </header>
            {ended ? (
              <div className="ui-loan-status">
                <StatusDot>{statusPill(loan)}</StatusDot>
                {/* The סטטוס row below goes on the page too; this reopens the same sheet beside the pill. */}
                {holdWrites ? null : <TextLink size="label" tone="quiet" chevron={false} label="שינוי מצב" onClick={() => { open("status"); }}>שינוי</TextLink>}
              </div>
            ) : null}
            {flagged.length > 0 ? (
              <Banner
                icon={<AlertIcon size={20} />}
                title={flagged.length === 1 ? "תשלום אחד ממתין לבדיקה" : `${String(flagged.length)} תשלומים ממתינים לבדיקה`}
                hint={<bdi className="ui-num" dir="ltr">{formatDisplay(flagged[0]?.docDate ?? "")}</bdi>}
                to={`/transactions/${flagged[0]?.transactionId ?? ""}${search}`}
              />
            ) : null}
            {ended ? null : <LoanBalanceCard loan={loan} outlook={outlook} />}
            {outlook == null || ended ? null : <LoanNextCard loan={loan} outlook={outlook} />}
            <LoanRowsCard className="ui-loan-terms" rows={termRows} />
            {loan.rates.length > 0 ? (
              <LoanRateChangesCard rates={loan.rates} onOpen={holdWrites ? null : (rate) => { setRate(rate); open("rate"); }} />
            ) : null}
            <LoanYtdCard loan={loan} paid={paid} categories={categories} onOpenPart={holdWrites ? null : (item) => { setPart(item); open("part"); }} />
            <LoanRecentCard loan={loan} payments={payments} search={search} loanPath={loanPath} year={today.slice(0, 4)} />
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
            <LoanStatusSheet
              loan={loan}
              open={sheet === "status"}
              onOpenChange={setSheet}
              returnFocusRef={statusRef}
              lastPayment={lastPaid}
              defaultDate={closeDateDefault(loan, payments, today)}
              onSave={(next) => patchSave(next, statusToast(next.status, loan.balanceMinor, loan.currency), "status")}
            />
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
                if (!next && projectSaving != null) return;
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
            <ConfirmSheet
              open={sheet === "delete"}
              onOpenChange={(next) => {
                if (!next && deleting) return;
                setSheet(next);
              }}
              title="למחוק את ההלוואה?"
              item={loan.name}
              consequence={loanDeleteConsequence(payments.length)}
              confirmLabel="מחיקה"
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
      toast.show({ tone: "bad", message: typeof failure === "string" ? failure : failure.message });
      return;
    }
    // The payments count whole again under their own categories: every P&L read changes.
    await refresh(LOAN_WRITE_KEYS);
    // The list is the page under this one; replace keeps Back from landing on the deleted loan.
    void navigate(listBack, { replace: true });
    toast.show({
      message: loanDeletedToast(name),
      action: "ביטול",
      onAction: () => {
        void (async () => {
          try {
            await writes.restoreLoan(loanId);
            await refresh(LOAN_WRITE_KEYS);
            toast.show({ message: "ההלוואה חזרה" });
          } catch (raw) {
            const failure = loanFailure(raw instanceof Error ? raw : new Error("failed"), ctx);
            toast.show({ tone: "bad", message: typeof failure === "string" ? failure : failure.message });
          }
        })();
      },
    });
  }
}
