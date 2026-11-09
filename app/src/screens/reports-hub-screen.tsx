import "../ui/lazy.css";
import { computeMemberShare, type ProfitMonths } from "@flow/shared";
import { useMemo, useState, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { usePreviewSearch, useHomePreview } from "../preview";
import { screenPhase } from "../query-phase";
import {
  balanceEmpty,
  equityTotal,
  periodOf,
  pnlChipLabel,
  pnlRange,
  statementEmpty,
  writePeriod,
  type BalanceSheet,
  type PnlPeriod,
  type Statement,
} from "../reports";
import { balancePath, legacyReportsTarget, netTotal, pnlMonthRows, pnlPath, pnlProjectGroups, shareStateOf } from "../report-views";
import { Amount } from "../ui/amount";
import { BandOfflineLine, PageLoadFailed, useOnline } from "../ui/band-states";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { israelToday } from "../ui/date-math";
import { EmptyState, FailureLine } from "../ui/empty-state";
import { CalendarIcon, ChevronDownIcon, ChevronIcon, DocumentIcon, ProjectsIcon } from "../ui/icons";
import { BuildingIcon } from "../ui/icons-later";
import { List, ListRow } from "../ui/list-row";
import { ScreenHeader } from "../ui/screen-header";
import type { ScreenPhase } from "../ui/screen-phase";
import { ChartSkeleton } from "../ui/chart-skeleton";
import { Skeleton } from "../ui/skeleton";
import { useMemberReport, type MemberReportRead } from "../use-member-report";
import { useBalanceAt, useCompanyMonths, usePnl } from "../use-reports";
import { ReportShareSheet } from "./report-share-sheet";
import { amountText } from "./reports-parts";
import { PnlPeriodSheet, useLatePick } from "./reports-sheets";

/** The hub's four reads. */
export type HubRead = "statement" | "byProject" | "months" | "balance" | "member";

/** A fixture: today, and the hub's reads as they would come back (`failed`: the reads that failed). */
export type HubSample = {
  today: string;
  statement?: Statement;
  byProject?: Statement;
  months?: NonNullable<ProfitMonths>;
  balance?: BalanceSheet;
  /** FLOW-1118: the member share report's read; no card when left out. */
  member?: MemberReportRead;
  phase?: ScreenPhase;
  offlineSince?: number;
  failed?: readonly HubRead[];
};

/** The months a P&L card draws, oldest first. */
const CHART_MONTHS = 10;

/** Bar heights in percent of the tallest, at least a sliver so a quiet month still shows. */
export function chartHeights(values: readonly bigint[]): number[] {
  const largest = values.reduce((max, value) => (value < 0n ? -value : value) > max ? (value < 0n ? -value : value) : max, 0n);
  if (largest === 0n) return values.map(() => 4);
  return values.map((value) => Math.max(4, Math.round((Number(value < 0n ? -value : value) * 100) / Number(largest))));
}

/** A decorative mini chart: the months' profit as bars, the last one in the accent colour. The figure is written beside it. */
function MonthBars({ values }: { values: readonly bigint[] }) {
  const heights = chartHeights(values);
  return (
    <span className="ui-rep-hub-bars" aria-hidden="true">
      {heights.map((height, index) => (
        <span key={index} className="ui-rep-hub-bar" data-last={index === heights.length - 1 || undefined} data-loss={(values[index] ?? 0n) < 0n || undefined} style={{ blockSize: `${String(height)}%` }} />
      ))}
    </span>
  );
}

/** A decorative split of the assets: what the loans hold and what is equity. */
function SplitBar({ assets, liabilities }: { assets: bigint; liabilities: bigint }) {
  const share = assets <= 0n ? 0 : Math.min(100, Math.max(0, Math.round((Number(liabilities) * 100) / Number(assets))));
  return (
    <span className="ui-rep-hub-split" aria-hidden="true">
      <span className="ui-rep-hub-split-owed" style={{ inlineSize: `${String(share)}%` }} />
    </span>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="ui-rep-hub-fact">
      <span className="ui-rep-hub-fact-label">{label}</span>
      <span className="t-body">{children}</span>
    </span>
  );
}

/** A report's card while its read is out: the card's shape in skeletons. */
function ReportCardSkeleton() {
  return (
    <Card className="ui-rep-hub-card">
      <Skeleton width="sm" />
      <Skeleton width="md" hero />
      <Skeleton width="lg" />
    </Card>
  );
}

/** A report's card when its read failed: the report's name and a retry line. The rest of the hub stays. */
function ReportCardFailed({ title, offline, onRetry }: { title: string; offline: boolean; onRetry: () => void }) {
  return (
    <Card className="ui-rep-hub-card">
      <span className="ui-rep-hub-title t-body">{title}</span>
      <FailureLine offline={offline} onRetry={onRetry} />
    </Card>
  );
}

/**
 * One report's card: its name, its headline figure, the mini chart and two facts. The whole card opens it.
 * `after` sits below the link, inside the card: the retry line of a read the card draws from.
 */
function ReportCard({ to, title, label, figure, chart, facts, after }: { to: string; title: string; label: string; figure: ReactNode; chart: ReactNode; facts: ReactNode; after?: ReactNode }) {
  return (
    <Card className="ui-rep-hub-card">
      <Link to={to} className="ui-rep-hub-link m-press">
        <span className="ui-rep-hub-title">
          <span className="t-body">{title}</span>
          <ChevronIcon size={18} />
        </span>
        <span className="ui-rep-hub-figure">
          <span className="ui-rep-hub-label">{label}</span>
          <span className="t-card">{figure}</span>
        </span>
        {chart}
        <span className="ui-rep-hub-facts">{facts}</span>
      </Link>
      {after}
    </Card>
  );
}

/**
 * FLOW-1118: דוח שותף's card. The first member's share if every property is sold, their part of the company as
 * the bar, and the company's net and the refinance figure; before ownership is set, the company's net. No card
 * for a company with no property to count.
 */
function MemberCard({ read, to }: { read: MemberReportRead; to: string }) {
  const r = computeMemberShare(read.config, read.properties, read.treasuryYields, read.loans);
  if (r.properties.length === 0 || r.currency == null) return null;
  const first = r.members[0];
  // FLOW-1124: a member's total from a sale, their part of the equity and their own loans back.
  const figure = first?.saleTotalMinor ?? r.totals.equityMinor;
  // FLOW-1129: as the report's band, the member's part of the cash freed plus their loans a refinance pays off.
  const refinance = first?.refiTotalMinor ?? r.totals.cashOutMinor;
  const ownership = first?.ownershipBp ?? 10_000;
  return (
    <ReportCard
      to={to}
      title="דוח שותף"
      label={first == null ? "הון נקי של החברה · אם מוכרים הכל" : `סה״כ ל־${first.name} (${String(ownership / 100)}%) · אם מוכרים הכל`}
      figure={<Amount agorot={figure} currency={r.currency} loss={figure < 0n} size="card" />}
      chart={<SplitBar assets={10_000n} liabilities={BigInt(10_000 - ownership)} />}
      facts={(
        <>
          <Fact label="הון נקי לכולם"><Amount agorot={r.totals.equityMinor} currency={r.currency} loss={r.totals.equityMinor < 0n} /></Fact>
          <Fact label="בריפייננס"><Amount agorot={refinance} currency={r.currency} income /></Fact>
        </>
      )}
    />
  );
}

/**
 * FLOW-1045 (board V3-Reports, the Hub pattern): the reports tab. The page title with the period chip, then
 * one card for each of the two reports (the net profit for the period, the equity as of today) with a mini
 * chart and two facts, then "פירוקים": the P&L by project and by month and the balance sheet by project.
 * Each card draws from its own read: while a read is out its card is a skeleton, and a failed read shows a
 * retry line in its card while the rest of the hub stays.
 */
export function ReportsHubScreen({ sample }: { sample?: HubSample } = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const online = useOnline();
  const today = sample?.today ?? israelToday();
  const period = useMemo(() => periodOf(new URLSearchParams(location.search)), [location.search]);
  const live = sample == null;
  const range = pnlRange(period, today);
  const [shareOpen, setShareOpen] = useState(false);
  const statementRead = usePnl(range, null, false, live);
  const byProjectRead = usePnl(range, null, true, live);
  const monthsRead = useCompanyMonths(range, live);
  const balanceRead = useBalanceAt(today, null, live);
  const memberQuery = useMemberReport(live);
  const statement = live ? statementRead.data : sample.statement;
  const byProject = live ? byProjectRead.data : sample.byProject;
  const months = live ? monthsRead.data : sample.months;
  const balance = live ? balanceRead.data : sample.balance;
  const member = live ? memberQuery.data : sample.member;
  const memberFailed = live ? memberQuery.isError : sample.failed?.includes("member") ?? false;
  const failedOf = (name: HubRead, read: { failed: boolean }) => (live ? read.failed : sample.failed?.includes(name) ?? false);
  const statementFailed = failedOf("statement", statementRead);
  const byProjectFailed = failedOf("byProject", byProjectRead);
  const monthsFailed = failedOf("months", monthsRead);
  const balanceFailed = failedOf("balance", balanceRead);
  // The whole hub fails only when nothing came back; one failed read keeps the rest (its card shows the retry).
  const allFailed = statementFailed && balanceFailed && statement == null && balance == null;
  const phase: ScreenPhase = sample?.phase ?? (live && preview !== "off" ? screenPhase(preview) : allFailed ? { kind: "error", offline: !online } : { kind: "ready" });
  const offlineSince = sample != null ? (sample.offlineSince ?? null) : !online && preview === "off" ? (statementRead.readAt || null) : null;
  const pick = useLatePick<PnlPeriod>((next) => {
    const params = new URLSearchParams(search.replace(/^\?/, ""));
    writePeriod(params, next);
    const text = params.toString();
    void navigate({ pathname: "/reports", search: text === "" ? "" : `?${text}` }, { replace: true });
  });

  // The board's period button: an outlined pill, 15/500, with its chevron (V3-Reports).
  const chip = (
    <button type="button" className="ui-rep-hub-period m-press" aria-haspopup="dialog" onClick={() => { pick.setOpen(true); }}>
      <span className="ui-rep-hub-period-label" data-clip-ok="">{pnlChipLabel(period, today)}</span>
      <ChevronDownIcon size={14} />
    </button>
  );
  const header = <ScreenHeader layout="stacked" title="דוחות" titleAside={chip} />;
  const pnlTo = (view: "category" | "project" | "month") => pnlPath({ period, view, drill: null }, search);
  const balanceTo = (view: "assets" | "project") => balancePath({ asOf: { kind: "today" }, view, project: null }, search);

  const offline = !online;
  let body;
  if (phase.kind === "loading") {
    body = (
      <>
        <ReportCardSkeleton />
        <ReportCardSkeleton />
      </>
    );
  } else if (phase.kind === "error") {
    body = <PageLoadFailed title="הדוחות לא נטענו" offline={phase.offline} onRetry={() => { statementRead.refetch(); balanceRead.refetch(); }} />;
  } else if (phase.kind === "empty" || (statement != null && balance != null && statementEmpty(statement) && balanceEmpty(balance))) {
    body = <EmptyState icon={<DocumentIcon size={28} />} title="אין עדיין מה להציג בדוחות" body="אחרי שנרשמות הכנסות והוצאות, הרווח והמאזן מופיעים כאן." action={<Button onClick={() => { pick.setOpen(true); }}>בחירת תקופה אחרת</Button>} />;
  } else {
    const pnl = statement?.currencies[0];
    const sheet = balance?.currencies[0];
    const currency = pnl?.currency ?? sheet?.currency ?? "ILS";
    const monthRows = months == null ? [] : pnlMonthRows(months, currency);
    const bars = monthRows.slice(0, CHART_MONTHS).reverse().map((row) => row.net);
    const groups = byProject == null ? null : pnlProjectGroups(byProject, currency);
    const best = groups?.projects[0];
    const latest = monthRows[0];
    const average = monthRows.length === 0 ? null : netTotal(monthRows) / BigInt(monthRows.length);
    const pnlCard = statement != null ? (
      <ReportCard
        to={pnlTo("category")}
        title="רווח והפסד"
        label={`רווח נקי · ${pnlChipLabel(period, today)}`}
        figure={pnl == null ? "—" : <Amount agorot={pnl.net_minor} currency={pnl.currency} loss={pnl.net_minor < 0n} size="card" />}
        // FLOW-1139: while the months load, the chart's strip holds its place in skeleton bars.
        chart={months == null && !monthsFailed ? <ChartSkeleton mini /> : bars.length === 0 ? null : <MonthBars values={bars} />}
        facts={pnl == null ? null : (
          <>
            <Fact label="הכנסות"><Amount agorot={pnl.income_minor} currency={pnl.currency} income /></Fact>
            <Fact label="הוצאות"><Amount agorot={pnl.expense_minor} currency={pnl.currency} /></Fact>
          </>
        )}
        after={monthsFailed && months == null ? <FailureLine offline={offline} onRetry={() => { monthsRead.refetch(); }} /> : null}
      />
    ) : statementFailed ? <ReportCardFailed title="רווח והפסד" offline={offline} onRetry={() => { statementRead.refetch(); }} /> : <ReportCardSkeleton />;
    const balanceCard = balance != null ? (
      <ReportCard
        to={balanceTo("assets")}
        title="מאזן"
        label="הון עצמי · היום"
        figure={sheet == null ? "—" : <Amount agorot={equityTotal(sheet)} currency={sheet.currency} loss={equityTotal(sheet) < 0n} size="card" />}
        chart={sheet == null ? null : <SplitBar assets={sheet.total_assets_minor} liabilities={sheet.liabilities.total_minor} />}
        facts={sheet == null ? null : (
          <>
            <Fact label="נכסים"><Amount agorot={sheet.total_assets_minor} currency={sheet.currency} /></Fact>
            <Fact label="התחייבויות"><Amount agorot={sheet.liabilities.total_minor} currency={sheet.currency} /></Fact>
          </>
        )}
      />
    ) : balanceFailed ? <ReportCardFailed title="מאזן" offline={offline} onRetry={() => { balanceRead.refetch(); }} /> : <ReportCardSkeleton />;
    const memberCard = member != null ? <MemberCard read={member} to={`/reports/member${search}`} />
      : memberFailed ? <ReportCardFailed title="דוח שותף" offline={offline} onRetry={() => { void memberQuery.refetch(); }} />
      : live ? <ReportCardSkeleton /> : null;
    body = (
      <>
        {pnlCard}
        {balanceCard}
        {memberCard}
        <section className="ui-rep-hub-cuts" aria-labelledby="rep-hub-cuts">
          <h2 id="rep-hub-cuts" className="t-section ui-rep-hub-cuts-title">פירוקים</h2>
          <List>
            <ListRow variant="item" icon={<ProjectsIcon />} title="רווח והפסד לפי פרויקט" hint={best == null ? "הרווח של כל פרויקט, וההוצאות הכלליות לבד" : `הרווחי ביותר: ${best.name} · ${amountText(best.net, currency, true)}`} href={pnlTo("project")} chevron />
            <ListRow variant="item" icon={<CalendarIcon />} title="רווח והפסד לפי חודש" hint={latest == null || average == null ? "הרווח של כל חודש בתקופה" : `${latest.name} ${amountText(latest.net, currency, true)} · ממוצע ${amountText(average, currency)}`} href={pnlTo("month")} chevron />
            <ListRow variant="item" icon={<BuildingIcon />} title="מאזן לפי פרויקט" hint="הון עצמי בכל נכס · שווי פחות הלוואה" href={balanceTo("project")} chevron />
          </List>
          {byProjectFailed && byProject == null ? <FailureLine offline={offline} onRetry={() => { byProjectRead.refetch(); }} /> : null}
        </section>
        {statement == null && balance == null ? null : <Button variant="secondary" full onClick={() => { setShareOpen(true); }}>שליחת רווח והפסד ומאזן לרו״ח</Button>}
      </>
    );
  }

  return (
    <div className="ui-rep-hub">
      {header}
      <div className="ui-rep-hub-body">
        {offlineSince == null ? null : <BandOfflineLine since={offlineSince} onPage />}
        {body}
      </div>
      <PnlPeriodSheet open={pick.open} onOpenChange={pick.onOpenChange} value={period} today={today} onPick={pick.pick} />
      <ReportShareSheet open={shareOpen} onOpenChange={setShareOpen} state={shareStateOf("pnl", period, { kind: "today" }, null, false)} today={today} projects={byProject?.projects ?? []} />
    </div>
  );
}

/** `/reports`: the hub, or an old link (`?kind=balance`, the project band's `?scope=project&project=`) sent on with its state. */
export function ReportsScreen() {
  const location = useLocation();
  const target = legacyReportsTarget(new URLSearchParams(location.search));
  if (target != null) return <Navigate to={target} replace />;
  return <ReportsHubScreen />;
}
