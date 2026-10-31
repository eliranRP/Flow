import "../ui/lazy.css";
import { formatAmountText } from "@flow/shared";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { projectRows } from "../by-currency";
import { cashMonthName, NOT_IN_PROFIT_LABEL } from "../cash";
import { lineInitials } from "../cash-lines-groups";
import { useCompanyCurrency } from "../company-currency";
import { allTime } from "../period";
import { useHomePreview, usePreviewSearch } from "../preview";
import { useProjectForecastWrites } from "../project-forecast-writes";
import { monthWord, PACE_WORDS } from "../project-next-edit";
import { cashForecast, LOAN_SOURCE, monthlyOverheadShare, type NextMonthRow } from "../project-next-month";
import { useProjectNextMonth } from "../next-month-for-project";
import { screenPhase } from "../query-phase";
import { useHoldWrites } from "../use-is-viewer";
import { useProfitMonthsQuery, useProjectQuery } from "../use-books";
import { Amount } from "../ui/amount";
import { forecastWords } from "../ui/forecast-words";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { formatDayMonth } from "../ui/date-math";
import { PlusIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { ProfitSkeleton } from "../ui/screen-skeletons";
import { ScreenState } from "../ui/screen-state";
import type { ProjectProfitSample } from "./project-profit-screen";
import { SummaryRow } from "./profit-summary";

type ProjectNextMonthSample = ProjectProfitSample & { next: NonNullable<ProjectProfitSample["next"]> };

const NOTE = "לפי הקבועים של הנכס וממוצע 6 החודשים האחרונים לכל קטגוריה. נגיעה בשורה משנה אותה או מסירה אותה.";
const CASH = forecastWords("cash");
const PROFIT = forecastWords("profit");
const LOAN_NOTE = "לפי הקבועים של הנכס, לוח ההלוואה וממוצע 6 החודשים האחרונים לכל קטגוריה. נגיעה בשורה משנה אותה או מסירה אותה.";

/** What a row is made of: its day and קבוע, the loan, its average, or the line the user added. */
export function rowSource(row: NextMonthRow, months: number, month: string): string {
  if (row.kind === "loan") return LOAN_SOURCE;
  if (row.kind === "added") return `הוספת · ${row.pace == null || row.pace === "once" ? `רק ב${monthWord(month)}` : PACE_WORDS[row.pace]}`;
  if (row.date != null) return `צפוי ${formatDayMonth(row.date)} · קבוע`;
  return months === 1 ? "ממוצע חודש אחד" : `ממוצע ${String(months)} חודשים`;
}

/** A changed row says so in the accent colour, with Flow's number; an added line says it was added. */
function rowHint(row: NextMonthRow, months: number, month: string, currency: string) {
  if (row.wasMinor != null) {
    const was = formatAmountText(row.wasMinor < 0n ? -row.wasMinor : row.wasMinor, currency);
    return <span className="ui-pn-edited">שינית · היה <bdi dir="ltr">{was}</bdi></span>;
  }
  const source = rowSource(row, months, month);
  return row.kind === "added" ? <span className="ui-pn-edited">{source}</span> : source;
}

/** The edit page's path for a row: its key in the last segment. */
export function editPath(projectId: string, rowKey: string): string {
  return `/projects/${projectId}/profit/next/edit/${encodeURIComponent(rowKey)}`;
}

/**
 * The ProfitNext frame: a project's forecast for next month, opened from the dashed card on its profit page and
 * on its project page. FLOW-994 (decision 0236): the figure is תזרים צפוי, the project page card's cash. The
 * card reads צפוי להיכנס and צפוי לצאת; when the loans' payments hold a part the profit leaves out, it names
 * that part (מזה לא נספר ברווח) and רווח צפוי, the profit page card's net; then the project's average monthly
 * share of general expenses (its share since the start over its months) and the profit after it.
 * Then the expected rows: recurring charges by their day, the loan's interest and escrow, the category averages
 * last, the lines the user added after them, and that part the profit leaves out as the last row (not
 * editable), so the rows add up to the figure. No chips, no grouping. A tap on a row opens its edit page; under the rows, הוספת קטגוריה
 * לצפי, the rows taken out (with החזרה) and חזרה לצפי של Flow. A viewer reads the rows only.
 */
export function ProjectNextMonthScreen({ sample }: { sample?: ProjectNextMonthSample } = {}) {
  const params = useParams();
  const projectId = sample?.project.id ?? params.projectId ?? "";
  const search = usePreviewSearch();
  const preview = useHomePreview();
  const companyCurrency = useCompanyCurrency();
  // The figure ends the page's head: the compact bar waits for it (FLOW-942).
  const [figure, setFigure] = useState<HTMLElement | null>(null);
  const whole = allTime();
  const detail = useProjectQuery(sample ? "" : projectId, whole);
  const months = useProfitMonthsQuery(sample ? "" : projectId, whole);
  const project = sample?.project ?? detail.data ?? null;
  const monthRows = sample?.months.months ?? months.data?.months ?? [];
  const figures = project == null ? null : projectRows(project, companyCurrency)[0] ?? null;
  const currency = figures?.currency ?? companyCurrency;
  const next = useProjectNextMonth(projectId, currency, sample?.next, sample == null && figures != null);
  const holdRole = useHoldWrites();
  const hold = sample == null && holdRole;
  const writes = useProjectForecastWrites(projectId, next.month);
  const phase = sample
    ? ({ kind: "ready" } as const)
    : screenPhase(preview, {
      isPending: detail.isPending || months.isPending || (figures != null && next.pending),
      isError: detail.isError || months.isError || next.failed,
      isPaused: detail.isPaused || months.isPaused || next.paused,
    });
  // The same share as the profit page's, over the months it counts (0117: the project's income sets the weights).
  const share = project?.overhead_weighted === true && (project.base_currency ?? "ILS") === currency
    ? project.overhead_share_minor ?? null
    : null;
  const monthShare = monthlyOverheadShare(share, monthRows.length);
  const forecast = next.forecast;
  // FLOW-994 (owner, 2026-10-30): the page leads with the cash the project page's card shows (decision 0196:
  // the loans' payments the profit leaves out, its principal, are in צפוי לצאת), and names the profit the
  // profit page's card shows under it, so both cards that open it find their number here.
  const cash = forecast == null ? null : cashForecast(forecast);
  const net = forecast?.netMinor ?? 0n;
  const cashNet = cash?.netMinor ?? 0n;
  const keptOut = forecast?.cashOnlyMinor ?? 0n;
  const after = monthShare == null ? null : net - monthShare;
  const title = forecast == null ? "צפי" : `צפי ${cashMonthName(forecast.month)}`;
  const sub = project == null || forecast == null
    ? undefined
    : `${project.name} · עוד לא התחיל · ${String(forecast.rows.length)} צפויות`;

  return (
    <ScreenState
      title={title}
      kicker={project == null ? undefined : `רווח ${project.name}`}
      subtitle={sub}
      backTo={`/projects/${projectId}/profit${search}`}
      headerClassName="ui-pp-head"
      headEnd={figure}
      phase={phase}
      onRetry={() => {
        void detail.refetch();
        void months.refetch();
        next.refetch();
      }}
      loading={<ProfitSkeleton />}
    >
      {forecast == null ? (
        <div className="ui-pm-month">
          <p className="ui-pp-note t-caption t-muted">אין עדיין מספיק נתונים לצפי</p>
        </div>
      ) : (
        <div className="ui-pm-month">
          <p className="ui-pn-figure-label ui-page-pad t-caption t-muted">{CASH.net}</p>
          <p ref={setFigure} className="ui-pp-figure ui-page-pad">
            <Amount agorot={cashNet} currency={currency} size="display" loss={cashNet < 0n} direction={cashNet > 0n ? "income" : undefined} />
          </p>
          <Card className="ui-pp-card">
            <SummaryRow label={CASH.income} value={<Amount agorot={forecast.incomeMinor} currency={currency} income />} />
            <SummaryRow label={CASH.expense} value={<Amount agorot={cash?.expenseMinor ?? 0n} currency={currency} />} />
            {/* The bridge from the cash to the profit, on the card: the part of צפוי לצאת the profit leaves out. */}
            {keptOut === 0n ? null : <SummaryRow label={`מזה ${NOT_IN_PROFIT_LABEL}`} value={<Amount agorot={keptOut} currency={currency} />} />}
            {keptOut === 0n ? null : (
              <SummaryRow label={PROFIT.net} value={<Amount agorot={net} currency={currency} loss={net < 0n} direction={net > 0n ? "income" : undefined} />} />
            )}
            {monthShare == null ? null : <SummaryRow label="חלק בהוצאות הכלליות" value={<Amount agorot={monthShare} currency={currency} />} />}
            {after == null ? null : (
              <SummaryRow strong label="רווח אחרי הוצאות כלליות" value={<Amount agorot={after} currency={currency} loss={after < 0n} />} />
            )}
          </Card>
          <p className="ui-pp-note t-caption t-muted">{forecast.loanCount > 0 ? LOAN_NOTE : NOTE}</p>
          {forecast.rows.length === 0 && keptOut === 0n ? <p className="ui-pp-note t-caption t-muted">אין תנועות צפויות בחודש הזה.</p> : (
            <List layout="flat" className="ui-pn-rows">
              {forecast.rows.map((row) => (
                <ListRow
                  key={row.key}
                  layout="flat"
                  variant="transaction"
                  title={row.name}
                  hint={rowHint(row, forecast.averageMonths, forecast.month, currency)}
                  agorot={row.minor < 0n ? -row.minor : row.minor}
                  currency={currency}
                  sign={row.minor < 0n ? "out" : "in"}
                  source="bank"
                  initials={lineInitials(row.name)}
                  href={hold ? undefined : `${editPath(projectId, row.key)}${search}`}
                />
              ))}
              {keptOut === 0n ? null : (
                <ListRow
                  layout="flat"
                  variant="transaction"
                  title={NOT_IN_PROFIT_LABEL}
                  hint={LOAN_SOURCE}
                  agorot={keptOut}
                  currency={currency}
                  sign="out"
                  source="bank"
                  initials={lineInitials(NOT_IN_PROFIT_LABEL)}
                />
              )}
            </List>
          )}
          {hold ? null : (
            <div className="ui-pn-edits">
              <Link to={`/projects/${projectId}/profit/next/add${search}`} className="ui-pn-add ui-hit m-press">
                <span className="ui-pn-add-mark" aria-hidden="true"><PlusIcon size={18} /></span>
                הוספת קטגוריה לצפי
              </Link>
              {forecast.removed.length === 0 ? null : (
                <section className="ui-pn-off" aria-labelledby="pn-off-title">
                  <h2 id="pn-off-title" className="ui-pn-off-title">{`הוסרו מהצפי · ${String(forecast.removed.length)}`}</h2>
                  {forecast.removed.map((row) => (
                    <div key={row.key} className="ui-pn-off-row">
                      <span className="ui-pn-off-text">
                        <span className="ui-pn-off-name">{row.name}</span>
                        <span className="ui-pn-off-meta">
                          <bdi dir="ltr">{formatAmountText(row.minor < 0n ? -row.minor : row.minor, currency)}</bdi>
                          {` · ${rowSource(row, forecast.averageMonths, forecast.month)}`}
                        </span>
                      </span>
                      <Button
                        variant="link"
                        aria-label={`החזרה לצפי: ${row.name}`}
                        disabled={writes.pending}
                        onClick={() => { writes.mutate({ fn: "restore_project_forecast_row", rowKey: row.key, message: `הוחזר לצפי: ${row.name}` }); }}
                      >
                        החזרה
                      </Button>
                    </div>
                  ))}
                </section>
              )}
              {/* The reset drops the edits made for this month; a paced edit made for an earlier month stays. */}
              {next.edits.some((edit) => edit.start_month === forecast.month) ? (
                <Button
                  variant="link"
                  className="ui-pn-reset"
                  disabled={writes.pending}
                  onClick={() => { writes.mutate({ fn: "reset_project_forecast", message: "חזרת לצפי של Flow" }); }}
                >
                  חזרה לצפי של Flow
                </Button>
              ) : null}
            </div>
          )}
        </div>
      )}
    </ScreenState>
  );
}
