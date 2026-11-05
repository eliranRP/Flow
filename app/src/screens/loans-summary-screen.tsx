import "../ui/lazy.css";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getSupabase } from "../lib/supabase";
import { useHomePreview, usePreviewSearch } from "../preview";
import { useDashboardQuery } from "../use-books";
import { assertNoError } from "../use-write";
import { ViewerScope } from "../use-is-viewer";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { israelToday } from "../ui/date-math";
import { EmptyState } from "../ui/empty-state";
import { BackIcon, ChevronIcon, InfoIcon, PercentIcon, RefreshIcon } from "../ui/icons";
import { PartsBar } from "../ui/parts-bar";
import { SegmentedControl } from "../ui/segmented-control";
import { DelayedSkeleton } from "../ui/skeleton";
import { LoansSkeleton } from "../ui/screen-skeletons";
import { readLoanPayments, readLoanRow, type LoanPayment } from "./loan-detail-data";
import { useMemoryLoanStore, type MemoryLoanStore } from "./loan-detail-store";
import { LOAN_PART_BOARD_LABEL, wholeMoney } from "./loan-detail-view-data";
import { readCompanyLoanCurrency, type LoanCurrency } from "./loan-form";
import { readLoanList } from "./loan-list";
import { loansPaid, PAID_PARTS, paidMoney, type LoanPaidEntry, type PaidPeriod } from "./loans-paid";
import { Amount } from "../ui/amount";
import { BackButton, useGoBack } from "../ui/back";
import { CompactBar } from "../ui/compact-bar";
import { DockSlot, useDockedFilter } from "../ui/dock-filter";
import { FocusTitle } from "../ui/focus-title";
import { GroupHead } from "../ui/group-head";
import { IconButton } from "../ui/icon-button";
import { useScrolledPast } from "../ui/screen-header";
import { TopBand } from "../ui/top-band";

/**
 * `/loans/summary` (the board's Loans · summary): what was paid on the open loans and how much of
 * the debt is left, since the loans started or this year. The loans list's summary card links here;
 * a loan's row opens its page. Read only, so a viewer sees the same page.
 */

/** FLOW-1046: the band bar's height (6 + 52 + 6). */
const BAND_BAR = 64;

type SummaryRead =
  | { phase: "loading" }
  | { phase: "error"; retry: () => void; retrying: boolean }
  | { phase: "ready"; entries: LoanPaidEntry[]; currency: LoanCurrency };

/** The company's loans with each open loan's payments, read through the list's and the loan page's own queries (so each is read once). */
function useLiveEntries(companyId: string | null, active: boolean): SummaryRead {
  const currency = useQuery({
    queryKey: ["loan-currency", companyId],
    enabled: active && companyId != null,
    retry: false,
    queryFn: readCompanyLoanCurrency,
  });
  const list = useQuery({
    queryKey: ["loans", companyId, "list"],
    enabled: active && companyId != null,
    retry: false,
    queryFn: () => readLoanList(companyId),
  });
  const loans = (list.data?.loans ?? []).map(({ row, balance }) => readLoanRow(row, balance));
  const open = loans.filter((loan) => loan.status === "open" && loan.currency === currency.data);
  const payments = useQueries({
    queries: open.map((loan) => ({
      queryKey: ["loans", "payments", loan.id],
      enabled: active,
      retry: false,
      queryFn: async (): Promise<LoanPayment[]> => {
        const supabase = getSupabase();
        if (!supabase) throw new Error("supabase");
        const result = await supabase.rpc("mcp_loan_payments", { p_loan_id: loan.id });
        assertNoError(result);
        return readLoanPayments(result.data);
      },
    })),
  });
  const failed = currency.isError || list.isError || payments.some((query) => query.isError);
  if (failed) {
    return {
      phase: "error",
      retrying: currency.isFetching || list.isFetching || payments.some((query) => query.isFetching),
      retry: () => {
        void currency.refetch();
        void list.refetch();
        for (const query of payments) void query.refetch();
      },
    };
  }
  if (currency.data == null || list.data == null || payments.some((query) => query.data == null)) return { phase: "loading" };
  const byLoan = new Map(open.map((loan, index) => [loan.id, payments[index]?.data ?? []]));
  return {
    phase: "ready",
    currency: currency.data,
    entries: loans.map((loan) => ({ loan, payments: byLoan.get(loan.id) ?? [] })),
  };
}

/** A memory store's loans (stories, the dev route, `?preview=1`). */
function storeEntries(store: MemoryLoanStore): LoanPaidEntry[] {
  return store.rows().flatMap((row) => {
    const read = store.read(row.id);
    return read.phase === "ready" ? [{ loan: read.bundle.loan, payments: read.bundle.payments }] : [];
  });
}

export function LoansSummaryScreen({
  store: givenStore,
  currency: givenCurrency = "USD",
  listPath,
  today: givenToday,
  phase,
  period: initialPeriod = "all",
}: {
  /** Stories, tests and the dev route pass a memory store. Live omits it. */
  store?: MemoryLoanStore;
  /** A store's currency (live reads the company's). */
  currency?: LoanCurrency;
  /** Where Back goes. Default: the list this page sits under. */
  listPath?: string;
  /** Stories pin the day, so "this year" stays put. */
  today?: string;
  /** A story pins the page to loading or error. */
  phase?: "loading" | "error";
  /** The period the switch opens on (the dev route's ?period=year). Default: since the start. */
  period?: PaidPeriod;
} = {}) {
  const location = useLocation();
  const search = usePreviewSearch();
  const preview = useHomePreview();
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
  const dashboard = useDashboardQuery(isLive);
  const live = useLiveEntries(dashboard.data?.company_id ?? null, isLive);
  const listBase = location.pathname.replace(/\/summary\/?$/, "");
  const back = listPath ?? `${listBase}${search}`;
  const read: SummaryRead = phase === "loading" || preview === "loading"
    ? { phase: "loading" }
    : phase === "error" || preview === "error" || preview === "error-server"
      ? { phase: "error", retry: () => undefined, retrying: false }
      : store
        ? { phase: "ready", entries: storeEntries(store), currency: wantsPreview ? "ILS" : givenCurrency }
        : wantsPreview || dashboard.isLoading
          ? { phase: "loading" }
          : dashboard.isError
            ? { phase: "error", retry: () => { void dashboard.refetch(); }, retrying: dashboard.isFetching }
            : dashboard.data?.company_id == null ? { phase: "ready", entries: [], currency: "ILS" } : live;
  return (
    <ViewerScope>
      <LoansSummaryBody read={read} period={initialPeriod} back={back} loanHref={(id) => `${listBase}/${encodeURIComponent(id)}${search}`} today={givenToday ?? israelToday()} />
    </ViewerScope>
  );
}

/**
 * FLOW-1046 (V3-LoansSummary, the Overview pattern): the violet band with what was paid in the period, the debt at
 * the start and what is left; the period segment (since the start, or this year), which docks into the band bar;
 * what the payments were made of; then one row per loan with its bar.
 */
function LoansSummaryBody({ read, period: initialPeriod, back, loanHref, today }: { read: SummaryRead; period: PaidPeriod; back: string; loanHref: (id: string) => string; today: string }) {
  const navigate = useNavigate();
  const goBack = useGoBack();
  const [period, setPeriod] = useState<PaidPeriod>(initialPeriod);
  const [bandMark, setBandMark] = useState<HTMLElement | null>(null);
  const barShown = useScrolledPast(bandMark, true, BAND_BAR);
  const { markRef, docked, scrollUnderBar } = useDockedFilter({ barShown, bar: BAND_BAR });
  const year = today.slice(0, 4);
  const summary = read.phase === "ready" ? loansPaid(read.entries, read.currency, period, today) : null;
  const money = (minor: bigint) => (read.phase === "ready" ? wholeMoney(minor, read.currency) : "");
  const paid = (minor: bigint) => (read.phase === "ready" ? paidMoney(minor, read.currency) : "");
  const shown = summary == null ? [] : PAID_PARTS.filter(({ part }) => summary.totals[part] > 0n);
  const hasLoans = summary != null && summary.openCount > 0;
  const control = (onBand: boolean) => (
    <SegmentedControl<PaidPeriod>
      label="תקופה"
      showLabel={false}
      tone={onBand ? "band" : "page"}
      value={period}
      onChange={(next) => {
        setPeriod(next);
        scrollUnderBar();
      }}
      options={[{ value: "all", label: "מתחילת ההלוואות" }, { value: "year", label: year, numeric: true }]}
    />
  );
  return (
    <div className="ui-loans-sum-page">
      <TopBand
        wordmark={false}
        leading={<BackButton fallback={back} text="הלוואות" onBand />}
        hero={(
          <div className="ui-loans-band">
            <FocusTitle className="t-title">סיכום הלוואות</FocusTitle>
            {summary == null ? null : <p className="ui-loans-band-sub t-line2">{summary.sub}</p>}
            {hasLoans ? (
              <div className="ui-band-fade ui-loans-band-figures">
                <p className="ui-band-label t-line2">{summary.totalLabel}</p>
                <p className="ui-loans-band-figure"><Amount agorot={summary.totalMinor} currency={read.phase === "ready" ? read.currency : "ILS"} size="hero" compact /></p>
                <div className="ui-loans-band-rows">
                  <p className="ui-loans-band-row">
                    <span className="ui-loans-band-row-label">{summary.startLabel}</span>
                    <bdi dir="ltr">{money(summary.startMinor)}</bdi>
                  </p>
                  <p className="ui-loans-band-row">
                    <span className="ui-loans-band-row-label">נשאר לשלם היום</span>
                    <bdi dir="ltr">{money(summary.leftMinor)}</bdi>
                  </p>
                </div>
              </div>
            ) : null}
            <span ref={setBandMark} className="ui-compact-mark" aria-hidden="true" />
          </div>
        )}
      />
      <CompactBar
        title="סיכום הלוואות"
        shown={barShown}
        tone="band"
        start={(
          <IconButton label="חזרה" onBand onClick={() => { goBack(back); }}>
            <BackIcon />
          </IconButton>
        )}
        centre={(
          <span className="ui-compact-bar-centre">
            <span className="ui-compact-bar-centre-title">{summary == null ? "סיכום הלוואות" : `סיכום · ${summary.totalLabel}`}</span>
            <span className="ui-compact-bar-centre-net"><bdi dir="ltr">{summary == null ? "" : paid(summary.totalMinor)}</bdi></span>
          </span>
        )}
        end={<span className="ui-loans-bar-slot" aria-hidden="true" />}
        dock={hasLoans ? control(true) : undefined}
        docked={docked}
      />
      <div className="ui-loans-body">
        {read.phase === "loading" ? (
          <DelayedSkeleton>
            <LoansSkeleton />
          </DelayedSkeleton>
        ) : read.phase === "error" ? (
          <EmptyState
            icon={<InfoIcon size={36} />}
            title="לא הצלחנו לטעון את הסיכום"
            body="נסו שוב בעוד רגע"
            action={(
              <Button variant="secondary" icon={<RefreshIcon />} busy={read.retrying} onClick={read.retry}>
                ניסיון חוזר
              </Button>
            )}
          />
        ) : !hasLoans ? (
          <EmptyState
            icon={<PercentIcon />}
            title="אין הלוואות פעילות"
            body="כשתהיה הלוואה פעילה, כאן יופיע כמה שולם וכמה נשאר."
            action={<Button variant="secondary" to={back}>לרשימת ההלוואות</Button>}
          />
        ) : (
          <>
            <span ref={markRef} className="ui-compact-mark" aria-hidden="true" />
            <DockSlot docked={docked}>{control(false)}</DockSlot>
            <Card as="section" className="ui-loan-summary ui-loans-sum-paid" aria-label="שולם">
              <p className="ui-loan-summary-label">ממה הורכבו התשלומים</p>
              {shown.length === 0 ? null : (
                <PartsBar
                  parts={shown.map(({ part, tone }) => ({ key: part, value: summary.totals[part], tone }))}
                  label={summary.totalLabel}
                  height={8}
                  gap={2}
                  radius="block"
                  legend={shown.map(({ part }) => ({ key: part, label: LOAN_PART_BOARD_LABEL[part], value: <bdi dir="ltr">{paid(summary.totals[part])}</bdi> }))}
                />
              )}
              <p className="ui-loans-sum-note">{summary.note}</p>
            </Card>
            <section className="ui-month ui-loans-group" aria-labelledby="loans-sum-per-loan">
              <GroupHead id="loans-sum-per-loan" title="לפי הלוואה" summary={`${String(summary.loans.length)} · ${paid(summary.totalMinor)}`} />
              <ul className="ui-loans-list">
                {summary.loans.map((loan) => (
                  <li key={loan.id}>
                    <button
                      type="button"
                      className="ui-loans-row ui-loans-sum-row m-press"
                      onClick={() => { void navigate(loanHref(loan.id)); }}
                      aria-label={[loan.name, paid(loan.paidMinor), loan.meta].join(", ")}
                    >
                      <span className="ui-loans-text">
                        <span className="ui-loans-sum-top">
                          <span className="ui-loans-name">{loan.name}</span>
                          <bdi className="ui-loans-amount" dir="ltr">{paid(loan.paidMinor)}</bdi>
                        </span>
                        <span className="ui-loans-sum-bar" aria-hidden="true">
                          <span style={{ inlineSize: `${String(Math.max(2, loan.percent))}%` }} />
                        </span>
                        <span className="ui-loans-meta">{loan.meta}</span>
                      </span>
                      <span className="ui-loan-term-chevron" aria-hidden="true"><ChevronIcon size={18} /></span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            {summary.closed == null ? null : (
              <div className="ui-loans-sum-closed">
                <span className="ui-loans-sum-closed-title">{summary.closed.title}</span>
                <span className="ui-loans-sum-closed-note">{summary.closed.note}</span>
              </div>
            )}
            <p className="ui-loans-sum-foot">הסכום ששולם בכל הלוואה כולל קרן, ריבית ונאמנות. ההתקדמות היא כמה מהקרן נפרע.</p>
          </>
        )}
      </div>
    </div>
  );
}
