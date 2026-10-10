import { formatAmountText, type CashLine, type CashMonths, type ProjectDetail } from "@flow/shared";
import type { ReactNode } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import {
  cashMonthKey,
  cashSideLabel,
  cashTitle,
  isCashMonthKey,
  isCashSide,
  notInProfitMinor,
  notInProfitRest,
  shownCashRows,
  type CashListSide,
} from "../cash";
import { useHeldOrder } from "../list-hold";
import { anchorOf, monthPeriod, shiftMonthKey, type PeriodChoice } from "../period";
import { useHomePreview, usePreviewSearch } from "../preview";
import {
  projectCashHistoryPath,
  projectCashLinesPath,
  projectCashMonthPath,
  projectCashSummaryRows,
  projectEarlierMonthRows,
  useProjectCashLinesQuery,
  useProjectCashMonthData,
  useProjectCashMonthLinesQuery,
  type ProjectCashMonthLines,
  useProjectCashMonthsQuery,
} from "../project-cash";
import { screenPhase } from "../query-phase";
import { BackButton } from "../ui/back";
import { BigNumber } from "../ui/big-number";
import { Button } from "../ui/button";
import { CashLineRows, CashMonthLines, cashLineKey } from "../ui/cash-line-rows";
import { CashRows } from "../ui/cash-rows";
import { israelToday } from "../ui/date-math";
import { EmptyState } from "../ui/empty-state";
import { FocusTitle } from "../ui/focus-title";
import { DocumentIcon } from "../ui/icons";
import { BannerRows, type BannerRow } from "../ui/banner";
import { BandHero, SectionHead } from "../ui/layout";
import { List, ListRow } from "../ui/list-row";
import { MonthStepper } from "../ui/month-stepper";
import { PeriodSwipe } from "../ui/period-swipe";
import { ScreenHeader } from "../ui/screen-header";
import { ScreenState } from "../ui/screen-state";
import { SegmentedControl } from "../ui/segmented-control";
import { TextLink } from "../ui/text-link";
import { ListSkeleton, Skeleton } from "../ui/skeleton";
import { TopBand } from "../ui/top-band";
import { useProjectQuery } from "../use-books";
import { loansFigure } from "./project-overview";
import type { ProjectInvestment } from "./project-investment-data";

type Project = NonNullable<ProjectDetail>;

/**
 * FLOW-419 (owner's option A "Like Home", decision 0176). The project page is the project's cash,
 * as Home is the company's: this month's תזרים, נכנס, יצא and רווח החודש, one row for השקעה
 * והלוואות, then the earlier months. An earlier month opens its own page, and נכנס or יצא the
 * project's lines.
 */

/** השקעה והלוואות: הון עצמי בנכס when known, else the loans; null with neither (the row hides). */
export function investmentLoansRow(data: ProjectInvestment, project: Project): { hint?: string; figure?: string } | null {
  const figures = data.isOverhead ? null : data.figures;
  if (figures?.currentEquityMinor != null) {
    return { hint: "הון עצמי בנכס", figure: formatAmountText(figures.currentEquityMinor, figures.currency) };
  }
  const loans = loansFigure(project);
  if (loans != null) return { hint: loans };
  const entered = figures != null
    && (figures.purchaseMinor != null || figures.valueMinor != null || figures.arvMinor != null || figures.rehabMinor !== 0n);
  return entered ? {} : null;
}

export function ProjectCashOverview({
  project,
  data,
  search,
  investmentData,
  investmentHref,
  stateLine,
  menu,
  attention = [],
  example,
  now,
}: {
  project: Project;
  /** Null while the cash read is still out: the band paints the project's name from its own read. */
  data: NonNullable<CashMonths> | null;
  search: string;
  investmentData: ProjectInvestment;
  investmentHref: string;
  /** The line under the name for a state other than active ("הסתיים"). */
  stateLine: string | null;
  menu: ReactNode;
  /** Home's attention rows for this project: its late bills and income, and its changed charges. */
  attention?: BannerRow[];
  example?: ReactNode;
  /** Stories and tests pin the month names. */
  now?: Date;
}) {
  const month = data?.months[0];
  const key = month == null ? null : cashMonthKey(month.month);
  const rows = data == null ? [] : shownCashRows(month, data.base_currency);
  const earlier = data == null ? [] : projectEarlierMonthRows(project.id, data, search, now);
  const investment = investmentLoansRow(investmentData, project);
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <TopBand
        wordmark={false}
        example={example}
        leading={<BackButton fallback={`/projects${search}`} onBand />}
        trailing={menu}
      >
        <BandHero className="ui-band-hero-project">
          <FocusTitle className="t-band-title">{project.name}</FocusTitle>
          {stateLine == null ? null : <p className="t-label">{stateLine}</p>}
          <p className="ui-band-label t-label">{key == null ? "תזרים" : cashTitle(key, now)}</p>
          {data == null ? (
            <Skeleton tone="band" className="ui-skel-project-num" />
          ) : (
            <div className="t-display ui-project-profits">
              {rows.map((row) => (
                <p key={row.currency}>
                  <BigNumber agorot={row.net_minor} currency={row.currency} loss={row.net_minor < 0n} />
                </p>
              ))}
            </div>
          )}
        </BandHero>
      </TopBand>
      {data == null ? <ListSkeleton /> : null}
      {key == null ? null : <CashRows rows={projectCashSummaryRows(project.id, key, rows, search, now)} />}
      {investment == null ? null : (
        <List className="ui-project-cash-more">
          <ListRow
            variant="item"
            title="השקעה והלוואות"
            hint={investment.hint}
            meta={investment.figure == null ? undefined : <bdi className="ui-num ui-project-row-figure" dir="ltr">{investment.figure}</bdi>}
            href={investmentHref}
            chevron
          />
        </List>
      )}
      {/* As on Home: the rows that need a hand, after the figures; an empty box hides. */}
      <BannerRows rows={attention} />
      {earlier.length > 0 ? (
        <>
          <SectionHead title="חודשים קודמים" />
          <CashRows rows={earlier} months />
          {/* As on Home (FLOW-417): the project's whole history, years then months, under the last month. */}
          <p className="ui-page-pad">
            <TextLink to={projectCashHistoryPath(project.id, search)} tone="quiet">
              לכל החודשים
            </TextLink>
          </p>
        </>
      ) : null}
    </div>
  );
}

function monthOf(data: CashMonths | undefined, key: string) {
  return data?.months.find((month) => cashMonthKey(month.month) === key);
}

/** An earlier month of the project: its figure, נכנס, יצא and רווח החודש. */
export function ProjectCashMonthScreen({
  sample,
  monthKey,
  projectId: sampleProjectId,
  projectName,
  sampleLines,
}: { sample?: NonNullable<CashMonths>; monthKey?: string; projectId?: string; projectName?: string; sampleLines?: ProjectCashMonthLines } = {}) {
  const params = useParams();
  const month = monthKey ?? params.month;
  const projectId = sampleProjectId ?? params.projectId ?? "";
  const search = usePreviewSearch();
  if (!isCashMonthKey(month)) return <Navigate to={`/projects/${projectId}${search}`} replace />;
  return <ProjectCashMonthBody projectId={projectId} monthKey={month} search={search} sample={sample} sampleName={projectName} sampleLines={sampleLines} />;
}

function ProjectCashMonthBody({
  projectId,
  monthKey,
  search,
  sample,
  sampleName,
  sampleLines,
}: {
  projectId: string;
  monthKey: string;
  search: string;
  sample?: NonNullable<CashMonths>;
  sampleName?: string;
  sampleLines?: ProjectCashMonthLines;
}) {
  const preview = useHomePreview();
  // An older month (opened from the history) reads its year's months.
  const query = useProjectCashMonthData(projectId, monthKey, sample == null);
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, query);
  const title = cashTitle(monthKey);
  const back = `/projects/${projectId}${search}`;
  // FLOW-422 (design lead): Back names the project it returns to; the page says which project it is.
  const project = useProjectQuery(sample ? "" : projectId);
  const kicker = sampleName ?? project.data?.name ?? undefined;
  const navigate = useNavigate();
  const data = sample ?? query.data ?? null;
  // FLOW-438: the month's lines, in the base currency's figures (the first row's currency).
  const linesCurrency = data == null ? "" : (shownCashRows(monthOf(data, monthKey), data.base_currency)[0]?.currency ?? "");
  const lines = useProjectCashMonthLinesQuery(projectId, monthKey, linesCurrency, sample == null);
  // FLOW-422: Home's month pager and swipe, within the months the project's read holds.
  const opens = (key: string) => monthOf(data ?? undefined, key) != null && key <= israelToday().slice(0, 7);
  const go = (key: string) => {
    void navigate(projectCashMonthPath(projectId, key, search), { replace: true });
  };
  const earlierKey = shiftMonthKey(monthKey, -1);
  const laterKey = shiftMonthKey(monthKey, 1);
  const stepper = (
    <MonthStepper
      earlier={opens(earlierKey) ? cashTitle(earlierKey) : null}
      later={opens(laterKey) ? cashTitle(laterKey) : null}
      onStep={(delta) => {
        go(delta < 0 ? earlierKey : laterKey);
      }}
    />
  );
  if (phase.kind !== "ready") {
    return <ScreenState stacked title={title} backTo={back} kicker={kicker} phase={phase} onRetry={() => { void query.refetch(); }} />;
  }
  const month = monthOf(data ?? undefined, monthKey);
  // A month outside the project's books (or after this one) has no page.
  if (data == null || month == null) return <Navigate to={back} replace />;
  const rows = shownCashRows(month, data.base_currency);
  return (
    <div>
      <ScreenHeader layout="stacked" title={title} backTo={back} kicker={kicker} titleAside={stepper} />
      <PeriodSwipe
        period={monthPeriod(monthKey)}
        allow={(next: PeriodChoice) => opens(anchorOf(next))}
        onChange={(next) => {
          go(anchorOf(next));
        }}
      >
        <p className="ui-breakdown-total ui-page-pad">
          {rows.map((row) => (
            <span key={row.currency} className="ui-breakdown-total-line">
              <BigNumber agorot={row.net_minor} currency={row.currency} size="display" loss={row.net_minor < 0n} />
            </span>
          ))}
        </p>
      </PeriodSwipe>
      <CashRows rows={projectCashSummaryRows(projectId, monthKey, rows, search)} />
      <ProjectMonthLines lines={sampleLines ?? lines.data} loading={sampleLines == null && lines.isPending} search={search} />
    </div>
  );
}

/** FLOW-438 (owner, 2026-10-10): the month's תנועות under its figures; a month with none shows nothing more. */
function ProjectMonthLines({ lines, loading, search }: { lines: ProjectCashMonthLines | undefined; loading: boolean; search: string }) {
  if (loading) return <ListSkeleton />;
  if (lines == null || lines.counted.length + lines.kept.length === 0) return null;
  return (
    <section aria-label="תנועות">
      <SectionHead title="תנועות" />
      <CashMonthLines counted={lines.counted} kept={lines.kept} search={search} />
    </section>
  );
}

type LinesSample = { months: NonNullable<CashMonths>; lines: CashLine[] };

// Home's words and signs for the lines pages (cash-screens.tsx), for the project's own lines.
const KEPT_NOTE = "כסף שזז בבנק, אבל אינו הכנסה או הוצאה.";

/** The project's lines behind one month's נכנס, יצא or לא נספר ברווח; a shared bill shows the project's share. */
export function ProjectCashLinesScreen({
  sample,
  at,
}: { sample?: LinesSample; at?: { projectId: string; month: string; side: CashListSide; currency: string } } = {}) {
  const params = useParams();
  const projectId = at?.projectId ?? params.projectId ?? "";
  const month = at?.month ?? params.month;
  const side = at?.side ?? params.side;
  const currency = at?.currency ?? params.currency ?? "";
  const search = usePreviewSearch();
  if (!isCashMonthKey(month) || !isCashSide(side) || !/^[A-Z]{3}$/.test(currency)) {
    return <Navigate to={`/projects/${projectId}${search}`} replace />;
  }
  return <ProjectCashLinesBody projectId={projectId} monthKey={month} side={side} currency={currency} search={search} sample={sample} />;
}

function ProjectCashLinesBody({
  projectId,
  monthKey,
  side,
  currency,
  search,
  sample,
}: {
  projectId: string;
  monthKey: string;
  side: CashListSide;
  currency: string;
  search: string;
  sample?: LinesSample;
}) {
  const preview = useHomePreview();
  const navigate = useNavigate();
  const months = useProjectCashMonthsQuery(projectId, sample == null);
  const lines = useProjectCashLinesQuery(projectId, monthKey, side, currency, sample == null);
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, lines);
  const loaded = sample?.lines ?? (lines.data?.pages ?? []).flatMap((page) => page?.rows ?? []);
  const rows = useHeldOrder(loaded, cashLineKey);
  const title = cashSideLabel(side);
  const kicker = cashTitle(monthKey);
  const data = sample?.months ?? months.data ?? null;
  const isCurrent = data != null && data.months[0] != null && cashMonthKey(data.months[0].month) === monthKey;
  const back = isCurrent ? `/projects/${projectId}${search}` : projectCashMonthPath(projectId, monthKey, search);

  if (phase.kind !== "ready") {
    return <ScreenState stacked title={title} backTo={back} kicker={kicker} phase={phase} onRetry={() => { void lines.refetch(); }} />;
  }

  const month = data == null ? undefined : monthOf(data, monthKey);
  const shown = data == null ? [] : shownCashRows(month, data.base_currency);
  const total = shown.find((row) => row.currency === currency);
  const figure = total == null ? null : side === "in" ? total.in_minor : side === "out" ? total.out_minor : notInProfitMinor(total);
  // FLOW-418: VAT, and lines out of the view but in profit, are in the figure but have no row here.
  const rest = side === "kept" && total != null ? notInProfitRest(total) : 0n;
  const more = sample ? false : lines.hasNextPage;
  return (
    <div>
      <ScreenHeader layout="stacked" title={title} backTo={back} kicker={kicker} />
      {figure != null ? (
        <p className="ui-breakdown-total ui-page-pad">
          <span className="ui-breakdown-total-line">
            <BigNumber agorot={figure} currency={currency} size="display" income={side === "in"} />
          </span>
        </p>
      ) : null}
      {side === "kept" ? (
        <p className="ui-breakdown-hint ui-page-pad t-hint">
          {rest === 0n ? KEPT_NOTE : `${KEPT_NOTE} מזה ${formatAmountText(rest, currency)} מע״מ והפרשים, שאינם ברשימה.`}
        </p>
      ) : null}
      {shown.length > 1 ? (
        <div className="ui-page-pad">
          <SegmentedControl
            label="מטבע"
            showLabel={false}
            value={currency}
            options={shown.map((row) => ({ value: row.currency, label: row.currency }))}
            onChange={(next) => {
              void navigate(projectCashLinesPath(projectId, monthKey, side, next, search), { replace: true });
            }}
          />
        </div>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState
          icon={<DocumentIcon />}
          title={side === "in" ? "לא נכנס כסף בחודש הזה" : side === "out" ? "לא יצא כסף בחודש הזה" : rest === 0n ? "הכול נספר ברווח החודש" : "אין תנועות שמחוץ לרווח"}
          body="תנועות שנכנסות לתזרים יופיעו כאן."
        />
      ) : (
        <CashLineRows rows={rows} list={side} search={search} />
      )}
      {more ? (
        <div className="ui-page-pad">
          <Button
            variant="pill"
            busy={lines.isFetchingNextPage}
            onClick={() => {
              void lines.fetchNextPage();
            }}
          >
            עוד תנועות
          </Button>
        </div>
      ) : null}
    </div>
  );
}
