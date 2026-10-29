import "../ui/lazy.css";
import { useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { usePreviewSearch, useHomePreview } from "../preview";
import { screenPhase } from "../query-phase";
import {
  balanceChipLabel,
  balanceDate,
  balanceEmpty,
  dateRangeText,
  ltr,
  equityTotal,
  pnlChipLabel,
  pnlRange,
  readCollapsed,
  reportSearch,
  reportStateOf,
  statementEmpty,
  statementSectionIds,
  writeCollapsed,
  type BalanceSheet,
  type ReportKind,
  type ReportState,
  type Statement,
} from "../reports";
import { BandOfflineLine, PageLoadFailed, useOnline } from "../ui/band-states";
import { Chip } from "../ui/chip";
import { formatDisplay, israelToday } from "../ui/date-math";
import { EmptyState } from "../ui/empty-state";
import { Button } from "../ui/button";
import { DocumentIcon } from "../ui/icons";
import { ScreenHeader } from "../ui/screen-header";
import { ProfitRowsSkeleton } from "../ui/screen-skeletons";
import type { ScreenPhase } from "../ui/screen-phase";
import { SegmentedControl } from "../ui/segmented-control";
import { DelayedSkeleton } from "../ui/skeleton";
import { useBalanceSheet, useReportProjects, useStatement } from "../use-reports";
import { BalanceView, ByProjectView, ReportSummary, StatementView, statementSub, type Collapse } from "./reports-parts";
import { BalanceDateSheet, PnlPeriodSheet, ReportProjectSheet } from "./reports-sheets";

/** A fixture: today, and the reads as they would come back (null statement: the project is not found). */
export type ReportsSample = {
  today: string;
  statement?: Statement | null;
  balance?: BalanceSheet;
  /** The by-project statement the projects sheet lists. */
  projects?: Statement;
  phase?: ScreenPhase;
  offlineSince?: number;
};

/** The category drill-down for a row, keeping the period and the project. */
export function reportLinesPath(state: ReportState, side: "income" | "expense", node: { id: string | null; name: string | null }, today: string, search: string, currency: string, projectName: string | null): string {
  const range = pnlRange(state.period, today);
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.set("side", side);
  params.set("category", node.id ?? "none");
  if (node.name != null) params.set("name", node.name);
  if (range.from != null && range.to != null) {
    params.set("from", range.from);
    params.set("to", range.to);
  } else {
    params.delete("from");
    params.delete("to");
  }
  params.set("cur", currency);
  if (state.scope.kind === "project" && projectName != null) params.set("pname", projectName);
  else params.delete("pname");
  return `/reports/lines?${params.toString()}`;
}

/**
 * FLOW-161 (board row "דוחות", Home card Option 2): the P&L and the balance sheet. A switch picks the report,
 * two chips pick the period (or the date) and the projects, every section collapses with its total on its
 * header, and a category row opens its lines. Everything it picks is in the URL.
 */
export function ReportsScreen({ sample }: { sample?: ReportsSample } = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const online = useOnline();
  const today = sample?.today ?? israelToday();
  const state = useMemo(() => reportStateOf(new URLSearchParams(location.search)), [location.search]);
  const live = sample == null;
  const statementRead = useStatement(state, today, live && state.kind === "pnl");
  const balanceRead = useBalanceSheet(state, today, live && state.kind === "balance");
  const projectsRead = useReportProjects(state, today, live);
  const statement = live ? statementRead.data : sample.statement;
  const balance = live ? balanceRead.data : sample.balance;
  const projects = (live ? projectsRead.data : sample.projects)?.projects ?? [];
  const [collapsedByKind, setCollapsedByKind] = useState<Record<ReportKind, Set<string>>>(() => ({ pnl: readCollapsed("pnl"), balance: readCollapsed("balance") }));
  const collapsed = collapsedByKind[state.kind];
  const [sheet, setSheet] = useState<"period" | "projects" | null>(null);
  // A pick lands once its sheet has closed: closing steps back over the sheet's history entry, which
  // would undo a URL written before it.
  const pendingPick = useRef<ReportState | null>(null);

  const go = (next: ReportState) => {
    void navigate({ pathname: location.pathname, search: reportSearch(next) }, { replace: true });
  };
  const sheetChange = (which: "period" | "projects") => (open: boolean) => {
    setSheet(open ? which : null);
    if (open || pendingPick.current == null) return;
    const next = pendingPick.current;
    pendingPick.current = null;
    // After the sheet's own clean-up of its history entry, which rewrites the URL as it was.
    queueMicrotask(() => { go(next); });
  };
  const pickLater = (next: ReportState) => {
    pendingPick.current = next;
  };
  const setCollapsed = (next: Set<string>) => {
    setCollapsedByKind((current) => ({ ...current, [state.kind]: next }));
    writeCollapsed(state.kind, next);
  };
  const collapse: Collapse = {
    isOpen: (id) => !collapsed.has(id),
    onToggle: (id) => {
      const next = new Set(collapsed);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setCollapsed(next);
    },
  };

  const read = state.kind === "pnl" ? statementRead : balanceRead;
  const data = state.kind === "pnl" ? statement : balance;
  const phase: ScreenPhase = sample?.phase ?? (sample != null ? { kind: "ready" } : preview !== "off" ? screenPhase(preview) : read.failed ? { kind: "error", offline: !online } : data === undefined ? { kind: "loading" } : { kind: "ready" });
  const offlineSince = sample != null ? (sample.offlineSince ?? null) : !online && preview === "off" ? (read.readAt || null) : null;

  const projectName = state.scope.kind === "project"
    ? (statement?.project_name ?? balance?.project_name ?? projects.find((project) => project.project_id === (state.scope.kind === "project" ? state.scope.id : ""))?.name ?? "פרויקט")
    : null;
  const scopeLabel = state.scope.kind === "all" ? "כל הפרויקטים" : state.scope.kind === "by_project" ? "לפי פרויקט" : (projectName ?? "פרויקט");
  const periodLabel = state.kind === "pnl" ? pnlChipLabel(state.period, today) : balanceChipLabel(state.asOf, today);
  const range = pnlRange(state.period, today);
  const rangeText = dateRangeText(range.from, range.to);

  const head = (
    <div className="ui-rep-head-controls">
      <SegmentedControl<ReportKind>
        label="סוג דוח"
        showLabel={false}
        radius="input"
        value={state.kind}
        onChange={(kind) => { go({ ...state, kind, scope: kind === "balance" && state.scope.kind === "by_project" ? { kind: "all" } : state.scope }); }}
        options={[{ value: "pnl", label: "רווח והפסד" }, { value: "balance", label: "מאזן" }]}
      />
      <div className="ui-rep-chips">
        <Chip pressed onClick={() => { setSheet("period"); }}>{periodLabel}</Chip>
        <Chip pressed={state.scope.kind !== "all"} onClick={() => { setSheet("projects"); }}>{scopeLabel}</Chip>
      </div>
    </div>
  );
  const sheets = (
    <>
      {state.kind === "pnl" ? (
        <PnlPeriodSheet open={sheet === "period"} onOpenChange={sheetChange("period")} value={state.period} today={today} onPick={(period) => { pickLater({ ...state, period }); }} />
      ) : (
        <BalanceDateSheet open={sheet === "period"} onOpenChange={sheetChange("period")} value={state.asOf} today={today} onPick={(asOf) => { pickLater({ ...state, asOf }); }} />
      )}
      <ReportProjectSheet open={sheet === "projects"} onOpenChange={sheetChange("projects")} value={state.scope} projects={projects} allowByProject={state.kind === "pnl"} onPick={(scope) => { pickLater({ ...state, scope }); }} />
    </>
  );
  const header = <ScreenHeader layout="stacked" title="דוחות" backTo={`/${search}`} backText="בית" below={head} />;

  let body;
  if (phase.kind === "loading") {
    body = <DelayedSkeleton><ProfitRowsSkeleton /></DelayedSkeleton>;
  } else if (phase.kind === "error") {
    body = <PageLoadFailed title="הדוח לא נטען" offline={phase.offline} onRetry={read.refetch} />;
  } else if (data === null) {
    body = <EmptyState icon={<DocumentIcon size={28} />} title="הפרויקט לא נמצא" body="ייתכן שנמחק. אפשר לראות את כל הפרויקטים יחד." action={<Button onClick={() => { go({ ...state, scope: { kind: "all" } }); }}>כל הפרויקטים</Button>} />;
  } else if (phase.kind === "empty" || (state.kind === "pnl" && statement != null && statementEmpty(statement)) || (state.kind === "balance" && balance != null && balanceEmpty(balance))) {
    const what = state.kind === "pnl" ? "אין תנועות בתקופה הזאת" : "אין עדיין יתרות במאזן";
    body = <EmptyState icon={<DocumentIcon size={28} />} title={what} body={state.kind === "pnl" ? "לא נרשמו הכנסות או הוצאות בתקופה הזאת, אז אין עדיין מה להציג בדוח." : "אין עדיין תנועות עד התאריך הזה."} action={<Button onClick={() => { setSheet("period"); }}>{state.kind === "pnl" ? "בחירת תקופה אחרת" : "בחירת תאריך אחר"}</Button>} />;
  } else if (state.kind === "pnl" && statement != null) {
    const first = statement.currencies[0];
    const byProject = state.scope.kind === "by_project";
    const ids = byProject
      ? statement.projects.map((project) => `project:${project.key}`)
      : statement.currencies.flatMap((row) => statementSectionIds(row));
    // By project the cards start closed, so a card's id in the set means open.
    const allClosed = byProject ? ids.every((id) => !collapsed.has(id)) : ids.every((id) => collapsed.has(id));
    const toggleAll = () => {
      const next = new Set(collapsed);
      for (const id of ids) {
        const close = !allClosed;
        if (byProject ? !close : close) next.add(id);
        else next.delete(id);
      }
      setCollapsed(next);
    };
    body = (
      <div className="ui-rep-content">
        {first != null ? (
          <ReportSummary
            label={byProject ? `רווח נקי · ${String(statement.projects.filter((project) => project.project_id != null).length)} פרויקטים` : state.scope.kind === "project" ? `רווח נקי · ${projectName ?? ""}` : "רווח נקי"}
            amount={first.net_minor}
            currency={first.currency}
            sub={statementSub(first, rangeText)}
          />
        ) : null}
        {offlineSince == null ? null : <BandOfflineLine since={offlineSince} onPage />}
        <div className="ui-rep-tools">
          <span className="t-caption t-muted">{statement.review_count > 0 ? `${String(statement.review_count)} תנועות ממתינות לבדיקה ולא נכללו` : ""}</span>
          <button type="button" className="ui-rep-toggle-all" onClick={toggleAll}>{allClosed ? "פתיחת הכל" : "כיווץ הכל"}</button>
        </div>
        {byProject ? (
          <ByProjectView projects={statement.projects} currency={first?.currency ?? "ILS"} collapse={{ isOpen: (id) => !collapsed.has(id), onToggle: collapse.onToggle }} openProject={(id) => `${location.pathname}${reportSearch({ ...state, scope: { kind: "project", id } })}`} />
        ) : (
          statement.currencies.map((row, index) => (
            <div key={row.currency} className="ui-rep-currency">
              {index > 0 ? <h2 className="t-section ui-rep-currency-title">{`ב־${row.currency}`}</h2> : null}
              <StatementView row={row} collapse={collapse} drill={(side, node) => reportLinesPath(state, side, node, today, location.search, row.currency, projectName)} />
            </div>
          ))
        )}
        <p className="ui-rep-note">{`נספר לפי ${statement.basis === "cash" ? "מזומן" : "חשבוניות"}. דוח ניהולי, לא דוח כספי מבוקר.`}</p>
      </div>
    );
  } else if (state.kind === "balance" && balance != null) {
    const first = balance.currencies[0];
    const ids = balance.currencies.flatMap((row) => [`${row.currency}:assets`, `${row.currency}:liabilities`, `${row.currency}:equity`]);
    const allClosed = ids.every((id) => collapsed.has(id));
    body = (
      <div className="ui-rep-content">
        {first != null ? (
          <ReportSummary
            label={state.scope.kind === "project" ? `הון עצמי · ${projectName ?? ""}` : "הון עצמי"}
            amount={equityTotal(first)}
            currency={first.currency}
            sub={`${first.balanced && first.warnings.length === 0 ? "מאוזן · " : ""}נכון ל־${ltr(formatDisplay(balanceDate(state.asOf, today)))}`}
            ok={first.balanced && first.warnings.length === 0}
          />
        ) : null}
        {offlineSince == null ? null : <BandOfflineLine since={offlineSince} onPage />}
        <div className="ui-rep-tools">
          <span />
          <button type="button" className="ui-rep-toggle-all" onClick={() => {
            const next = new Set(collapsed);
            for (const id of ids) {
              if (allClosed) next.delete(id);
              else next.add(id);
            }
            setCollapsed(next);
          }}>{allClosed ? "פתיחת הכל" : "כיווץ הכל"}</button>
        </div>
        {balance.currencies.map((row, index) => (
          <div key={row.currency} className="ui-rep-currency">
            {index > 0 ? <h2 className="t-section ui-rep-currency-title">{`ב־${row.currency}`}</h2> : null}
            <BalanceView row={row} collapse={collapse} fixHref={`/settings/categories${search}`} />
          </div>
        ))}
        <p className="ui-rep-note">דוח ניהולי, לא דוח כספי מבוקר.</p>
      </div>
    );
  }

  return (
    <div className="ui-rep-screen">
      {header}
      {body}
      {sheets}
    </div>
  );
}
