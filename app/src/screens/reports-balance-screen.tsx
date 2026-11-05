import "../ui/lazy.css";
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { usePreviewSearch, useHomePreview } from "../preview";
import { screenPhase } from "../query-phase";
import {
  accountName,
  balanceChipLabel,
  balanceDate,
  balanceEmpty,
  equityTotal,
  type BalanceCurrency,
  type BalanceSheet,
  type BalanceSide,
  type Statement,
} from "../reports";
import { balancePath, balanceProjectRows, balanceRouteOf, sheetEquity, shareStateOf, type BalanceRoute, type BalanceView, type ViewGroup } from "../report-views";
import { useOnline } from "../ui/band-states";
import { Button } from "../ui/button";
import { israelToday } from "../ui/date-math";
import { EmptyState, FailureLine } from "../ui/empty-state";
import { GroupHead } from "../ui/group-head";
import { DocumentIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import type { ScreenPhase } from "../ui/screen-phase";
import { SegmentedControl } from "../ui/segmented-control";
import { useBalanceAt, usePnl, useProjectBalances } from "../use-reports";
import { ReportShareSheet } from "./report-share-sheet";
import { BalanceWarningCard, ReportBottomLine, ReportGoOn, ReportRowsSkeleton, ReportShell, ViewGroups, amountText, barShare, reportHint, type BandFigure } from "./reports-parts";
import { reportAccountPath } from "./reports-screen";
import { BalanceDateSheet, useLatePick } from "./reports-sheets";

/** A fixture: today, and the reads as they would come back. */
export type BalanceSample = {
  today: string;
  balance?: BalanceSheet;
  /** The by-project statement of all time: the projects the by-project view reads a sheet for. */
  projects?: Statement;
  /** Each project's own sheet, as useProjectBalances returns them. */
  projectSheets?: BalanceSheet[];
  /** The drilled property's sheet. */
  drilled?: BalanceSheet;
  phase?: ScreenPhase;
  offlineSince?: number;
};

const VIEWS: { value: BalanceView; label: string; short: string }[] = [
  { value: "assets", label: "נכסים", short: "נכסים" },
  { value: "liabilities", label: "התחייבויות והון", short: "התחייבויות" },
  { value: "project", label: "פרויקט", short: "פרויקט" },
];

/** One side of a sheet as a group: each account a row that opens its movements. */
function sideGroup(key: string, title: string, side: BalanceSide, extra: ViewGroup["rows"] = []): ViewGroup {
  const rows: ViewGroup["rows"] = side.accounts.map((account) => ({ key: account.account_id, name: accountName(account), amount: account.balance_minor, tone: "cost" }));
  return { key, title, total: side.total_minor + extra.reduce((sum, row) => sum + row.amount, 0n), tone: "cost", rows: [...rows, ...extra] };
}

/** Equity with the running profit, the row the P&L adds to it. */
function equityGroup(row: BalanceCurrency): ViewGroup {
  const earned = row.retained_earnings_minor === 0n ? [] : [{ key: "retained", name: "רווח שנצבר", amount: row.retained_earnings_minor, tone: "net" as const, hint: "מרווח והפסד" }];
  return sideGroup("equity", "הון", row.equity, earned);
}

/**
 * FLOW-1045 (board V3-Report, kind bs): the balance sheet. The band carries the date chip and the equity,
 * assets and liabilities under it; a docking control picks the view: assets, liabilities and equity, or by
 * project (one mcp_balance_sheet per project, BUILD-PLAN §5), where a property row drills into its own sheet.
 */
export function BalanceReportScreen({ sample }: { sample?: BalanceSample } = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const online = useOnline();
  const today = sample?.today ?? israelToday();
  const route = useMemo(() => balanceRouteOf(new URLSearchParams(location.search)), [location.search]);
  const live = sample == null;
  const asOf = balanceDate(route.asOf, today);
  const drilledId = route.project;
  const byProject = route.view === "project" && drilledId == null;
  const [shareOpen, setShareOpen] = useState(false);

  const companyRead = useBalanceAt(asOf, null, live);
  const projectsRead = usePnl({ from: null, to: null }, null, true, live && (byProject || shareOpen));
  const statement = live ? projectsRead.data : sample.projects;
  const ids = (statement?.projects ?? []).flatMap((project) => (project.project_id == null ? [] : [project.project_id]));
  const sheetsRead = useProjectBalances(asOf, ids, live && byProject && statement != null);
  const drillRead = useBalanceAt(asOf, drilledId, live && drilledId != null);
  const company = live ? companyRead.data : sample.balance;
  const sheets = live ? (statement == null ? undefined : sheetsRead.data) : sample.projectSheets;
  const drilled = live ? drillRead.data : sample.drilled;

  const go = (next: BalanceRoute) => {
    void navigate(balancePath(next, search), { replace: true });
  };
  const date = useLatePick<BalanceRoute["asOf"]>((next) => { go({ asOf: next, view: route.view, project: null }); });
  const top = company?.currencies[0];
  const base = top?.currency ?? "ILS";
  const drilledRow = drilledId == null ? null : drilled == null ? undefined : (drilled.currencies.find((row) => row.currency === base) ?? drilled.currencies[0]);
  const bandRead = drilledId == null ? companyRead : drillRead;
  const bandData = drilledId == null ? company : drilled;
  const phase: ScreenPhase = sample?.phase ?? (!live ? { kind: "ready" } : preview !== "off" ? screenPhase(preview) : bandRead.failed && bandData == null ? { kind: "error", offline: !online } : bandData == null ? { kind: "loading" } : { kind: "ready" });
  const offlineSince = sample != null ? (sample.offlineSince ?? null) : !online && preview === "off" ? (bandRead.readAt || null) : null;
  const empty = phase.kind === "empty" || (company != null && balanceEmpty(company));
  const shownRow = drilledId == null ? top : drilledRow;
  const shownEquity = shownRow == null ? null : drilledId == null ? equityTotal(shownRow) : sheetEquity(shownRow);
  const figure: BandFigure | null = phase.kind === "ready" && shownRow != null && shownEquity != null ? { amount: shownEquity, currency: shownRow.currency, loss: shownEquity < 0n } : phase.kind === "empty" ? { amount: 0n, currency: base, loss: false } : null;
  const name = drilledId == null ? "מאזן" : (drilled?.project_name ?? statement?.projects.find((item) => item.project_id === drilledId)?.name ?? "פרויקט");
  const undrill = () => {
    const state: unknown = location.state;
    if (typeof state === "object" && state != null && "reportDrill" in state) void navigate(-1);
    else go({ ...route, project: null });
  };
  const accountHref = (currency: string) => (row: ViewGroup["rows"][number]) => (row.key === "retained" ? undefined : reportAccountPath(location.search, row.key, currency));

  let body;
  if (phase.kind === "loading" || (drilledId != null && drilledRow === undefined)) {
    body = <ReportRowsSkeleton />;
  } else if (empty && drilledId == null) {
    body = <EmptyState icon={<DocumentIcon size={28} />} title="אין עדיין יתרות במאזן" body="אין עדיין תנועות עד התאריך הזה." action={<Button onClick={() => { date.setOpen(true); }}>בחירת תאריך אחר</Button>} />;
  } else if (drilledId != null && drilledRow != null) {
    body = (
      <>
        <ViewGroups id="bs-drill" groups={[sideGroup("assets", "נכסים", drilledRow.assets), sideGroup("liabilities", "התחייבויות", drilledRow.liabilities)]} currency={drilledRow.currency} href={accountHref(drilledRow.currency)} />
        <ReportBottomLine label="הון עצמי" amount={sheetEquity(drilledRow)} currency={drilledRow.currency} />
        <ReportGoOn label="לדף הפרויקט" to={`/projects/${drilledId}${search}`} />
      </>
    );
  } else if (top != null && route.view === "project") {
    if (sheets == null) {
      body = projectsRead.failed || sheetsRead.failed ? <FailureLine offline={!online} onRetry={() => { projectsRead.refetch(); sheetsRead.refetch(); }} /> : <ReportRowsSkeleton />;
    } else {
      const rows = balanceProjectRows(top, sheets);
      body = (
        <>
          <section className="ui-month ui-rep-v3-group" aria-labelledby="bs-projects">
            <GroupHead id="bs-projects" title="הון עצמי לפי פרויקט" summary={<bdi dir="ltr">{amountText(equityTotal(top), base)}</bdi>} />
            <List>
              {rows.map((row) => {
                const to = row.projectId == null ? undefined : balancePath({ ...route, project: row.projectId }, search);
                return (
                  <ListRow
                    key={row.key}
                    variant="project"
                    title={row.name}
                    wrapTitle
                    hint={reportHint(row.projectId == null ? "מזומן ושאר החשבונות, פחות מה שלא שייך לנכס" : `שווי ${amountText(row.assets, base)} · הלוואות ${amountText(row.liabilities, base)}`, row.equity > 0n && rows.length > 1 ? { share: barShare(row.equity, equityTotal(top)) } : undefined)}
                    {...(to == null ? {} : { href: to, state: { reportDrill: true } })}
                    chevron={to != null}
                    chevronSpace={to == null}
                    agorot={row.equity}
                    currency={base}
                    loss={row.equity < 0n}
                  />
                );
              })}
            </List>
          </section>
          <ReportBottomLine label="הון עצמי" amount={equityTotal(top)} currency={base} />
        </>
      );
    }
  } else if (company != null) {
    body = (
      <>
        {company.currencies.map((row, index) => (
          <div key={row.currency} className="ui-rep-v3-currency">
            {index > 0 ? <h2 className="t-section ui-rep-currency-title">{`ב־${row.currency}`}</h2> : null}
            <BalanceWarningCard row={row} fixHref={`/settings/categories${search}`} />
            <ViewGroups
              id={`bs-${row.currency}`}
              groups={route.view === "assets" ? [sideGroup("assets", "נכסים", row.assets)] : [sideGroup("liabilities", "התחייבויות", row.liabilities), equityGroup(row)]}
              currency={row.currency}
              href={accountHref(row.currency)}
              bars={(group) => group.key !== "equity"}
            />
            <ReportBottomLine label="הון עצמי" amount={equityTotal(row)} currency={row.currency} />
          </div>
        ))}
      </>
    );
  }

  const balanced = top != null && top.balanced && top.warnings.length === 0;
  const ready = phase.kind === "ready" && !empty;
  return (
    <>
      <ReportShell
        name={name}
        back={drilledId == null ? { kind: "hub", to: `/reports${search}` } : { kind: "undrill", label: "לפי פרויקט", onBack: undrill }}
        pill={{ label: balanceChipLabel(route.asOf, today), onOpen: () => { date.setOpen(true); } }}
        figureLabel="הון עצמי"
        figure={figure}
        {...(drilledId == null ? (balanced ? { figureSub: "מאוזן · נכסים = התחייבויות + הון" } : {}) : top == null ? {} : { figureSub: `מתוך הון עצמי ${amountText(equityTotal(top), top.currency)}` })}
        rows={shownRow == null ? [] : [{ label: "נכסים", amount: shownRow.total_assets_minor }, { label: "התחייבויות", amount: shownRow.liabilities.total_minor }]}
        onShare={ready ? () => { setShareOpen(true); } : null}
        control={drilledId == null ? (onBand, scrollUnderBar) => (
          <SegmentedControl<BalanceView>
            label="תצוגה"
            showLabel={false}
            tone={onBand ? "band" : "page"}
            value={route.view}
            options={VIEWS}
            onChange={(view) => { go({ ...route, view, project: null }); scrollUnderBar(); }}
          />
        ) : null}
        offlineSince={offlineSince}
        failed={phase.kind === "error" ? { offline: phase.offline, onRetry: bandRead.refetch } : null}
      >
        {body}
        {phase.kind === "ready" ? <p className="ui-rep-note">דוח ניהולי, לא דוח כספי מבוקר.</p> : null}
      </ReportShell>
      <BalanceDateSheet open={date.open} onOpenChange={date.onOpenChange} value={route.asOf} today={today} onPick={date.pick} />
      <ReportShareSheet open={shareOpen} onOpenChange={setShareOpen} state={shareStateOf("balance", { kind: "year" }, route.asOf, drilledId, false)} today={today} projects={statement?.projects ?? []} />
    </>
  );
}
