import "../ui/lazy.css";
import type { ProjectCashRow } from "@flow/shared";
import { useState } from "react";
import { Link } from "react-router-dom";
import { cashMonthName, NOT_IN_PROFIT_LABEL } from "../cash";
import { lineInitials } from "../cash-lines-groups";
import { companyForecastCaption, type CompanyForecastPart } from "../company-next-month";
import type { CompanyNextMonthSample } from "../company-next-month-query";
import { useCompanyCurrency } from "../company-currency";
import { useHomePreview, usePreviewSearch } from "../preview";
import { useProjectsCashMonth } from "../project-cash";
import { orderActiveProjects } from "../project-list";
import { LOAN_SOURCE, type NextMonthRow } from "../project-next-month";
import { useHoldWrites } from "../use-is-viewer";
import { Amount } from "../ui/amount";
import { Card } from "../ui/card";
import { israelToday } from "../ui/date-math";
import { forecastWords } from "../ui/forecast-words";
import { ChevronIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { ProfitSkeleton } from "../ui/screen-skeletons";
import { ScreenState } from "../ui/screen-state";
import { useCompanyCashNextMonth } from "./company-cash-next-month";
import { SummaryRow } from "./profit-summary";
import { editPath, rowSource } from "./project-next-month-screen";

const CASH = forecastWords("cash");
const PROFIT = forecastWords("profit");
/** Each project's rows the page shows before "עוד N בצפי של …". */
const SHOWN = 3;
const NOTE = "הצפי של כל פרויקט, וההוצאות הכלליות. נגיעה בשורה פותחת את העריכה שלה בפרויקט.";

/** A part's rows as its project's צפי page lists them: its rows, then the payment the profit leaves out. */
type PartRow = { kind: "row"; row: NextMonthRow } | { kind: "kept"; minor: bigint };

function partRows(part: CompanyForecastPart): PartRow[] {
  const rows: PartRow[] = part.forecast.rows.map((row) => ({ kind: "row", row }));
  return part.forecast.cashOnlyMinor === 0n ? rows : [...rows, { kind: "kept", minor: part.forecast.cashOnlyMinor }];
}

/** The parts in the Projects tab's order (unknown ones after them), the general costs last. */
function orderParts(parts: readonly CompanyForecastPart[], projects: readonly ProjectCashRow[], currency: string): CompanyForecastPart[] {
  const order = orderActiveProjects([...projects], currency).map((row) => row.id);
  const rank = (part: CompanyForecastPart) => {
    if (part.projectId == null) return Number.MAX_SAFE_INTEGER;
    const at = order.indexOf(part.projectId);
    return at === -1 ? order.length : at;
  };
  return [...parts].sort((a, b) => rank(a) - rank(b));
}

/**
 * FLOW-1000 (board CompanyNextA, owner's pick 2026-10-31; decision 0237): the company's צפי page, which the
 * next-month card on Home and on the Projects tab opens. The figure is תזרים צפוי (the cards' cash) and the
 * summary is a project צפי page's (decision 0236). Then one section per project in the Projects tab's order, the
 * general costs (כללי) last: its name and its own צפי net (its row's figure on Projects; the header opens the
 * project), its first three rows, and "עוד N בצפי של …" to that project's צפי page. A project's row opens its
 * existing edit page; the general costs' rows are read only, since no project's page holds them.
 */
export function CompanyNextMonthScreen({ sample, today: sampleToday, projects: sampleProjects, currency: sampleCurrency }: {
  sample?: CompanyNextMonthSample;
  /** With a sample: the company's currency. */
  currency?: string;
  /** yyyy-mm-dd, with a sample: the day the sample is from. */
  today?: string;
  /** With a sample: the Projects tab's rows, for the names and the order. */
  projects?: ProjectCashRow[];
} = {}) {
  const search = usePreviewSearch();
  const preview = useHomePreview();
  const holdRole = useHoldWrites();
  const hold = sample == null && holdRole;
  const companyCurrency = useCompanyCurrency();
  const list = useProjectsCashMonth();
  const projects = sampleProjects ?? list.data?.projects ?? [];
  const currency = sampleCurrency ?? list.data?.base_currency ?? companyCurrency;
  const today = sampleToday ?? israelToday();
  const next = useCompanyCashNextMonth(currency, today, sample == null && list.data != null, sample);
  const [figure, setFigure] = useState<HTMLElement | null>(null);
  const forecast = next.forecast;
  const phase = sample != null
    ? ({ kind: "ready" } as const)
    : preview !== "off"
      ? ({ kind: "empty" } as const)
      : list.isError || next.failed
        ? ({ kind: "error", offline: false } as const)
        : list.data == null || next.loading
          ? ({ kind: "loading" } as const)
          : ({ kind: "ready" } as const);
  const title = forecast == null ? "צפי" : `צפי ${cashMonthName(forecast.month, new Date(`${today}T12:00:00Z`))}`;
  const count = forecast == null ? 0 : forecast.rows.length;
  const caption = forecast == null ? "" : companyForecastCaption(forecast);
  const sub = forecast == null ? undefined : ["כל החברה", caption, `${String(count)} צפויות`].filter((part) => part !== "").join(" · ");
  const keptOut = forecast == null ? 0n : forecast.parts.reduce((sum, part) => sum + part.forecast.cashOnlyMinor, 0n);
  const profit = forecast == null ? 0n : forecast.netMinor + keptOut;
  const names = new Map(projects.map((row) => [row.id, row.name]));
  const overhead = projects.find((row) => row.is_overhead) ?? null;

  return (
    <ScreenState
      title={title}
      kicker="בית"
      subtitle={sub}
      backTo={`/${search}`}
      headerClassName="ui-pp-head"
      headEnd={figure}
      phase={phase}
      onRetry={() => { void list.refetch(); }}
      loading={<ProfitSkeleton />}
      empty={<p className="ui-pp-note t-caption t-muted">אין עדיין מספיק נתונים לצפי</p>}
    >
      {forecast == null || forecast.parts.length === 0 ? (
        <div className="ui-pm-month">
          <p className="ui-pp-note t-caption t-muted">אין תנועות צפויות בחודש הבא.</p>
        </div>
      ) : (
        <div className="ui-pm-month">
          <p className="ui-pn-figure-label ui-page-pad t-caption t-muted">{CASH.net}</p>
          <p ref={setFigure} className="ui-pp-figure ui-page-pad">
            <Amount agorot={forecast.netMinor} currency={currency} size="display" loss={forecast.netMinor < 0n} direction={forecast.netMinor > 0n ? "income" : undefined} />
          </p>
          <Card className="ui-pp-card">
            <SummaryRow label={CASH.income} value={<Amount agorot={forecast.incomeMinor} currency={currency} income />} />
            <SummaryRow label={CASH.expense} value={<Amount agorot={forecast.expenseMinor} currency={currency} />} />
            {keptOut === 0n ? null : <SummaryRow label={`מזה ${NOT_IN_PROFIT_LABEL}`} value={<Amount agorot={keptOut} currency={currency} />} />}
            {keptOut === 0n ? null : (
              <SummaryRow label={PROFIT.net} value={<Amount agorot={profit} currency={currency} loss={profit < 0n} direction={profit > 0n ? "income" : undefined} />} />
            )}
          </Card>
          <p className="ui-pp-note t-caption t-muted">{NOTE}</p>
          {orderParts(forecast.parts, projects, currency).map((part) => {
            const general = part.projectId == null;
            const name = general ? "כללי" : names.get(part.projectId ?? "") ?? "פרויקט";
            const projectId = general ? overhead?.id ?? null : part.projectId;
            const rows = partRows(part);
            const more = rows.length - SHOWN;
            const net = part.forecast.netMinor;
            const head = (
              <>
                <h2 className="ui-cn-name">{name}</h2>
                <span className="ui-fc-tag">צפי</span>
                <Amount agorot={net} currency={currency} income={net > 0n} />
                {projectId == null ? null : <ChevronIcon size={18} />}
              </>
            );
            return (
              <section key={part.projectId ?? "general"} className="ui-cn-group" aria-label={`${name}, צפי`}>
                {projectId == null ? <div className="ui-cn-head ui-page-pad">{head}</div> : (
                  <Link to={`/projects/${projectId}${search}`} className="ui-cn-head ui-page-pad ui-hit m-press">{head}</Link>
                )}
                <List layout="flat" className="ui-pn-rows">
                  {rows.slice(0, SHOWN).map((item) => (item.kind === "kept" ? (
                    <ListRow
                      key="kept"
                      layout="flat"
                      variant="transaction"
                      title={NOT_IN_PROFIT_LABEL}
                      hint={LOAN_SOURCE}
                      agorot={item.minor}
                      currency={currency}
                      sign="out"
                      source="bank"
                      initials={lineInitials(NOT_IN_PROFIT_LABEL)}
                    />
                  ) : (
                    <ListRow
                      key={item.row.key}
                      layout="flat"
                      variant="transaction"
                      title={item.row.name}
                      hint={rowSource(item.row, part.forecast.averageMonths, part.forecast.month)}
                      agorot={item.row.minor < 0n ? -item.row.minor : item.row.minor}
                      currency={currency}
                      sign={item.row.minor < 0n ? "out" : "in"}
                      source="bank"
                      initials={lineInitials(item.row.name)}
                      href={hold || general || part.projectId == null ? undefined : `${editPath(part.projectId, item.row.key)}${search}`}
                    />
                  )))}
                </List>
                {more <= 0 || projectId == null || general ? null : (
                  <Link to={`/projects/${projectId}/profit/next${search}`} className="ui-cn-more ui-page-pad ui-hit">
                    {`עוד ${String(more)} בצפי של ${name}`}
                    <ChevronIcon size={16} />
                  </Link>
                )}
              </section>
            );
          })}
        </div>
      )}
    </ScreenState>
  );
}
