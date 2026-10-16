import { formatAmountText } from "@flow/shared";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { absAgorot } from "../agorot";
import { israelToday, formatDayMonth } from "../ui/date-math";
import { Amount } from "../ui/amount";
import { Avatar } from "../ui/avatar";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { EmptyState } from "../ui/empty-state";
import { RefreshIcon, ReviewIcon } from "../ui/icons";
import { PartsBar } from "../ui/parts-bar";
import { ListRow } from "../ui/list-row";
import { ScreenState } from "../ui/screen-state";
import { unpaidDaysOpen, unpaidIsMarked, unpaidOverdueMinor, unpaidTotals, UNPAID_OVERDUE_DAYS, type UnpaidInvoice, type UnpaidSummary } from "../unpaid";
import { usePreviewSearch } from "../preview";
import { UNPAID_MARKED, useUnpaidActions } from "./unpaid-actions";

/** "לפני N דק׳" for the refresh line; a fresh sync says so without a number. */
function syncedAgo(iso: string, now = Date.now()): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (Number.isNaN(minutes)) return "";
  return minutes < 1 ? "לפני רגע" : `לפני ${String(minutes)} דק׳`;
}

/** The month name for "מאז 1 ב…" (Hebrew, Israel time). */
function unpaidMonthName(iso: string): string {
  return new Intl.DateTimeFormat("he-IL", { month: "long", timeZone: "Asia/Jerusalem" }).format(new Date(`${iso}T12:00:00Z`));
}

/** The bank match line of a row (FLOW-367): the amount and date of the deposit, then the invoice page. */
function unpaidMatchText(invoice: UnpaidInvoice): string | null {
  const match = invoice.match;
  if (match == null) return null;
  const amount = formatAmountText(match.amount_minor, invoice.currency ?? "ILS");
  return `✦ נמצא תשלום תואם בבנק · ${amount} · ${formatDayMonth(match.date)}`;
}

export function UnpaidScreen({ sample, summary }: { sample?: UnpaidInvoice[]; summary?: UnpaidSummary } = {}) {
  const search = usePreviewSearch();
  const actions = useUnpaidActions(sample, summary);
  const { rows, open, all, holdWrites, syncing, phase } = actions;
  const today = israelToday();
  // The totals of the currencies that are owed; the bar and the over-30 line speak of the first one.
  const totals = unpaidTotals(all).filter((total) => total.minor !== 0n);
  const primary = totals[0];
  const primaryCurrency = primary?.currency ?? "ILS";
  const oldest = open.length > 0 ? Math.max(...open.map((row) => unpaidDaysOpen(row.doc_date, today))) : 0;
  const overdue = useMemo(() => unpaidOverdueMinor(all, primaryCurrency, today), [all, primaryCurrency, today]);
  const openTotal = primary?.minor ?? 0n;
  return (
    <ScreenState
      title="חשבוניות פתוחות"
      backTo={`/${search}`}
      phase={phase}
      onRetry={actions.retry}
    >
      <div className="ui-page-pad ui-inv-page">
        {open.length > 0 ? (
          <Card as="section" className="ui-inv-summary" aria-label="לגבייה מלקוחות">
            <p className="t-label text-text-secondary">לגבייה מלקוחות</p>
            {totals.map((total) => (
              <p key={total.currency} className="ui-inv-total">
                <Amount agorot={total.minor} currency={total.currency} size="total" income />
              </p>
            ))}
            <p className="t-hint text-text-secondary">
              {`${String(open.length)} חשבוניות · הוותיקה פתוחה ${String(oldest)} ימים`}
            </p>
            {summary != null ? (
              <div className="ui-inv-bar-block">
                <PartsBar
                  label={`שולם ${formatAmountText(summary.paid_agorot, primaryCurrency)}, פתוח ${formatAmountText(openTotal, primaryCurrency)}`}
                  parts={[
                    { key: "paid", value: summary.paid_agorot, tone: "accent" },
                    { key: "open", value: openTotal, tone: "muted" },
                  ]}
                  total={summary.paid_agorot + openTotal}
                  height={8}
                  radius="pill"
                  legend={[
                    { key: "paid", label: "שולם", value: <bdi dir="ltr">{formatAmountText(summary.paid_agorot, primaryCurrency)}</bdi> },
                    { key: "open", label: "פתוח", value: <bdi dir="ltr">{formatAmountText(openTotal, primaryCurrency)}</bdi> },
                  ]}
                />
                <p className="t-caption text-text-muted">
                  {`מתוך ${formatAmountText(summary.paid_agorot + openTotal, primaryCurrency)} שהוצאו מאז 1 ב${unpaidMonthName(summary.issued_since)}`}
                </p>
              </div>
            ) : null}
            {overdue > 0n ? (
              <p className="ui-inv-overdue t-body text-text-secondary">
                <span className="ui-inv-dot" data-tone="signal" aria-hidden="true" />
                <bdi dir="ltr" className="text-text">{formatAmountText(overdue, primaryCurrency)}</bdi>
                {` פתוחים יותר מ־${String(UNPAID_OVERDUE_DAYS)} ימים`}
              </p>
            ) : null}
          </Card>
        ) : null}

        {all.length > 0 ? (
          <div className="ui-inv-sortrow">
            {holdWrites ? null : (
              <button type="button" className="ui-inv-refresh" onClick={actions.startSync} disabled={syncing} aria-busy={syncing || undefined}>
                {syncing ? <span className="ui-spinner" aria-hidden="true" /> : <RefreshIcon size={14} />}
                <span>{syncing ? "מרענן…" : `רענון מ־SUMIT${actions.lastSyncAt ? ` · ${syncedAgo(actions.lastSyncAt)}` : ""}`}</span>
              </button>
            )}
            <span className="t-hint text-text-muted">מהוותיקה לחדשה</span>
          </div>
        ) : null}

        {all.length === 0 && phase.kind === "ready" ? (
          <EmptyState
            icon={<ReviewIcon />}
            title="הכל שולם"
            body={"אין חשבוניות פתוחות כרגע.\nחשבוניות שסימנת ייצאו מהרשימה אחרי הסנכרון עם SUMIT."}
            action={<Button full to="/">חזרה לבית</Button>}
          />
        ) : null}

        <ul className="ui-inv-list" aria-label="חשבוניות פתוחות">
          {rows.map((row) => {
            const marked = unpaidIsMarked(row);
            const days = unpaidDaysOpen(row.doc_date, today);
            const over = days > UNPAID_OVERDUE_DAYS && !marked;
            const matchText = !marked ? unpaidMatchText(row) : null;
            const detailTo = `/unpaid/${encodeURIComponent(row.id)}${search}`;
            const name = row.customer_name ?? row.description;
            return (
              <li key={row.id} className="ui-inv-item">
                <ListRow
                  variant="project"
                  layout="flat"
                  title={name}
                  hint={row.project_name ?? undefined}
                  href={detailTo}
                  className={marked ? "ui-inv-marked" : undefined}
                  icon={<Avatar name={name} fallback="invoice" />}
                  agorot={absAgorot(row.open_gross_agorot)}
                  currency={row.currency ?? "ILS"}
                  amountDirection="income"
                  endSub={marked ? null : (
                    <span className="ui-inv-age" data-over={over ? "true" : undefined}>
                      <span className="ui-inv-dot" aria-hidden="true" data-tone={over ? "signal" : "plain"} />
                      {`פתוחה ${String(days)} ימים`}
                    </span>
                  )}
                  actionBelow
                  action={marked ? (
                    <div className="ui-inv-action-line">
                      <span className="t-hint text-text-secondary">{UNPAID_MARKED}</span>
                      {holdWrites ? null : <button type="button" className="ui-inv-text-action" onClick={() => { actions.setPaid(row.id, false); }}>ביטול</button>}
                    </div>
                  ) : matchText != null ? (
                    <div className="ui-inv-action-line">
                      <Link to={detailTo} className="ui-inv-match-link">{matchText}</Link>
                    </div>
                  ) : holdWrites ? null : (
                    <div className="ui-inv-action-line">
                      <button type="button" className="ui-inv-text-action" onClick={() => { actions.setPaid(row.id, true); }}>סימון כשולם</button>
                    </div>
                  )}
                />
              </li>
            );
          })}
        </ul>
      </div>
    </ScreenState>
  );
}
