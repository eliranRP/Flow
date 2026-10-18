import { useParams } from "react-router-dom";
import { projectRows } from "../by-currency";
import { cashMonthName } from "../cash";
import { lineInitials } from "../cash-lines-groups";
import { useCompanyCurrency } from "../company-currency";
import { allTime } from "../period";
import { useHomePreview, usePreviewSearch } from "../preview";
import { monthlyOverheadShare, type NextMonthRow } from "../project-next-month";
import { useNextMonthForecast } from "../project-next-month-query";
import { screenPhase } from "../query-phase";
import { useProfitMonthsQuery, useProjectQuery } from "../use-books";
import { Amount } from "../ui/amount";
import { Card } from "../ui/card";
import { formatDayMonth } from "../ui/date-math";
import { List, ListRow } from "../ui/list-row";
import { ProfitSkeleton } from "../ui/screen-skeletons";
import { ScreenState } from "../ui/screen-state";
import { SummaryRow, type ProjectProfitSample } from "./project-profit-screen";

export type ProjectNextMonthSample = ProjectProfitSample & { next: NonNullable<ProjectProfitSample["next"]> };

const NOTE = "לפי הקבועים של הנכס וממוצע שאר ההוצאות ב־6 החודשים האחרונים. מתעדכן כשהתנועות מגיעות.";

function rowHint(row: NextMonthRow): string {
  return row.date == null ? "ממוצע 6 חודשים" : `צפוי ${formatDayMonth(row.date)} · קבוע`;
}

/**
 * The ProfitNext frame: a project's forecast for next month, opened from the dashed card on its profit page.
 * The card's four rows are the expected income and expenses, the project's average monthly share of general
 * expenses (its share since the start over its months, as the profit page shows it) and the profit after it.
 * Then the expected rows: recurring charges by their day, the category averages last. No chips, no grouping.
 */
export function ProjectNextMonthScreen({ sample }: { sample?: ProjectNextMonthSample } = {}) {
  const params = useParams();
  const projectId = sample?.project.id ?? params.projectId ?? "";
  const search = usePreviewSearch();
  const preview = useHomePreview();
  const companyCurrency = useCompanyCurrency();
  const whole = allTime();
  const detail = useProjectQuery(sample ? "" : projectId, whole);
  const months = useProfitMonthsQuery(sample ? "" : projectId, whole);
  const project = sample?.project ?? detail.data ?? null;
  const monthRows = sample?.months.months ?? months.data?.months ?? [];
  const figures = project == null ? null : projectRows(project, companyCurrency)[0] ?? null;
  const currency = figures?.currency ?? companyCurrency;
  const next = useNextMonthForecast(projectId, currency, sample?.next, sample == null && figures != null);
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
  const net = forecast?.netMinor ?? 0n;
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
      phase={phase}
      onRetry={() => {
        void detail.refetch();
        void months.refetch();
        next.refetch();
      }}
      loading={<ProfitSkeleton />}
    >
      {forecast == null ? null : (
        <div className="ui-pm-month">
          <p className="ui-pp-figure ui-page-pad">
            <Amount agorot={net} currency={currency} size="display" loss={net < 0n} direction={net > 0n ? "income" : undefined} />
          </p>
          <Card className="ui-pp-card">
            <SummaryRow label="הכנסות צפויות" value={<Amount agorot={forecast.incomeMinor} currency={currency} income />} />
            <SummaryRow label="הוצאות צפויות" value={<Amount agorot={forecast.expenseMinor} currency={currency} />} />
            {monthShare == null ? null : <SummaryRow label="חלק בהוצאות הכלליות" value={<Amount agorot={monthShare} currency={currency} />} />}
            {after == null ? null : (
              <SummaryRow strong label="רווח אחרי הוצאות כלליות" value={<Amount agorot={after} currency={currency} loss={after < 0n} />} />
            )}
          </Card>
          <p className="ui-pp-note t-caption t-muted">{NOTE}</p>
          {forecast.rows.length === 0 ? <p className="ui-pp-note t-caption t-muted">אין תנועות צפויות בחודש הזה.</p> : (
            <List layout="flat" className="ui-pn-rows">
              {forecast.rows.map((row) => (
                <ListRow
                  key={row.key}
                  layout="flat"
                  variant="transaction"
                  title={row.name}
                  hint={rowHint(row)}
                  agorot={row.minor < 0n ? -row.minor : row.minor}
                  currency={currency}
                  sign={row.minor < 0n ? "out" : "in"}
                  source="bank"
                  initials={lineInitials(row.name)}
                />
              ))}
            </List>
          )}
        </div>
      )}
    </ScreenState>
  );
}
