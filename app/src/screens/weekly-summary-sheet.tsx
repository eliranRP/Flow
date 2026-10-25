import { formatAmountText, type WeeklySummary } from "@flow/shared";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { onlineManager } from "@tanstack/react-query";
import { Amount } from "../ui/amount";
import { Button } from "../ui/button";
import { EmptyState, FailureLine } from "../ui/empty-state";
import { CalendarIcon, CheckIcon, ChevronIcon } from "../ui/icons";
import { Sheet } from "../ui/sheet";
import { DelayedSkeleton, Skeleton } from "../ui/skeleton";
import { useWeeklySummaryQuery } from "../use-weekly-summary";
import {
  budgetPercent,
  countedNote,
  countsText,
  moreOverBudgetText,
  profitChange,
  reviewLabel,
  searchWithoutWeek,
  weekFromSearch,
  weekLabel,
} from "../weekly-summary";
import "../ui/css/57-weekly-summary.css";

export type WeeklySummaryState =
  | { kind: "loading" }
  | { kind: "error"; offline: boolean }
  | { kind: "ready"; summary: WeeklySummary };

/** The blocks rise in one after another, 40ms apart from 120ms (the board's spec note). */
function enter(index: number): CSSProperties {
  return { "--i": index } as CSSProperties;
}

/**
 * FLOW-517: the weekly summary, a sheet over Home that the Sunday push opens (board: "Weekly
 * summary", page "Ready for dev"). Pure: WeeklySummaryRoute supplies the read; stories pass a state.
 */
export function WeeklySummarySheet({
  open,
  onOpenChange,
  onClosed,
  weekStart,
  state,
  search = "",
  onRetry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** After the close animation: the route drops `?week=` then. */
  onClosed?: () => void;
  weekStart: string;
  state: WeeklySummaryState;
  search?: string;
  onRetry?: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} onClosed={onClosed} title="סיכום שבועי" subtitle={weekLabel(weekStart)} panelClassName="ui-sheet-wide">
      <div className="ui-weekly" dir="rtl">
        {state.kind === "loading" ? <WeeklySkeleton /> : null}
        {state.kind === "error" ? (
          <FailureLine
            offline={state.offline}
            onRetry={() => {
              onRetry?.();
            }}
          />
        ) : null}
        {state.kind === "ready" ? <WeeklyBody summary={state.summary} search={search} /> : null}
      </div>
    </Sheet>
  );
}

function WeeklyBody({ summary, search }: { summary: WeeklySummary; search: string }) {
  const { currency } = summary;
  const empty = summary.lines === 0;
  const change = profitChange(summary);
  const note = countedNote(summary);
  const profitTone = summary.profit_minor < 0n ? "loss" : summary.profit_minor === 0n ? "zero" : "plain";
  return (
    <>
      <section className="ui-weekly-block ui-weekly-profit" style={enter(0)} aria-label="רווח השבוע">
        <p className="ui-weekly-label">רווח השבוע</p>
        <div className="ui-weekly-figure-row ui-amount-fit">
          <span className="ui-weekly-figure" data-tone={profitTone}>
            <Amount agorot={summary.profit_minor} currency={currency} size="display" loss={profitTone === "loss"} />
          </span>
          {change == null ? null : <WeeklyChangePill minor={change.minor} tone={change.tone} currency={currency} />}
        </div>
        {note == null ? null : <p className="ui-weekly-note">{note}</p>}
      </section>

      {empty ? (
        <div className="ui-weekly-block" style={enter(1)}>
          <EmptyState
            icon={<CalendarIcon size={28} stroke={1.9} />}
            title="לא נכנסו תנועות השבוע"
            body="לא הגיעה אף תנועה מהבנק או מ־SUMIT. אם חיכית לתשלום, כדאי לבדוק את החיבור."
          />
        </div>
      ) : (
        <dl className="ui-weekly-block ui-weekly-totals" style={enter(1)}>
          <WeeklyRow label="נכנס">
            <Amount agorot={summary.in_minor} currency={currency} size="list" income={summary.in_minor > 0n} />
          </WeeklyRow>
          <WeeklyRow label="יצא">
            <Amount agorot={summary.out_minor} currency={currency} size="list" />
          </WeeklyRow>
          {summary.kept_out_minor === 0n ? null : (
            <WeeklyRow label="לא נספר ברווח" sub="שיפוץ והשבחה, הון בעלים ועוד">
              <Amount agorot={summary.kept_out_minor} currency={currency} size="list" />
            </WeeklyRow>
          )}
        </dl>
      )}

      {summary.alert == null ? null : (
        <Link to={`/projects/${summary.alert.project_id}${search}`} className="ui-weekly-block ui-weekly-alert m-press" style={enter(2)}>
          <span className="ui-weekly-dot" aria-hidden="true" />
          <span className="ui-weekly-alert-text">
            <span className="ui-weekly-alert-title">{`${summary.alert.name} עבר את התקציב`}</span>
            <span className="ui-weekly-alert-sub">
              <bdi dir="ltr">{formatAmountText(summary.alert.spent_minor, currency)}</bdi>
              {" מתוך "}
              <bdi dir="ltr">{formatAmountText(summary.alert.budget_minor, currency)}</bdi>
              {` · ${String(budgetPercent(summary.alert.spent_minor, summary.alert.budget_minor))}%`}
            </span>
            {moreOverBudgetText(summary.more_over_budget) == null ? null : (
              <span className="ui-weekly-alert-more">{moreOverBudgetText(summary.more_over_budget)}</span>
            )}
          </span>
          <span className="ui-weekly-chevron" aria-hidden="true">
            <ChevronIcon size={18} />
          </span>
        </Link>
      )}

      {empty ? null : (
        <p className="ui-weekly-block ui-weekly-counts" style={enter(3)}>
          {countsText(summary)}
        </p>
      )}

      <div className="ui-weekly-block ui-weekly-action" style={enter(4)}>
        {summary.waiting > 0 ? (
          <Button full to={`/review${search}`}>{reviewLabel(summary.waiting)}</Button>
        ) : empty ? (
          <Button full variant="secondary" to={`/settings/connections${search}`}>בדיקת החיבור לבנק</Button>
        ) : (
          <p className="ui-weekly-done">
            <span className="ui-weekly-done-icon" aria-hidden="true"><CheckIcon size={18} stroke={2.4} /></span>
            הכול מאושר
          </p>
        )}
      </div>
    </>
  );
}

function WeeklyRow({ label, sub, children }: { label: string; sub?: string; children: ReactNode }) {
  return (
    <div className="ui-weekly-row">
      <dt className="ui-weekly-row-label">
        {label}
        {sub == null ? null : <span className="ui-weekly-row-sub">{sub}</span>}
      </dt>
      <dd className="ui-weekly-row-value">{children}</dd>
    </div>
  );
}

/** The change from the week before: secondary text when profit got better, the signal colour when worse. */
function WeeklyChangePill({ minor, tone, currency }: { minor: bigint; tone: "helps" | "hurts"; currency: string }) {
  const up = minor >= 0n;
  const text = formatAmountText(minor < 0n ? -minor : minor, currency);
  return (
    <span className="ui-weekly-pill" data-tone={tone} aria-label={`${up ? "עלייה" : "ירידה"} של ${text} מול השבוע הקודם`}>
      <span aria-hidden="true">
        {up ? "▲ " : "▼ "}
        <bdi dir="ltr">{text}</bdi>
        {" מול השבוע הקודם"}
      </span>
    </span>
  );
}

function WeeklySkeleton() {
  return (
    <DelayedSkeleton>
      <div className="ui-weekly-skeleton" aria-busy="true" aria-label="טוען את הסיכום">
        <Skeleton width="sm" />
        <Skeleton hero />
        <Skeleton className="ui-weekly-skeleton-box" />
        <Skeleton className="ui-weekly-skeleton-alert" />
        <Skeleton className="ui-weekly-skeleton-button" />
      </div>
    </DelayedSkeleton>
  );
}

/**
 * The live sheet over Home, opened by `?week=<Sunday>` (the push's link). A week that is not a
 * Sunday up to today's opens nothing and is dropped. The sheet opens at once and reads the week;
 * closing it runs the close animation, then drops `?week=` and leaves Home as it is.
 */
export function WeeklySummaryRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  const weekStart = weekFromSearch(location.search);
  const rest = searchWithoutWeek(location.search);
  const drop = () => {
    void navigate({ pathname: location.pathname, search: rest }, { replace: true });
  };
  useEffect(() => {
    if (weekStart == null) drop();
  });
  if (weekStart == null) return null;
  return <WeeklySummaryLive key={weekStart} weekStart={weekStart} onClose={drop} />;
}

function WeeklySummaryLive({ weekStart, onClose }: { weekStart: string; onClose: () => void }) {
  const [open, setOpen] = useState(true);
  const query = useWeeklySummaryQuery(weekStart);
  const state: WeeklySummaryState = query.data != null
    ? { kind: "ready", summary: query.data }
    : query.isError
      ? { kind: "error", offline: !onlineManager.isOnline() }
      : { kind: "loading" };
  return (
    <WeeklySummarySheet
      open={open}
      onOpenChange={setOpen}
      onClosed={onClose}
      weekStart={weekStart}
      state={state}
      onRetry={() => {
        void query.refetch();
      }}
    />
  );
}
