import "../ui/lazy.css";
import { formatAmountText, type ProfitMonth, type ProfitMonths, type ProjectDetail } from "@flow/shared";
import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { absAgorot } from "../agorot";
import { useCompanyCurrency } from "../company-currency";
import { projectExpenseMinor, projectRows } from "../by-currency";
import { profitMonthFigures } from "../next-month-chart";
import { allTime, monthPeriod, shiftMonthKey } from "../period";
import { useHomePreview, usePreviewSearch } from "../preview";
import { useProjectsCashMonth } from "../project-cash";
import { resolveProjectKind } from "../project-list";
import { type NextMonthSample } from "../project-next-month-query";
import { useProjectNextMonth } from "../next-month-for-project";
import { withPeriodSearch } from "../project-period";
import { screenPhase } from "../query-phase";
import { useProfitMonthsQuery, useProjectQuery } from "../use-books";
import { Amount } from "../ui/amount";
import { BackButton } from "../ui/back";
import { BandLoadFailed, BandOfflineLine, useOnline } from "../ui/band-states";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { CompactBar } from "../ui/compact-bar";
import { DockSlot, useDockedFilter } from "../ui/dock-filter";
import { EmptyState, FailureLine } from "../ui/empty-state";
import { FocusTitle } from "../ui/focus-title";
import { GroupHead } from "../ui/group-head";
import { HEBREW_MONTHS } from "../ui/date-math";
import { BarsIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { ScreenHeader, useScrolledPast } from "../ui/screen-header";
import { ProfitRowsSkeleton } from "../ui/screen-skeletons";
import { SegmentedControl } from "../ui/segmented-control";
import { DelayedSkeleton, Skeleton } from "../ui/skeleton";
import { TopBand } from "../ui/top-band";
import { NextMonthBlock } from "./next-month-block";
import { SummaryRow } from "./profit-summary";

export type ProjectProfitSample = {
  project: NonNullable<ProjectDetail>;
  months: NonNullable<ProfitMonths>;
  next?: NextMonthSample;
  offlineSince?: number;
  /** FLOW-1044: the project's type word, as its row on the list carries it (the kind reads it). */
  type?: string | null;
};

/** The Home-style band bar: 6 + 52 + 6 (BUILD-PLAN §3.1). */
const BAND_BAR = 64;

type Order = "month" | "category";

const ORDERS: { value: Order; label: string }[] = [
  { value: "month", label: "לפי חודש" },
  { value: "category", label: "לפי קטגוריה" },
];

const NOTE = "ההוצאות הכלליות מתחלקות בין הפרויקטים לפי ההכנסות שלהם. ככה רואים אם הנכס באמת מרוויח.";
/** Board V3-ProjectProfit-Flip: a renovation's one line. */
const RENOVATION_NOTE = "השיפוץ לא נספר ברווח. הוא חלק מעלות הנכס, והרווח ממנו יופיע במכירה (השקעה והלוואות).";

function monthWord(key: string): string {
  return HEBREW_MONTHS[Number(key.slice(5, 7)) - 1] ?? key;
}

/** A month's name; a month in another year than the newest one adds its year. */
function monthName(key: string, newestYear: string): string {
  const year = key.slice(0, 4);
  return year === newestYear ? monthWord(key) : `${monthWord(key)} ${year}`;
}

function countWord(count: number): string {
  return count === 1 ? "חודש אחד" : `${String(count)} חודשים`;
}

/** An expense category's total since the start, in the row's currency, largest first (categories are positive). */
type CategoryTotal = { id: string | null; name: string; amount: bigint };

function categoryTotals(project: NonNullable<ProjectDetail>, currency: string): CategoryTotal[] {
  const rows: CategoryTotal[] = project.categories_by_currency
    ? project.categories_by_currency
      .filter((category) => category.currency === currency)
      .map((category) => ({ id: category.id, name: category.name ?? "", amount: absAgorot(category.amount_minor) }))
    : currency === (project.base_currency ?? "ILS")
      ? project.categories.map((category) => ({ id: category.id, name: category.name ?? "", amount: absAgorot(category.amount_agorot) }))
      : [];
  return rows.filter((row) => row.amount !== 0n).sort((a, b) => (a.amount === b.amount ? 0 : a.amount > b.amount ? -1 : 1));
}

/** The category page's query: the preview flag, and the currency when it is not shekels. */
function categoryQuery(currency: string, search: string): string {
  if (currency === "ILS") return search;
  return `${search}${search === "" ? "?" : "&"}currency=${encodeURIComponent(currency)}`;
}

/**
 * The project's profit page (FLOW-140). FLOW-1044 (boards V3-ProjectProfit, -Flip, -Client): an Overview. The
 * band is the profit since the start with the income and the counted expenses under it; the card under the band
 * takes off the share of the general expenses; a renovation says in one line that its renovation is not in the
 * monthly profit. Then לפי חודש / לפי קטגוריה, which docks into the band bar, and the groups with sticky heads.
 * The figures are the project's first currency's.
 */
export function ProjectProfitScreen({ sample }: { sample?: ProjectProfitSample } = {}) {
  const { projectId = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const search = usePreviewSearch();
  const preview = useHomePreview();
  const companyCurrency = useCompanyCurrency();
  const online = useOnline();
  const whole = allTime();
  const detail = useProjectQuery(sample ? "" : projectId, whole);
  const months = useProfitMonthsQuery(sample ? "" : projectId, whole);
  // The type word is on the project's row of the month (the list's cached read).
  const monthRow = useProjectsCashMonth(undefined, sample ? "" : projectId).data?.projects.find((row) => row.id === projectId);
  const project = sample?.project ?? detail.data ?? null;
  const data = sample?.months ?? months.data ?? null;
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, detail);
  const rows = data?.months ?? [];
  const id = sample ? sample.project.id : projectId;
  const row = project == null ? null : projectRows(project, companyCurrency)[0] ?? null;
  const currency = row?.currency ?? companyCurrency;
  // The after-overhead rows show only where the project has a share in this currency: its income sets the weights (0117).
  const share = project?.overhead_weighted === true && (project.base_currency ?? "ILS") === currency
    ? project.overhead_share_minor ?? null
    : null;
  const nextMonth = useProjectNextMonth(id, currency, sample?.next, sample == null);
  // FLOW-1002: the card is in the forecast's currency; months in another currency are not set beside it.
  const sameCurrency = nextMonth.currency === currency;
  const live = sample == null;
  const monthsLoading = live && months.isLoading;
  const monthsFailed = live && months.isError;
  const cardLoading = live && nextMonth.pending && !nextMonth.paused && !nextMonth.failed;
  const profit = row?.profit_minor ?? 0n;
  const after = share == null ? null : profit - share;
  const newestYear = rows[0]?.month.slice(0, 4) ?? "";
  const oldest = rows[rows.length - 1]?.month;
  const fromProfit = new URLSearchParams(location.search).get("from") === "profit";
  // FLOW-969: offline, the page keeps its last read and says which moment it is from.
  const offlineSince = sample != null ? (sample.offlineSince ?? null) : !online && preview === "off" ? (detail.dataUpdatedAt || null) : null;
  const backTo = fromProfit ? `/profit${search}` : `/projects/${id}${search}`;
  const backText = fromProfit ? "רווח" : project?.name ?? "הפרויקט";
  // The order lives in the URL (`by=category`), so Back from a category row restores it.
  const by: Order = new URLSearchParams(location.search).get("by") === "category" ? "category" : "month";
  const [bandMark, setBandMark] = useState<HTMLSpanElement | null>(null);
  const barShown = useScrolledPast(bandMark, true, 0);
  const { markRef, docked, scrollUnderBar } = useDockedFilter({ barShown, bar: BAND_BAR });
  const setBy = (next: Order) => {
    const params = new URLSearchParams(location.search);
    if (next === "month") params.delete("by");
    else params.set("by", next);
    const query = params.toString();
    void navigate({ pathname: location.pathname, search: query === "" ? "" : `?${query}` }, { replace: true });
    scrollUnderBar();
  };
  const back = <BackButton fallback={backTo} text={backText} onBand />;
  if (phase.kind === "error") {
    return (
      <BandLoadFailed
        title={project == null ? "הרווח לא נטען" : `הרווח של ${project.name} לא נטען`}
        offline={phase.offline || !online}
        leading={back}
        onRetry={() => { void detail.refetch(); }}
      />
    );
  }
  if (phase.kind === "loading" || project == null || phase.kind === "empty") {
    return (
      <div className="ui-project-page ui-pp-page flex min-h-full flex-1 flex-col" aria-busy="true">
        <p className="sr-only" role="status">טוען…</p>
        <TopBand
          wordmark={false}
          leading={back}
          heroClassName="ui-band-hero-project"
          hero={(
            <div className="ui-project-skel">
              <Skeleton tone="band" className="ui-skel-project-label" />
              <Skeleton tone="band" className="ui-skel-project-num" />
            </div>
          )}
        />
        <ProfitRowsSkeleton />
      </div>
    );
  }
  // The board's empty frame (States profitEmpty): a project with no income or expense yet has nothing to add up.
  if (rows.length === 0 && !monthsLoading && (row == null || (row.income_minor === 0n && projectExpenseMinor(row) === 0n))) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ScreenHeader title={`רווח · ${project.name}`} subtitle="מתחילת הפרויקט" backTo={backTo} className="ui-state-header" />
        <div className="ui-state-empty flex min-h-0 flex-1 flex-col">
          <EmptyState
            icon={<BarsIcon />}
            title="עוד אין מה לחשב"
            body={`כשתשייכו ל־${project.name} הכנסה או הוצאה, הרווח שלו יופיע כאן.`}
            action={<Button variant="secondary" href={`/projects/unassigned${search}`}>לשורות בלי פרויקט</Button>}
          />
        </div>
      </div>
    );
  }
  const kind = resolveProjectKind({
    overhead: project.is_overhead === true,
    type: sample?.type ?? monthRow?.type ?? null,
    budget: project.budget_agorot != null,
    arv: project.investment?.arv_minor != null,
    value: project.investment?.value_minor != null,
  });
  const categories = categoryTotals(project, currency);
  const expenses = row == null ? 0n : projectExpenseMinor(row);
  const since = oldest == null ? "כל התקופה" : `מאז ${monthName(oldest, "")} · ${countWord(rows.length)}`;
  const control = (onBand: boolean) => (
    <SegmentedControl label="פירוק" showLabel={false} tone={onBand ? "band" : "page"} value={by} options={ORDERS} onChange={setBy} />
  );
  return (
    <div className="ui-project-page ui-pp-page flex min-h-full flex-1 flex-col">
      <TopBand
        wordmark={false}
        leading={back}
        heroClassName="ui-band-hero-project"
        hero={(
          <>
            <FocusTitle className="t-title">רווח מתחילת הפרויקט</FocusTitle>
            <p className="t-line2">{since}</p>
            {offlineSince == null ? null : <BandOfflineLine since={offlineSince} />}
            <p className="ui-band-label t-line2">{share == null ? "רווח" : "רווח לפני הוצאות כלליות"}</p>
            <div className="ui-project-profits t-detail">
              <p>
                <Amount agorot={profit} currency={currency} loss={profit < 0n} size="hero" compact />
              </p>
            </div>
            {row == null ? null : (
              <div className="ui-project-band-pair">
                <span className="ui-band-row-link">
                  <span className="ui-band-row-label">הכנסות</span>
                  <span className="ui-band-row-amount"><Amount agorot={row.income_minor} currency={currency} presentation="detail" size="list" /></span>
                </span>
                <span className="ui-band-row-link">
                  <span className="ui-band-row-label">הוצאות</span>
                  <span className="ui-band-row-amount"><Amount agorot={expenses} currency={currency} presentation="detail" size="list" /></span>
                </span>
              </div>
            )}
            <span ref={setBandMark} className="ui-compact-mark" aria-hidden="true" />
          </>
        )}
      />
      <CompactBar
        title="רווח מתחילת הפרויקט"
        tone="band"
        shown={barShown}
        centre={(
          <span className="ui-compact-bar-centre">
            <span className="ui-compact-bar-centre-title">{`רווח · ${project.name}`}</span>
            <span className="ui-compact-bar-centre-net"><bdi dir="ltr">{formatAmountText(profit, currency)}</bdi></span>
          </span>
        )}
        dock={control(true)}
        docked={docked}
      />
      <div className="ui-project-stack">
        {share == null || after == null ? null : (
          <Card className="ui-pp-card">
            <SummaryRow label="רווח לפני הוצאות כלליות" value={<Amount agorot={profit} currency={currency} loss={profit < 0n} />} />
            <SummaryRow label="חלק בהוצאות הכלליות" value={<Amount agorot={-share} currency={currency} loss />} />
            <SummaryRow strong label="רווח אחרי הוצאות כלליות" value={<Amount agorot={after} currency={currency} loss={after < 0n} />} />
          </Card>
        )}
        {share == null ? null : <p className="ui-pp-note t-caption t-muted">{NOTE}</p>}
        {kind === "renovation" ? <p className="ui-pp-note t-caption t-muted">{RENOVATION_NOTE}</p> : null}
      </div>
      <span ref={markRef} className="ui-compact-mark" aria-hidden="true" />
      <div className="ui-page-pad ui-pp-order">
        <DockSlot docked={docked}>{control(false)}</DockSlot>
      </div>
      {by === "category" ? (
        <>
          <section className="ui-month" aria-labelledby="pp-income">
            <GroupHead id="pp-income" title="הכנסות" summary={<bdi dir="ltr">{formatAmountText(row?.income_minor ?? 0n, currency)}</bdi>} />
            <List>
              <ListRow variant="project" title="הכנסות" hint="כל ההכנסות מתחילת הפרויקט" agorot={row?.income_minor ?? 0n} currency={currency} amountDirection="income" />
            </List>
          </section>
          <section className="ui-month" aria-labelledby="pp-expenses">
            <GroupHead id="pp-expenses" title="הוצאות" summary={<><bdi dir="ltr">{String(categories.length)}</bdi> · <bdi dir="ltr">{formatAmountText(expenses, currency)}</bdi></>} />
            <List>
              {categories.map((category) => {
                const total = categories.reduce((sum, item) => sum + item.amount, 0n);
                const percent = total === 0n ? 0 : Math.round((Number(category.amount) * 100) / Number(total));
                return (
                  <ListRow
                    key={category.id ?? category.name}
                    variant="project"
                    title={category.name}
                    hint={<><bdi dir="ltr">{`${String(percent)}%`}</bdi> מההוצאות</>}
                    agorot={category.amount}
                    currency={currency}
                    href={category.id == null ? undefined : `/projects/${id}/categories/${category.id}${categoryQuery(currency, search)}`}
                  />
                );
              })}
            </List>
          </section>
        </>
      ) : (
        <section className="ui-month" aria-labelledby="pp-months">
          <GroupHead id="pp-months" title="לפי חודש" summary={<><bdi dir="ltr">{String(rows.length)}</bdi> · <bdi dir="ltr">{formatAmountText(profit, currency, { plus: profit > 0n, direction: profit > 0n ? "income" : undefined })}</bdi></>} />
          <div className="ui-pp-next">
            <NextMonthBlock
              forecast={nextMonth.forecast}
              // The card waits for the months too, so its expense caption never shows the count first.
              loading={cardLoading || monthsLoading}
              current={monthsLoading || monthsFailed || !sameCurrency ? null : shiftMonthKey(nextMonth.month, -1)}
              figures={profitMonthFigures(rows, currency)}
              firstMonth={oldest ?? null}
              currency={nextMonth.currency}
              kind="profit"
              takeaway
              cardHref={`/projects/${id}/profit/next${search}`}
              categories={nextMonth.categories}
              today={nextMonth.today}
            />
          </div>
          {monthsFailed ? (
            <FailureLine offline={!navigator.onLine} onRetry={() => { void months.refetch(); }} />
          ) : monthsLoading ? (
            <DelayedSkeleton><ProfitRowsSkeleton /></DelayedSkeleton>
          ) : (
            <List className="ui-pp-months">
              {rows.map((month) => (
                <MonthLine
                  key={month.month}
                  month={month}
                  title={monthName(month.month, newestYear)}
                  currency={currency}
                  href={`/projects/${id}/profit/${month.month}${withPeriodSearch(search, monthPeriod(month.month))}`}
                />
              ))}
            </List>
          )}
        </section>
      )}
    </div>
  );
}

function MonthLine({ month, title, currency, href }: { month: ProfitMonth; title: string; currency: string; href: string }) {
  const figures = month.by_currency.find((figure) => figure.currency === currency)
    ?? { currency, income_minor: 0n, expense_minor: 0n, profit_minor: 0n };
  const expense = figures.expense_minor < 0n ? -figures.expense_minor : figures.expense_minor;
  const loss = figures.profit_minor < 0n;
  return (
    <ListRow
      variant="project"
      title={month.open ? `${title} · עד היום` : title}
      hintParts={[`הכנסות ${formatAmountText(figures.income_minor, currency)} · הוצאות ${formatAmountText(expense, currency)}`]}
      label={`${title}, ${loss ? "הפסד" : "רווח"} ${formatAmountText(figures.profit_minor, currency)}`}
      agorot={figures.profit_minor}
      currency={currency}
      loss={loss}
      amountPlus
      href={href}
    />
  );
}
