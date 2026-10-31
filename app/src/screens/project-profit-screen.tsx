import "../ui/lazy.css";
import { formatAmountText, type ProfitMonth, type ProfitMonths, type ProjectDetail } from "@flow/shared";
import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { absAgorot } from "../agorot";
import { useCompanyCurrency } from "../company-currency";
import { projectExpenseMinor, projectRows } from "../by-currency";
import { profitMonthFigures } from "../next-month-chart";
import { allTime, monthPeriod, shiftMonthKey } from "../period";
import { useHomePreview, usePreviewSearch } from "../preview";
import { type NextMonthSample } from "../project-next-month-query";
import { useProjectNextMonth } from "../next-month-for-project";
import { withPeriodSearch } from "../project-period";
import { screenPhase } from "../query-phase";
import { EMPTY_FILTERS, searchFiltersQuery } from "../search";
import { useProfitMonthsQuery, useProjectQuery } from "../use-books";
import { Amount } from "../ui/amount";
import { BandOfflineLine, PageLoadFailed, useOnline } from "../ui/band-states";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { EmptyState, FailureLine } from "../ui/empty-state";
import { OrderChips } from "../ui/order-chips";
import { HEBREW_MONTHS } from "../ui/date-math";
import { BarsIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { ProfitRowsSkeleton, ProfitSkeleton } from "../ui/screen-skeletons";
import { DelayedSkeleton } from "../ui/skeleton";
import { ScreenState } from "../ui/screen-state";
import { NextMonthBlock } from "./next-month-block";
import { SummaryRow } from "./profit-summary";

export type ProjectProfitSample = { project: NonNullable<ProjectDetail>; months: NonNullable<ProfitMonths>; next?: NextMonthSample; offlineSince?: number };

const PROJECT_ORDERS = [
  { value: "month", label: "לפי חודש" },
  { value: "category", label: "לפי קטגוריה" },
] as const;

const NOTE = "ההוצאות הכלליות מתחלקות בין הפרויקטים לפי ההכנסות שלהם. ככה רואים אם הנכס באמת מרוויח.";

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

/**
 * The project's profit page (FLOW-140, slice 1, ProfitProject frame): the profit since the project's first
 * month, a four-row card (income, counted expenses, the project's share of general expenses, and the profit
 * after them), then one row per month, newest first. The by-category bar and the month page come in later slices.
 * The figures are the company currency's; a project with other currencies shows that one only for now.
 */
export function ProjectProfitScreen({ sample }: { sample?: ProjectProfitSample } = {}) {
  const { projectId = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const search = usePreviewSearch();
  const preview = useHomePreview();
  const companyCurrency = useCompanyCurrency();
  const online = useOnline();
  // The figure ends the page's head: the compact bar waits for it (FLOW-942).
  const [figure, setFigure] = useState<HTMLElement | null>(null);
  const whole = allTime();
  const detail = useProjectQuery(sample ? "" : projectId, whole);
  const months = useProfitMonthsQuery(sample ? "" : projectId, whole);
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
  // FLOW-1002: the card is in the forecast's currency, the company's on the overhead project's page. When the
  // project's own months are in another currency they are not set beside it: the card shows no history and no
  // chart, rather than a "מול ₪0". The month list below stays in the project's currency.
  const sameCurrency = nextMonth.currency === currency;
  // The figure comes with the project; the month rows and the next-month card load after it, each on its own,
  // so each slot shows its skeleton meanwhile and loaded rows never wait for the forecast. A read paused offline
  // stays pending, so the card's skeleton shows only while its reads are really loading.
  const live = sample == null;
  const monthsLoading = live && months.isLoading;
  const monthsFailed = live && months.isError;
  const cardLoading = live && nextMonth.pending && !nextMonth.paused && !nextMonth.failed;
  const profit = row?.profit_minor ?? 0n;
  const after = share == null ? null : profit - share;
  const newestYear = rows[0]?.month.slice(0, 4) ?? "";
  const oldest = rows[rows.length - 1]?.month;
  const sub = project == null
    ? undefined
    : oldest == null
      ? project.name
      : `${project.name} · מאז ${monthName(oldest, "")} · ${countWord(rows.length)}`;
  const fromProfit = new URLSearchParams(location.search).get("from") === "profit";
  // FLOW-969: offline, the page keeps its last read and says which moment it is from.
  const offlineSince = sample != null ? (sample.offlineSince ?? null) : !online && preview === "off" ? (detail.dataUpdatedAt || null) : null;
  const backTo = fromProfit ? `/profit${search}` : `/projects/${id}${search}`;
  // The chips live in the URL (`by=category`), so Back from a category row restores the order.
  const by = new URLSearchParams(location.search).get("by") === "category" ? "category" : "month";
  const categories = project == null ? [] : categoryTotals(project, currency);
  const setBy = (next: "month" | "category") => {
    const params = new URLSearchParams(location.search);
    if (next === "month") params.delete("by");
    else params.set("by", next);
    const query = params.toString();
    void navigate({ pathname: location.pathname, search: query === "" ? "" : `?${query}` }, { replace: true });
  };
  // The board's empty frame (States profitEmpty): a project with no income or expense yet has nothing to add up.
  if (project != null && phase.kind === "ready" && rows.length === 0 && (row == null || (row.income_minor === 0n && projectExpenseMinor(row) === 0n))) {
    return (
      <ScreenState
        title={`רווח · ${project.name}`}
        kicker={fromProfit ? "רווח" : project.name}
        stateSubtitle="מתחילת הפרויקט"
        backTo={backTo}
        headerClassName="ui-state-header"
        phase={{ kind: "empty" }}
        onRetry={() => { void detail.refetch(); }}
        empty={(
          <div className="ui-state-empty flex min-h-0 flex-1 flex-col">
            <EmptyState
              icon={<BarsIcon />}
              title="עוד אין מה לחשב"
              body={`כשתשייכו ל־${project.name} הכנסה או הוצאה, הרווח שלו יופיע כאן.`}
              action={<Button variant="secondary" href={`/search${searchFiltersQuery({ ...EMPTY_FILTERS, project: "none" }, new URLSearchParams(search))}`}>לשורות בלי פרויקט</Button>}
            />
          </div>
        )}
      />
    );
  }
  return (
    <ScreenState
      title="רווח"
      kicker={fromProfit ? "רווח" : project?.name}
      subtitle={sub}
      backTo={backTo}
      headerClassName="ui-pp-head"
      headEnd={figure}
      phase={phase}
      onRetry={() => { void detail.refetch(); }}
      loading={<ProfitSkeleton />}
      // FLOW-969: a failed read hides the figures and says what happened, with נסו שוב and צריך עזרה?.
      failed={(retry, offline) => <PageLoadFailed title={project == null ? "הרווח לא נטען" : `הרווח של ${project.name} לא נטען`} offline={offline} onRetry={retry} />}
    >
      {row == null ? null : (
        <div>
          <p ref={setFigure} className="ui-pp-figure ui-page-pad">
            <Amount agorot={profit} currency={currency} size="display" loss={profit < 0n} direction={profit > 0n ? "income" : undefined} />
          </p>
          {offlineSince == null ? null : <div className="ui-page-pad"><BandOfflineLine since={offlineSince} onPage /></div>}
          <Card className="ui-pp-card">
            <SummaryRow label="הכנסות" value={<Amount agorot={row.income_minor} currency={currency} income />} />
            <SummaryRow label="הוצאות שנספרות ברווח" value={<Amount agorot={projectExpenseMinor(row)} currency={currency} />} />
            {share == null ? null : <SummaryRow label="חלק בהוצאות הכלליות" value={<Amount agorot={share} currency={currency} />} />}
            {after == null ? null : (
              <SummaryRow strong label="רווח אחרי הוצאות כלליות" value={<Amount agorot={after} currency={currency} loss={after < 0n} />} />
            )}
          </Card>
          {after == null ? null : <p className="ui-pp-note t-caption t-muted">{NOTE}</p>}
          <OrderChips className="ui-pp-chips" label="סידור" value={by} options={PROJECT_ORDERS} onChange={setBy} />
          {by === "category" ? (
            <CategoryBars
              rows={categories}
              projectId={id}
              currency={currency}
              search={search}
            />
          ) : (
            <>
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
              {monthsFailed ? (
                <FailureLine offline={!navigator.onLine} onRetry={() => { void months.refetch(); }} />
              ) : monthsLoading ? (
                <DelayedSkeleton><ProfitRowsSkeleton /></DelayedSkeleton>
              ) : rows.length === 0 ? null : (
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
            </>
          )}
        </div>
      )}
    </ScreenState>
  );
}

/** FLOW-140 §2.3: one row per expense category, largest first, with a bar scaled to the largest row. */
function CategoryBars({ rows, projectId, currency, search }: { rows: CategoryTotal[]; projectId: string; currency: string; search: string }) {
  const total = rows.reduce((sum, row) => sum + row.amount, 0n);
  const largest = rows[0]?.amount ?? 0n;
  if (rows.length === 0) return null;
  return (
    <List className="ui-pp-cats">
      {rows.map((row) => {
        const share = total === 0n ? 0 : Math.round((Number(row.amount) * 100) / Number(total));
        const width = largest === 0n ? 0 : Number((row.amount * 1000n) / largest) / 10;
        const body = (
          <>
            <span className="ui-pp-cat-top">
              <span>{row.name}</span>
              <Amount agorot={-row.amount} currency={currency} />
            </span>
            <span className="ui-pp-bar" aria-hidden="true"><span className="ui-pp-bar-fill" style={{ width: `${String(width)}%` }} /></span>
            <span className="ui-pp-cat-hint t-caption t-muted">{`${String(share)}% מההוצאות`}</span>
          </>
        );
        return row.id == null ? (
          <div key={row.name} className="ui-pp-cat">{body}</div>
        ) : (
          <div key={row.id} className="ui-pp-cat">
            <Link className="ui-pp-cat-link" to={`/projects/${projectId}/categories/${row.id}${categoryQuery(currency, search)}`}>{body}</Link>
          </div>
        );
      })}
    </List>
  );
}

/** The category page's query: the preview flag, and the currency when it is not shekels. */
function categoryQuery(currency: string, search: string): string {
  if (currency === "ILS") return search;
  return `${search}${search === "" ? "?" : "&"}currency=${encodeURIComponent(currency)}`;
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
