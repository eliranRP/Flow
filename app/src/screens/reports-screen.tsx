import "../ui/lazy.css";
import type { ProfitMonths } from "@flow/shared";
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { usePreviewSearch, useHomePreview } from "../preview";
import { screenPhase } from "../query-phase";
import {
  accountName,
  categoryName,
  marginPercent,
  pnlChipLabel,
  pnlRange,
  projectKeyName,
  statementEmpty,
  type Statement,
  type StatementCurrency,
} from "../reports";
import {
  generalStatementRow,
  groupsNet,
  isGeneralKey,
  monthNeighbours,
  monthRange,
  monthTitleOf,
  netTotal,
  pnlMonthRows,
  pnlPath,
  pnlProjectGroups,
  pnlRouteOf,
  shareStateOf,
  statementGroups,
  type PnlRoute,
  type PnlView,
  type ViewRow,
} from "../report-views";
import { AttentionCards, countTag } from "../ui/attention-cards";
import { useOnline } from "../ui/band-states";
import { Button } from "../ui/button";
import { israelToday } from "../ui/date-math";
import { EmptyState, FailureLine } from "../ui/empty-state";
import { GroupHead } from "../ui/group-head";
import { DocumentIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import type { ScreenPhase } from "../ui/screen-phase";
import { SegmentedControl } from "../ui/segmented-control";
import { useCompanyMonths, usePnl } from "../use-reports";
import { ReportShareSheet } from "./report-share-sheet";
import { NetGroup, ReportBottomLine, ReportGoOn, ReportRowsSkeleton, ReportShell, ViewGroups, amountText, reportHint, type BandFigure } from "./reports-parts";
import { PnlMonthSheet, PnlPeriodSheet, useLatePick } from "./reports-sheets";

/** A fixture: today, and the reads as they would come back (a null drill-down: the project is not found). */
export type PnlSample = {
  today: string;
  /** The period's statement of every project. */
  statement?: Statement;
  /** The same by project: the project view, the general expenses' drill-down and the share sheet's projects. */
  byProject?: Statement;
  months?: NonNullable<ProfitMonths>;
  /** FLOW-1102: the by-month read still loading or failed (a month's drill has no months to step through yet). */
  monthsRead?: "loading" | "failed";
  /** The drilled project's or month's own statement. */
  drilled?: Statement | null;
  phase?: ScreenPhase;
  offlineSince?: number;
};

/** The category drill-down for a row: its own dates (`lfrom`/`lto`, so the report's period stays as it was), the project. */
export function reportLinesPath(range: { from: string | null; to: string | null }, side: "income" | "expense", node: { id: string | null; name: string | null }, search: string, currency: string, project: { id: string; name: string | null } | null): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.set("side", side);
  params.set("category", node.id ?? "none");
  if (node.name != null) params.set("name", node.name);
  if (range.from != null && range.to != null) {
    params.set("lfrom", range.from);
    params.set("lto", range.to);
  }
  params.set("cur", currency);
  // One project: its id, so the drill-down reads that project's lines (FLOW-165), and its name to show.
  if (project != null) {
    params.set("project", project.id);
    if (project.name != null) params.set("pname", project.name);
  }
  return `/reports/lines?${params.toString()}`;
}

/** FLOW-165: a balance-sheet account's movements, keeping the date and the project. */
export function reportAccountPath(search: string, accountId: string, currency: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.set("account", accountId);
  params.set("cur", currency);
  return `/reports/account?${params.toString()}`;
}

const VIEWS: { value: PnlView; label: string }[] = [
  { value: "category", label: "קטגוריה" },
  { value: "project", label: "פרויקט" },
  { value: "month", label: "חודש" },
];

/** Where a kept-out category posts: the account when its name differs, else its type. */
function keptMeta(item: StatementCurrency["kept_out"][number]): string | undefined {
  const account = item.account_name == null ? null : accountName({ name: item.account_name, is_system: true });
  if (account != null && account !== item.name) return account;
  if (item.account_type === "asset") return "נכס";
  if (item.account_type === "liability") return "התחייבות";
  if (item.account_type === "equity") return "הון";
  return undefined;
}

/** What stays out of profit: loans, principal, deposits. In the balance sheet, not the P&L. */
function KeptOut({ row }: { row: StatementCurrency }) {
  if (row.kept_out.length === 0) return null;
  const id = `pnl-kept-${row.currency}`;
  return (
    <section className="ui-month ui-rep-v3-group" aria-labelledby={id}>
      <GroupHead id={id} title="לא נספר ברווח" summary={row.kept_out.length === 1 ? "קטגוריה אחת" : `${String(row.kept_out.length)} קטגוריות`} />
      <List>
        {row.kept_out.map((item) => (
          <ListRow
            key={`${item.direction}:${item.id ?? "none"}`}
            variant="project"
            title={categoryName(item.name)}
            {...(keptMeta(item) == null ? {} : { hint: reportHint(keptMeta(item)) })}
            agorot={item.amount_minor}
            currency={row.currency}
            chevronSpace
            setAside
            {...(item.direction === "income" ? { amountDirection: "income" as const } : {})}
          />
        ))}
      </List>
      <p className="ui-rep-note">נכסים והתחייבויות, כמו קנייה של נכס, הלוואה, קרן ופיקדון מסים וביטוח. הם במאזן, לא ברווח.</p>
    </section>
  );
}

/** The margin under the band's figure: "30% מההכנסות". */
function marginText(row: StatementCurrency): string | undefined {
  const margin = marginPercent(row);
  return margin == null ? undefined : `${String(margin)}% מההכנסות`;
}

/**
 * FLOW-1045 (board V3-Report, kind pl): the profit and loss. The band carries the period pill and the net
 * profit, income and expenses under it; a docking control picks the view: by category (the statement's
 * sections), by project (each project's net, the general expenses in their own group) or by month
 * (get_profit_months). A project or month row drills into its own P&L on the same screen.
 */
export function PnlReportScreen({ sample }: { sample?: PnlSample } = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const online = useOnline();
  const today = sample?.today ?? israelToday();
  const route = useMemo(() => pnlRouteOf(new URLSearchParams(location.search)), [location.search]);
  const live = sample == null;
  const range = pnlRange(route.period, today);
  const drill = route.drill;
  const projectKey = drill?.kind === "project" ? drill.key : null;
  const general = projectKey != null && isGeneralKey(projectKey);
  const month = drill?.kind === "month" ? drill.month : null;
  const drillRange = month != null ? monthRange(month, today) : range;
  const [shareOpen, setShareOpen] = useState(false);

  const allRead = usePnl(range, null, false, live);
  const byProjectRead = usePnl(range, null, true, live && (route.view === "project" || shareOpen));
  // FLOW-1092: a drilled month keeps the months to step through (the by-month view's read, already in).
  const monthsRead = useCompanyMonths(range, live && ((route.view === "month" && drill == null) || month != null));
  const drillRead = usePnl(drillRange, general ? null : projectKey, false, live && drill != null && !general);
  const statement = live ? allRead.data : sample.statement;
  const byProject = live ? byProjectRead.data : sample.byProject;
  const months = live ? monthsRead.data : sample.monthsRead == null ? sample.months : undefined;
  const drilled = live ? drillRead.data : sample.drilled;

  const go = (next: PnlRoute) => {
    void navigate(pnlPath(next, search), { replace: true });
  };
  const period = useLatePick<PnlRoute["period"]>((next) => { go({ period: next, view: route.view, drill: null }); });
  // FLOW-1092 (the owner, 2026-11-07: "Move between months"): in a month's drill the pill moves to another month
  // and stays in the drill. A drill opened from the list keeps that mark, so "‹ לפי חודש" still steps back to it.
  const fromList = typeof location.state === "object" && location.state != null && "reportDrill" in location.state;
  const toMonth = (key: string) => {
    void navigate(pnlPath({ ...route, drill: { kind: "month", month: key } }, search), { replace: true, ...(fromList ? { state: { reportDrill: true } } : {}) });
  };
  const monthPick = useLatePick<string>(toMonth);
  const base = statement?.currencies[0]?.currency ?? "ILS";
  const monthList = month == null ? [] : monthChoices(months == null ? [] : pnlMonthRows(months, base).map((row) => row.key), month);
  const near = month == null ? null : monthNeighbours(monthList.map((item) => item.key), month);
  // FLOW-1102: a drilled month whose months are not in yet: the chevrons say why they wait, and a failure says so with its retry.
  const monthsWait: "loading" | "failed" | null = month == null || months != null ? null : (live ? monthsRead.failed : sample.monthsRead === "failed") ? "failed" : "loading";
  const top = statement?.currencies.find((row) => row.currency === base);
  const drilledRow = drill == null ? null : general ? (byProject == null ? undefined : generalStatementRow(byProject, projectKey, base)) : drilled === undefined ? undefined : drilled === null ? null : (drilled.currencies.find((row) => row.currency === base) ?? drilled.currencies[0] ?? emptyRow(base));
  const bandRead = drill == null ? allRead : general ? byProjectRead : drillRead;
  const bandData = drill == null ? statement : general ? byProject : drilled;
  const phase: ScreenPhase = sample?.phase ?? (!live ? { kind: "ready" } : preview !== "off" ? screenPhase(preview) : bandRead.failed && bandData === undefined ? { kind: "error", offline: !online } : bandData === undefined ? { kind: "loading" } : { kind: "ready" });
  const offlineSince = sample != null ? (sample.offlineSince ?? null) : !online && preview === "off" ? (bandRead.readAt || null) : null;

  const drillName = projectKey != null
    ? (general ? projectKeyName({ key: projectKey, name: null }) : (drilled?.project_name ?? byProject?.projects.find((item) => item.key === projectKey)?.name ?? "פרויקט"))
    : month != null ? monthTitleOf(month) : null;
  const shownRow = drill == null ? top : drilledRow;
  const figure: BandFigure | null = phase.kind === "ready" && shownRow != null ? { amount: shownRow.net_minor, currency: shownRow.currency, loss: shownRow.net_minor < 0n } : phase.kind === "empty" ? { amount: 0n, currency: base, loss: false } : null;
  const empty = phase.kind === "empty" || (statement != null && statementEmpty(statement));
  const undrill = () => {
    const state: unknown = location.state;
    if (typeof state === "object" && state != null && "reportDrill" in state) void navigate(-1);
    else go({ ...route, drill: null });
  };

  let body;
  if (phase.kind === "loading" || (drill != null && drilledRow === undefined)) {
    body = <ReportRowsSkeleton />;
  } else if (drill != null && drilledRow === null) {
    body = <EmptyState icon={<DocumentIcon size={28} />} title="הפרויקט לא נמצא" body="ייתכן שנמחק. אפשר לראות את כל הפרויקטים." action={<Button onClick={() => { go({ ...route, drill: null }); }}>לפי פרויקט</Button>} />;
  } else if (empty && drill == null) {
    body = <EmptyState icon={<DocumentIcon size={28} />} title="אין תנועות בתקופה הזאת" body="לא נרשמו הכנסות או הוצאות בתקופה הזאת, אז אין עדיין מה להציג בדוח." action={<Button onClick={() => { period.setOpen(true); }}>בחירת תקופה אחרת</Button>} />;
  } else if (drill != null && drilledRow != null) {
    const projectId = projectKey != null && !general ? projectKey : null;
    const groups = statementGroups(drilledRow);
    const linesHref = general ? undefined : (row: ViewRow) => (row.category == null ? undefined : reportLinesPath(drillRange, row.category.side, row.category, location.search, drilledRow.currency, projectId == null ? null : { id: projectId, name: drillName }));
    const searchRange = drillRange.from != null && drillRange.to != null ? `period=custom&from=${drillRange.from}&to=${drillRange.to}` : "";
    const extra = search === "" ? "" : `&${search.slice(1)}`;
    const onward = projectId != null
      ? { label: "לדף הפרויקט", to: `/projects/${projectId}${search}` }
      : month != null
        ? { label: "תנועות החודש", to: `/search?${searchRange}${extra}` }
        : projectKey === "unassigned"
          ? { label: "כל התנועות", to: `/search?project=none${searchRange === "" ? "" : `&${searchRange}`}${extra}` }
          : null;
    body = (
      <>
        <ViewGroups id="pnl-drill" groups={groups} currency={drilledRow.currency} {...(linesHref == null ? {} : { href: linesHref })} />
        {/* The groups' own sum: it equals the row tapped and the band (a test). */}
        <ReportBottomLine label="רווח נקי" amount={groupsNet(groups)} currency={drilledRow.currency} />
        {onward == null ? null : <ReportGoOn label={onward.label} to={onward.to} />}
      </>
    );
  } else if (route.view === "project") {
    if (byProject == null) {
      body = byProjectRead.failed ? <FailureLine offline={!online} onRetry={byProjectRead.refetch} /> : <ReportRowsSkeleton />;
    } else {
      const groups = pnlProjectGroups(byProject, base);
      const open = (key: string) => pnlPath({ ...route, drill: { kind: "project", key } }, search);
      body = (
        <>
          <NetGroup id="pnl-projects" title="רווח נקי לפי פרויקט" rows={groups.projects} currency={base} open={(row) => open(row.key)} />
          <NetGroup id="pnl-general" title="כלליות · לא פרויקט" rows={groups.general} currency={base} open={(row) => open(row.key)} />
          <ReportBottomLine label="רווח נקי" amount={netTotal(groups.projects) + netTotal(groups.general)} currency={base} />
        </>
      );
    }
  } else if (route.view === "month") {
    if (months == null) {
      body = monthsRead.failed ? <FailureLine offline={!online} onRetry={monthsRead.refetch} /> : <ReportRowsSkeleton />;
    } else {
      const rows = pnlMonthRows(months, base);
      body = (
        <>
          <NetGroup id="pnl-months" title="רווח נקי לפי חודש" rows={rows} currency={base} open={(row) => pnlPath({ ...route, drill: { kind: "month", month: row.key } }, search)} />
          <ReportBottomLine label="רווח נקי" amount={netTotal(rows)} currency={base} />
        </>
      );
    }
  } else if (statement != null) {
    body = (
      <>
        {statement.currencies.map((row, index) => (
          <div key={row.currency} className="ui-rep-v3-currency">
            {index > 0 ? <h2 className="t-section ui-rep-currency-title">{`ב־${row.currency}`}</h2> : null}
            <ViewGroups id={`pnl-${row.currency}`} groups={statementGroups(row)} currency={row.currency} href={(item) => (item.category == null ? undefined : reportLinesPath(range, item.category.side, item.category, location.search, row.currency, null))} />
            <ReportBottomLine label="רווח נקי" amount={row.net_minor} currency={row.currency} />
            <KeptOut row={row} />
          </div>
        ))}
      </>
    );
  }

  const monthsFailed = monthsWait === "failed" && phase.kind === "ready"
    ? <FailureLine offline={!online} message="לא הצלחנו לטעון את החודשים." onRetry={() => { if (live) monthsRead.refetch(); }} />
    : null;
  const attention = drill == null && phase.kind === "ready" && statement != null && statement.review_count > 0
    ? <AttentionCards storageKey="reports" title="לבדיקה" rows={[{ id: "review", to: `/review${search}`, title: `${String(statement.review_count)} תנועות לא נכללו · לבדיקה`, short: "לא נכללו", tag: countTag(statement.review_count, "תנועה אחת", "תנועות"), dismissKey: `review:${String(statement.review_count)}` }]} />
    : null;
  const ready = phase.kind === "ready" && !empty;
  return (
    <>
      <ReportShell
        name={drillName ?? "רווח והפסד"}
        back={drill == null ? { kind: "hub", to: `/reports${search}` } : { kind: "undrill", label: month != null ? "לפי חודש" : "לפי פרויקט", onBack: undrill }}
        pill={month != null && near != null
          ? {
              label: monthTitleOf(month),
              onOpen: () => { monthPick.setOpen(true); },
              step: {
                earlier: near.earlier == null ? null : "חודש קודם",
                later: near.later == null ? null : "חודש הבא",
                onStep: (delta) => { const key = delta < 0 ? near.earlier : near.later; if (key != null) toMonth(key); },
                reason: monthsWait === "loading" ? "החודשים עוד נטענים" : monthsWait === "failed" ? "החודשים לא נטענו" : null,
                hint: monthsWait === "loading" ? "טוען חודשים…" : null,
              },
            }
          : { label: pnlChipLabel(route.period, today), onOpen: () => { period.setOpen(true); } }}
        figureLabel="רווח נקי"
        figure={figure}
        {...(drill == null ? (top == null ? {} : { figureSub: marginText(top) }) : top == null ? {} : { figureSub: `מתוך רווח נקי ${amountText(top.net_minor, top.currency)}` })}
        rows={shownRow == null ? [] : [{ label: "הכנסות", amount: shownRow.income_minor }, { label: "הוצאות", amount: shownRow.expense_minor }]}
        onShare={ready ? () => { setShareOpen(true); } : null}
        control={drill == null ? (onBand, scrollUnderBar) => (
          <SegmentedControl<PnlView>
            label="תצוגה"
            showLabel={false}
            tone={onBand ? "band" : "page"}
            value={route.view}
            options={VIEWS}
            onChange={(view) => { go({ ...route, view, drill: null }); scrollUnderBar(); }}
          />
        ) : null}
        offlineSince={offlineSince}
        failed={phase.kind === "error" ? { offline: phase.offline, onRetry: bandRead.refetch } : null}
        top={drill == null ? attention : monthsFailed}
      >
        {body}
        {phase.kind === "ready" ? <p className="ui-rep-note">{`נספר לפי ${statement == null || statement.basis === "cash" ? "מזומן" : "חשבוניות"}. דוח ניהולי, לא דוח כספי מבוקר.`}</p> : null}
      </ReportShell>
      {month == null ? null : <PnlMonthSheet open={monthPick.open} onOpenChange={monthPick.onOpenChange} value={month} months={monthList} onPick={monthPick.pick} />}
      <PnlPeriodSheet open={period.open} onOpenChange={period.onOpenChange} value={route.period} today={today} onPick={period.pick} />
      <ReportShareSheet open={shareOpen} onOpenChange={setShareOpen} state={shareStateOf("pnl", route.period, { kind: "today" }, projectKey, route.view === "project")} today={today} projects={byProject?.projects ?? []} />
    </>
  );
}

/** The month sheet's months, newest first: the by-month view's, and the drilled month even when it has no row. */
function monthChoices(keys: readonly string[], month: string): { key: string; name: string }[] {
  const all = keys.includes(month) ? keys : [...keys, month];
  return [...all].sort((a, b) => (a < b ? 1 : -1)).map((key) => ({ key, name: monthTitleOf(key) }));
}

/** A drilled statement with no line in the band's currency. */
function emptyRow(currency: string): StatementCurrency {
  return { currency, income_minor: 0n, expense_minor: 0n, net_minor: 0n, income: [], expense: [], kept_out: [] };
}
