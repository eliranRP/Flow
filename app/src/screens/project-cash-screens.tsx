import { formatAmountText, type CashLine, type CashMonths, type CashSide, type ProjectDetail } from "@flow/shared";
import type { ReactNode } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { cashMonthKey, cashSideLabel, cashTitle, isCashMonthKey, isCashSide, shownCashRows } from "../cash";
import { useHeldOrder } from "../list-hold";
import { useHomePreview, usePreviewSearch } from "../preview";
import {
  projectCashLinesPath,
  projectCashMonthPath,
  projectCashSummaryRows,
  projectEarlierMonthRows,
  useProjectCashLinesQuery,
  useProjectCashMonthsQuery,
} from "../project-cash";
import { screenPhase } from "../query-phase";
import { BackButton } from "../ui/back";
import { BigNumber } from "../ui/big-number";
import { Button } from "../ui/button";
import { CashRows } from "../ui/cash-rows";
import { formatDayMonth } from "../ui/date-math";
import { EmptyState } from "../ui/empty-state";
import { FocusTitle } from "../ui/focus-title";
import { DocumentIcon } from "../ui/icons";
import { BandHero, SectionHead } from "../ui/layout";
import { rowSource } from "../ui/line-marks";
import { List, ListRow } from "../ui/list-row";
import { ScreenHeader } from "../ui/screen-header";
import { ScreenState } from "../ui/screen-state";
import { SegmentedControl } from "../ui/segmented-control";
import { TopBand } from "../ui/top-band";
import { loansFigure } from "./project-overview";
import type { ProjectInvestment } from "./project-investment-data";

type Project = NonNullable<ProjectDetail>;

/**
 * FLOW-417 (owner's option A "Like Home", decision 0173). The project page is the project's cash,
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
  example,
  now,
}: {
  project: Project;
  data: NonNullable<CashMonths>;
  search: string;
  investmentData: ProjectInvestment;
  investmentHref: string;
  /** The line under the name for a state other than active ("הסתיים"). */
  stateLine: string | null;
  menu: ReactNode;
  example?: ReactNode;
  /** Stories and tests pin the month names. */
  now?: Date;
}) {
  const month = data.months[0];
  const key = month == null ? null : cashMonthKey(month.month);
  const rows = shownCashRows(month, data.base_currency);
  const earlier = projectEarlierMonthRows(project.id, data, search, now);
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
          <div className="t-display ui-project-profits">
            {rows.map((row) => (
              <p key={row.currency}>
                <BigNumber agorot={row.net_minor} currency={row.currency} loss={row.net_minor < 0n} />
              </p>
            ))}
          </div>
        </BandHero>
      </TopBand>
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
      {earlier.length > 0 ? (
        <>
          <SectionHead title="חודשים קודמים" />
          <CashRows rows={earlier} months />
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
}: { sample?: NonNullable<CashMonths>; monthKey?: string; projectId?: string } = {}) {
  const params = useParams();
  const month = monthKey ?? params.month;
  const projectId = sampleProjectId ?? params.projectId ?? "";
  const search = usePreviewSearch();
  if (!isCashMonthKey(month)) return <Navigate to={`/projects/${projectId}${search}`} replace />;
  return <ProjectCashMonthBody projectId={projectId} monthKey={month} search={search} sample={sample} />;
}

function ProjectCashMonthBody({
  projectId,
  monthKey,
  search,
  sample,
}: {
  projectId: string;
  monthKey: string;
  search: string;
  sample?: NonNullable<CashMonths>;
}) {
  const preview = useHomePreview();
  const query = useProjectCashMonthsQuery(projectId, sample == null);
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, query);
  const title = cashTitle(monthKey);
  const back = `/projects/${projectId}${search}`;
  if (phase.kind !== "ready") {
    return <ScreenState stacked title={title} backTo={back} kicker="תזרים" phase={phase} onRetry={() => { void query.refetch(); }} />;
  }
  const data = sample ?? query.data ?? null;
  const month = monthOf(data ?? undefined, monthKey);
  // The project page reads the last few months; a month outside them has no page.
  if (data == null || month == null) return <Navigate to={back} replace />;
  const rows = shownCashRows(month, data.base_currency);
  return (
    <div>
      <ScreenHeader layout="stacked" title={title} backTo={back} kicker="תזרים" />
      <p className="ui-breakdown-total ui-page-pad">
        {rows.map((row) => (
          <span key={row.currency} className="ui-breakdown-total-line">
            <BigNumber agorot={row.net_minor} currency={row.currency} size="display" loss={row.net_minor < 0n} />
          </span>
        ))}
      </p>
      <CashRows rows={projectCashSummaryRows(projectId, monthKey, rows, search)} />
    </div>
  );
}

type LinesSample = { months: NonNullable<CashMonths>; lines: CashLine[] };

/** The project's lines behind one month's נכנס or יצא; a shared bill shows the project's share. */
export function ProjectCashLinesScreen({
  sample,
  at,
}: { sample?: LinesSample; at?: { projectId: string; month: string; side: CashSide; currency: string } } = {}) {
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
  side: CashSide;
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
  const rows = useHeldOrder(loaded, (row) => `${row.transaction_id}:${row.part ?? ""}`);
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
  const figure = total == null ? null : side === "in" ? total.in_minor : total.out_minor;
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
          title={side === "in" ? "לא נכנס כסף בחודש הזה" : "לא יצא כסף בחודש הזה"}
          body="תנועות שנכנסות לתזרים יופיעו כאן."
        />
      ) : (
        <List>
          {rows.map((row) => {
            // The page is one project's, so the hint names the category; a shared bill's amount is the project's share.
            const hint = [formatDayMonth(row.cash_month_date), row.category_name]
              .filter((part): part is string => part != null && part !== "")
              .join(" · ");
            return (
              <ListRow
                key={`${row.transaction_id}:${row.part ?? ""}`}
                variant="transaction"
                title={row.supplier_name ?? row.description}
                hint={hint}
                agorot={row.amount_minor < 0n ? -row.amount_minor : row.amount_minor}
                currency={row.currency}
                sign={side === "in" ? (row.amount_minor < 0n ? "out" : "in") : row.amount_minor < 0n ? "in" : "cost"}
                inWord={side === "out" ? "זיכוי" : undefined}
                source={rowSource(row.source)}
                href={`/transactions/${row.transaction_id}${search}`}
              />
            );
          })}
        </List>
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
