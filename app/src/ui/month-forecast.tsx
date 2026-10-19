import { formatAmountText } from "@flow/shared";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Amount } from "./amount";
import { ChevronIcon } from "./icons";
import { chartBars, type ChartMonth } from "./month-chart-scale";

/**
 * Next month's forecast, the same on every screen that shows it (canvas note spec-fcwide): the dashed card
 * and the income and expense chart under it. The screens pass figures only; the markup is built here once.
 */

function signedText(minor: bigint, currency: string): string {
  return formatAmountText(minor, currency, { plus: minor > 0n, direction: minor > 0n ? "income" : undefined });
}

/** The card's spoken name: the month, both figures and the net, read once. */
function forecastCardLabel(input: { monthName: string; currency: string; incomeMinor: bigint; expenseMinor: bigint; netLabel: string }): string {
  const { monthName, currency, incomeMinor, expenseMinor, netLabel } = input;
  return `צפי ${monthName}: הכנסות צפויות ${formatAmountText(incomeMinor, currency)}, הוצאות צפויות ${formatAmountText(expenseMinor, currency)}, ${netLabel} ${signedText(incomeMinor - expenseMinor, currency)}`;
}

/**
 * The dashed next-month card: the month with its צפי tag, הכנסות צפויות (green with "+", grey at zero) and
 * הוצאות צפויות with a short caption each, and under a divider the net in grey (never green: it is a
 * forecast). With `href` the whole card opens it and says "פירוט ועריכה ›"; without, a grey `caption`
 * stands in that corner.
 */
export function ForecastCard({
  monthName,
  currency,
  incomeMinor,
  expenseMinor,
  incomeNote,
  expenseNote,
  netLabel,
  href,
  caption,
}: {
  monthName: string;
  currency: string;
  /** Positive totals, in minor units. */
  incomeMinor: bigint;
  expenseMinor: bigint;
  incomeNote: string;
  expenseNote: string;
  /** "רווח צפוי" on a profit page, "תזרים צפוי" on the project page. */
  netLabel: string;
  href?: string;
  caption?: string;
}) {
  const net = incomeMinor - expenseMinor;
  const body: ReactNode = (
    <>
      <span className="ui-fc-head">
        <span className="ui-fc-month">
          {monthName}
          <span className="ui-fc-tag">צפי</span>
        </span>
        {href == null ? (
          caption == null ? null : <span className="ui-fc-caption">{caption}</span>
        ) : (
          <span className="ui-fc-link">פירוט ועריכה<ChevronIcon size={16} /></span>
        )}
      </span>
      <span className="ui-fc-cols">
        <span className={incomeMinor > 0n ? "ui-fc-col" : "ui-fc-col ui-fc-col-zero"}>
          <span className="ui-fc-label">הכנסות צפויות</span>
          <Amount agorot={incomeMinor} currency={currency} size="card" income />
          <span className="ui-fc-label">{incomeNote}</span>
        </span>
        <span className="ui-fc-col">
          <span className="ui-fc-label">הוצאות צפויות</span>
          <Amount agorot={expenseMinor} currency={currency} size="card" />
          <span className="ui-fc-label">{expenseNote}</span>
        </span>
      </span>
      <span className="ui-fc-net">
        <span>{netLabel}</span>
        <Amount agorot={net} currency={currency} direction={net > 0n ? "income" : undefined} />
      </span>
    </>
  );
  if (href == null) return <div className="ui-fc-card">{body}</div>;
  return (
    <Link
      to={href}
      className="ui-fc-card ui-hit m-press"
      aria-label={`${forecastCardLabel({ monthName, currency, incomeMinor, expenseMinor, netLabel })} – פירוט ועריכה`}
    >
      {body}
    </Link>
  );
}

/**
 * "הכנסות והוצאות לפי חודש": two bars a month on one scale (income in the accent, expenses in the dim
 * purple-grey), oldest on the right as time runs right to left, and next month dashed and unfilled with its
 * label in the accent. A screen reader hears `label` once; `link` sits under the legend.
 */
export function MonthChart({
  history,
  forecast,
  sub,
  label,
  link,
}: {
  /** Oldest first; the current month is to date. */
  history: readonly ChartMonth[];
  forecast: ChartMonth | null;
  sub: string;
  label: string;
  link?: { href: string; text: string };
}) {
  const bars = chartBars(history, forecast);
  return (
    <section className="ui-fc-chart">
      <span className="ui-fc-chart-head">
        <span className="ui-fc-chart-title">הכנסות והוצאות לפי חודש</span>
        <span className="ui-fc-label">{sub}</span>
      </span>
      <div role="img" aria-label={label} className="ui-fc-bars" style={{ gridTemplateColumns: `repeat(${String(bars.length)}, minmax(0, 1fr))` }}>
        {bars.map((bar) => (
          <div key={bar.key} className={bar.forecast ? "ui-fc-month-bars ui-fc-ahead" : "ui-fc-month-bars"}>
            <span className="ui-fc-pair">
              <span className="ui-fc-bar ui-fc-bar-in" style={{ blockSize: `${String(bar.incomePx)}px` }} />
              <span className="ui-fc-bar ui-fc-bar-out" style={{ blockSize: `${String(bar.expensePx)}px` }} />
            </span>
            <span className="ui-fc-bar-label">{bar.label}</span>
          </div>
        ))}
      </div>
      <span className="ui-fc-legend" aria-hidden="true">
        <span><span className="ui-fc-swatch ui-fc-bar-in" />הכנסות</span>
        <span><span className="ui-fc-swatch ui-fc-bar-out" />הוצאות</span>
        {forecast == null ? null : <span><span className="ui-fc-swatch ui-fc-swatch-ahead" />צפי</span>}
      </span>
      {link == null ? null : (
        <Link to={link.href} className="ui-fc-chart-link ui-hit m-press">{link.text}<ChevronIcon size={16} /></Link>
      )}
    </section>
  );
}
