import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { LoanSplitPart } from "@flow/shared";
import { useSheetHistory } from "../ui/back";
import { Banner } from "../ui/banner";
import { BigNumber } from "../ui/big-number";
import { Button } from "../ui/button";
import { StatusPill } from "../ui/chip";
import { ConfirmSheet } from "../ui/confirm-sheet";
import { formatDisplay, israelToday } from "../ui/date-math";
import { EmptyState } from "../ui/empty-state";
import { AlertIcon, BankIcon, CalendarIcon, HomeIcon, InfoIcon, LoanIcon, PercentIcon, ProjectsIcon, RefreshIcon, TagIcon, TrashIcon } from "../ui/icons";
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
  LOAN_PART_LABEL,
  LOAN_STATUS_LABEL,
  loanDeleteConsequence,
  loanDeletedToast,
  loanFailure,
  loanRefusalOf,
  loanRefusalPlace,
  type LoanCopyContext,
  type LoanRefusalPlace,
} from "./loan-copy";
import {
  LOAN_PAYMENTS_SHOWN,
  closeDateDefault,
  demandInterestToday,
  formatRatePpm,
  kindValue,
  lastPaymentDate,
  loanParts,
  partCategoryValue,
  paymentHint,
  paymentValue,
  rateInForce,
  statusPill,
  statusToast,
  type LoanRateRow,
} from "./loan-detail-data";
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
import { formatLoanMoney } from "./loan-form";
import { LoanBalance, showsLoanBalance } from "./loan-list";
import { LOAN_WRITE_KEYS } from "./loan-match-api";
import { LoanProjectPicker, NO_PROJECT, type LoanProjectSource } from "./loan-project-picker";

/**
 * FLOW-106 B and FLOW-110: `/settings/loans/:loanId`, one loan's page (template A with the tab
 * bar). The balance with its status, then פרטים, שינויי ריבית, קטגוריות לחלקים and תשלומים;
 * each row opens a small sheet that saves alone, with its own refusal and undo (0075). The
 * owner deletes the loan at the bottom (decision 0142); a viewer reads static rows.
 */

export const LOAN_ERROR_TITLE = "לא הצלחנו לטעון את ההלוואה";
export const LOAN_MISSING_TITLE = "ההלוואה לא נמצאה";

type SheetName = "kind" | "rate" | "status" | "part" | "project" | "delete";

const PART_ICON: Record<LoanSplitPart, () => ReactElement> = {
  interest: () => <PercentIcon />,
  escrow: () => <HomeIcon />,
  principal: () => <BankIcon />,
  fees: () => <TagIcon />,
};

export function LoanDetailScreen({
  store: givenStore,
  listPath,
  today: givenToday,
}: {
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
  const back = listPath ?? `${location.pathname.replace(/\/[^/]*\/?$/, "")}${search}`;
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
        <ScreenHeader title="הלוואה" kicker="הלוואות" backTo={back} />
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
        <ScreenHeader title="הלוואה" kicker="הלוואות" backTo={back} />
        <EmptyState
          icon={<LoanIcon />}
          title={LOAN_MISSING_TITLE}
          body="ייתכן שנמחקה או שייכת לעסק אחר."
          action={<Button variant="pill" to={back}>לרשימת ההלוואות</Button>}
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
        {["a", "b", "c", "d", "e", "f"].map((key) => <ListRow key={key} variant="skeleton" />)}
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
  today,
  search,
}: {
  bundle: LoanBundle;
  writes: LoanWrites;
  liveKeys: boolean;
  projects: LoanProjectSource;
  back: string;
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
  const shownRates = loan.rates;
  const flagged = payments.filter((item) => item.needsReview);
  const payment = paymentValue(loan, today);
  const accrued = demandInterestToday(loan, payments, today);
  const lastPaid = lastPaymentDate(payments);
  const [allPayments, setAllPayments] = useState(false);
  const listed = allPayments ? payments : payments.slice(0, LOAN_PAYMENTS_SHOWN);
  const parts = loanParts(loan);
  // FLOW-138 "Hide" (FLOW-356): a paid-off loan leads with "נפרעה · date" alone, as on the list.
  const ended = !showsLoanBalance(loan);

  function row(key: string, label: string, value: ReactNode, icon: ReactElement, onOpen: (() => void) | null, hint?: string) {
    return holdWrites || onOpen == null ? (
      <ListRow key={key} variant="static" eyebrow={label} title={value} icon={icon} hint={hint} />
    ) : (
      <ListRow key={key} variant="button" eyebrow={label} title={value} icon={icon} hint={hint} chevron onClick={onOpen} />
    );
  }

  return (
    <ViewerScope>
      <div className="ui-loan-page">
        <ScreenHeader title={loan.name} kicker="הלוואות" backTo={back} />
        <ViewerNote />
        <div className="ui-page-pad ui-loan-head">
          {ended ? null : (
            <p className="t-display">
              <BigNumber agorot={loan.balanceMinor} presentation="detail" cents="always" currency={loan.currency} size="display" />
            </p>
          )}
          <div className="ui-status-row">
            <StatusPill>{statusPill(loan)}</StatusPill>
            {ended ? (
              // The מצב row goes, so the status changes from here (reopening a loan stays one tap away).
              holdWrites ? null : (
                <TextLink size="label" tone="quiet" chevron={false} label="שינוי מצב" onClick={() => { open("status"); }}>שינוי</TextLink>
              )
            ) : (
              <span className="t-hint">{loan.kind === "demand" ? "יתרת קרן" : "יתרה"}</span>
            )}
          </div>
        </div>
        {flagged.length > 0 ? (
          <div className="ui-page-pad">
            <Banner
              icon={<AlertIcon size={20} />}
              title={flagged.length === 1 ? "תשלום אחד ממתין לבדיקה" : `${String(flagged.length)} תשלומים ממתינים לבדיקה`}
              hint={<bdi className="ui-num" dir="ltr">{formatDisplay(flagged[0]?.docDate ?? "")}</bdi>}
              to={`/transactions/${flagged[0]?.transactionId ?? ""}${search}`}
            />
          </div>
        ) : null}

        <SectionHead title="פרטים" />
        <List>
          {row("kind", "סוג", kindValue(loan), <LoanIcon />, () => { open("kind"); })}
          {row("rate", "ריבית", <RateValue loan={loan} today={today} />, <PercentIcon />, () => { setRate(null); open("rate"); })}
          {payment == null || ended ? null : row("payment", "תשלום חודשי", payment, <CalendarIcon />, null)}
          {row("project", "פרויקט", projectName ?? NO_PROJECT, <ProjectsIcon />, () => { open("project"); })}
          {ended ? null : row("status", "מצב", LOAN_STATUS_LABEL[loan.status], <InfoIcon size={24} />, () => { open("status"); })}
        </List>

        {/* No rate rows yet: the ריבית row above opens קביעת ריבית, so the section waits (mockup B6). */}
        {shownRates.length > 0 ? (
          <>
            <SectionHead title="שינויי ריבית" />
            <List>
              {shownRates.map((item) => (
                holdWrites ? (
                  <ListRow key={item.id} variant="static" title={<bdi className="ui-num" dir="ltr">{formatDisplay(item.effectiveDate)}</bdi>} meta={<bdi className="ui-num t-amount" dir="ltr">{formatRatePpm(item.annualRatePpm)}</bdi>} />
                ) : (
                  <ListRow
                    key={item.id}
                    variant="button"
                    title={<bdi className="ui-num" dir="ltr">{formatDisplay(item.effectiveDate)}</bdi>}
                    label={`שינוי ריבית מ־${formatDisplay(item.effectiveDate)}, ${formatRatePpm(item.annualRatePpm)}`}
                    meta={<bdi className="ui-num t-amount" dir="ltr">{formatRatePpm(item.annualRatePpm)}</bdi>}
                    chevron
                    onClick={() => { setRate(item); open("rate"); }}
                  />
                )
              ))}
              <ListRow
                variant="static"
                title={<>מההתחלה · <bdi className="ui-num" dir="ltr">{formatDisplay(loan.startDate)}</bdi></>}
                meta={<bdi className="ui-num t-amount" dir="ltr">{formatRatePpm(loan.annualRatePpm)}</bdi>}
                tone="muted"
              />
            </List>
            {holdWrites ? null : (
              <div className="ui-page-pad ui-loan-link">
                <TextLink chevron={false} onClick={() => { setRate(null); open("rate"); }}>+ קביעת ריבית</TextLink>
              </div>
            )}
          </>
        ) : null}

        <SectionHead title="קטגוריות לחלקים" />
        <List>
          {parts.map((item) => row(item, LOAN_PART_LABEL[item], partCategoryValue(loan, categories, item), PART_ICON[item](), () => { setPart(item); open("part"); }))}
        </List>

        <SectionHead title="תשלומים">
          {accrued != null ? (
            <span className="t-hint">ריבית צבורה היום <bdi className="ui-num" dir="ltr">{formatLoanMoney(accrued, loan.currency)}</bdi></span>
          ) : null}
        </SectionHead>
        {payments.length === 0 ? (
          <p className="ui-page-pad t-hint">אין עדיין תשלומים משויכים.</p>
        ) : (
          <List>
            {listed.map((item) => (
              <ListRow
                key={item.transactionId}
                variant="item"
                href={`/transactions/${item.transactionId}${search}`}
                title={<bdi className="ui-num" dir="ltr">{formatDisplay(item.docDate)}</bdi>}
                label={`תשלום ${formatDisplay(item.docDate)}, ${formatLoanMoney(item.totalMinor, loan.currency)}${item.needsReview ? ", ממתין לבדיקה" : ""}`}
                hint={item.needsReview ? "ממתין לבדיקה" : paymentHint(item, loan)}
                tone={item.needsReview ? "warning" : undefined}
                meta={<LoanBalance minor={item.totalMinor} currency={loan.currency} className="t-amount" />}
                chevron
              />
            ))}
          </List>
        )}
        {payments.length > LOAN_PAYMENTS_SHOWN ? (
          <div className="ui-page-pad ui-loan-link">
            <TextLink chevron={false} expanded={allPayments} onClick={() => { setAllPayments((value) => !value); }}>
              {allPayments ? "פחות תשלומים" : <>כל התשלומים (<bdi className="ui-num">{String(payments.length)}</bdi>)</>}
            </TextLink>
          </div>
        ) : null}

        {holdWrites ? null : (
          <List className="ui-loan-delete">
            <ListRow variant="danger" title="מחיקת ההלוואה" icon={<TrashIcon />} onClick={() => { open("delete"); }} />
          </List>
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
              returnFocusRef={returnRef}
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
      </div>
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
    void navigate(back, { replace: true });
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

/** "11.25% · מ־01/09/2026", the date kept left to right, or "6% · מההתחלה". */
function RateValue({ loan, today }: { loan: Pick<LoanBundle["loan"], "annualRatePpm" | "rates">; today: string }) {
  const { ppm, from } = rateInForce(loan, today);
  return (
    <>
      <bdi className="ui-num" dir="ltr">{formatRatePpm(ppm)}</bdi>
      {from == null ? " · מההתחלה" : <> · מ־<bdi className="ui-num" dir="ltr">{formatDisplay(from)}</bdi></>}
    </>
  );
}
