import { formatAmountText, type CashLine, type ProjectDetail } from "@flow/shared";
import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { projectExpenseMinor, projectRows } from "../by-currency";
import { cashMonthName } from "../cash";
import { groupLines, lineInitials, linesOrder, sideMinor, type LinesOrder } from "../cash-lines-groups";
import { useCompanyCurrency } from "../company-currency";
import { monthPeriod } from "../period";
import { useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase } from "../query-phase";
import { useProjectCashMonthLinesQuery } from "../project-cash";
import { useProjectQuery } from "../use-books";
import { Amount } from "../ui/amount";
import { Card } from "../ui/card";
import { Chip } from "../ui/chip";
import { formatDayMonth, israelToday } from "../ui/date-math";
import { rowSource } from "../ui/line-marks";
import { List, ListRow } from "../ui/list-row";
import { OrganizeChips } from "../ui/organize-chips";
import { ProfitSkeleton } from "../ui/screen-skeletons";
import { ScreenState } from "../ui/screen-state";
import { SummaryRow } from "./project-profit-screen";

export type ProjectMonthProfitSample = { project: NonNullable<ProjectDetail>; month: string; lines: CashLine[] };

const ORDERS: readonly { key: LinesOrder; label: string }[] = [
  { key: "date", label: "לפי תאריך" },
  { key: "amount", label: "לפי סכום" },
  { key: "category", label: "לפי קטגוריה" },
];

/**
 * FLOW-140 slice 2, the ProfitMonth frame: a project's profit for one month, its four-figure card, and the
 * month's counted lines. The chips live in the URL (`order=`), so Back from a line restores the order. The
 * per-month share of the general expenses is not on the server yet, so the card shows the income and the
 * expenses that count, and the profit it leaves (a named exception on the PR).
 */
export function ProjectMonthProfitScreen({ sample }: { sample?: ProjectMonthProfitSample } = {}) {
  const params = useParams();
  const projectId = sample?.project.id ?? params.projectId ?? "";
  const month = sample?.month ?? params.month ?? "";
  const location = useLocation();
  const navigate = useNavigate();
  const search = usePreviewSearch();
  const preview = useHomePreview();
  const companyCurrency = useCompanyCurrency();
  const period = monthPeriod(month);
  const detail = useProjectQuery(sample ? "" : projectId, period);
  const project = sample?.project ?? detail.data ?? null;
  const figures = project == null ? null : projectRows(project, companyCurrency)[0] ?? null;
  const currency = figures?.currency ?? companyCurrency;
  const linesRead = useProjectCashMonthLinesQuery(sample ? "" : projectId, month, currency, !sample && figures != null);
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, detail);
  const counted = sample?.lines ?? linesRead.data?.counted ?? [];
  const today = israelToday();
  const open = month === today.slice(0, 7);
  const requested = linesOrder(new URLSearchParams(location.search).get("order"));
  const order: LinesOrder = requested === "project" ? "date" : requested;
  const groups = groupLines(counted, order, "kept", today);
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(() => new Set());
  const id = sample ? sample.project.id : projectId;
  const backTo = `/projects/${id}/profit${search}`;
  const sub = project == null
    ? undefined
    : `${project.name} · ${open ? `עד היום, ${formatDayMonth(today)}` : "חודש סגור"} · ${String(counted.length)} תנועות`;

  const setOrder = (next: LinesOrder) => {
    const params = new URLSearchParams(location.search);
    if (next === "date") params.delete("order");
    else params.set("order", next);
    const query = params.toString();
    void navigate({ pathname: location.pathname, search: query === "" ? "" : `?${query}` }, { replace: true });
  };
  const toggle = (key: string) => {
    setOpenKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <ScreenState
      title={`רווח ${cashMonthName(month)}`}
      kicker={project?.name}
      subtitle={sub}
      backTo={backTo}
      phase={phase}
      onRetry={() => { void detail.refetch(); }}
      loading={<ProfitSkeleton />}
    >
      {figures == null ? null : (
        <div>
          <p className="ui-pp-figure ui-page-pad">
            <Amount agorot={figures.profit_minor} currency={currency} size="display" loss={figures.profit_minor < 0n} />
          </p>
          <Card className="ui-pp-card">
            <SummaryRow label="הכנסות" value={<Amount agorot={figures.income_minor} currency={currency} income />} />
            <SummaryRow label="הוצאות שנספרות ברווח" value={<Amount agorot={projectExpenseMinor(figures)} currency={currency} />} />
          </Card>
          <OrganizeChips label="סידור" className="ui-pp-chips">
            {ORDERS.map((option) => (
              <Chip key={option.key} pressed={order === option.key} onClick={() => { setOrder(option.key); }}>{option.label}</Chip>
            ))}
          </OrganizeChips>
          {counted.length === 0 ? <p className="ui-pp-note t-hint">אין תנועות בחודש הזה.</p> : null}
          {groups.map((group) => {
            const expanded = order !== "category" || openKeys.has(group.key);
            const head = (
              <>
                <h2 className="t-section ui-lines-group-title">{group.title}</h2>
                {group.total == null ? null : <GroupSum total={group.total} currency={currency} />}
              </>
            );
            return (
              <section key={group.key} className="ui-lines-group" aria-label={group.title}>
                {order === "category" ? (
                  <button type="button" className="ui-lines-group-head" aria-expanded={expanded} onClick={() => { toggle(group.key); }}>
                    {head}
                  </button>
                ) : (
                  <div className="ui-lines-group-head">{head}</div>
                )}
                {expanded ? (
                  <List layout="flat">
                    {group.rows.map((line) => {
                      const name = line.supplier_name ?? line.description;
                      const minor = sideMinor(line, "kept");
                      return (
                        <ListRow
                          key={`${line.transaction_id}:${line.part ?? ""}`}
                          layout="flat"
                          variant="transaction"
                          title={name}
                          hint={order === "category" ? formatDayMonth(line.cash_month_date) : (line.category_name ?? "")}
                          agorot={minor < 0n ? -minor : minor}
                          currency={line.currency}
                          sign={line.side}
                          source={rowSource(line.source)}
                          initials={lineInitials(name)}
                          href={`/transactions/${line.transaction_id}${search}`}
                        />
                      );
                    })}
                  </List>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </ScreenState>
  );
}

/** A group's sum on the page's side: a plus on profit, a minus on a loss. */
function GroupSum({ total, currency }: { total: bigint; currency: string }) {
  const sign = total < 0n ? "−" : total > 0n ? "+" : "";
  return <bdi className="t-line2 ui-lines-group-sum" dir="ltr">{`${sign}${formatAmountText(total < 0n ? -total : total, currency, { detail: true })}`}</bdi>;
}
