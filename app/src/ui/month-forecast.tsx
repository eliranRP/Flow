import { formatAmountText } from "@flow/shared";
import { type ReactNode, useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { Amount } from "./amount";
import { cx } from "./cx";
import { forecastWords, type ForecastKind } from "./forecast-words";
import { ChevronIcon } from "./icons";
import { type ChartBar, chartBars, type ChartMonth } from "./month-chart-scale";

/**
 * The forecast card and the income and expense chart under it, the same on every screen that shows them
 * (canvas notes spec-fcwide and spec-cash2): next month on the profit and project pages, the rest of this
 * month on תזרים צפוי. The screens pass figures and a `kind` only; the markup and the words are built here once.
 */

function signedText(minor: bigint, currency: string): string {
  return formatAmountText(minor, currency, { plus: minor > 0n, direction: minor > 0n ? "income" : undefined });
}

/** The card's spoken name: the month, both figures and the net, read once. */
function forecastCardLabel(input: { title: string; kind: ForecastKind; currency: string; incomeMinor: bigint; expenseMinor: bigint; net: bigint; netLabel: string }): string {
  const { title, kind, currency, incomeMinor, expenseMinor, net, netLabel } = input;
  const words = forecastWords(kind);
  return `צפי ${title}: ${words.income} ${formatAmountText(incomeMinor, currency)}, ${words.expense} ${formatAmountText(expenseMinor, currency)}, ${netLabel} ${signedText(net, currency)}`;
}

/**
 * The dashed forecast card: the title with its צפי tag, the expected income (green with "+", grey at zero)
 * and expenses with a short caption each, and under a divider the net. With `href` the whole card opens it
 * and says "פירוט ועריכה ›"; without, a grey `caption` stands in that corner. A profit page's and the project
 * page's net is grey (never green: it is a forecast). תזרים צפוי shows the whole sum: a `start` row (today's
 * cash, with a divider under it), then the two columns, then a `strong` net (17/500, coloured by sign as the
 * screen's big figure), start plus income minus expenses.
 */
export function ForecastCard({
  title,
  kind,
  currency,
  incomeMinor,
  expenseMinor,
  incomeNote,
  expenseNote,
  netLabel,
  start,
  strong = false,
  signed = false,
  href,
  caption,
}: {
  /** The month ("נובמבר"), or "עד סוף אוקטובר" on תזרים צפוי. */
  title: string;
  kind: ForecastKind;
  currency: string;
  /** Positive totals, in minor units. */
  incomeMinor: bigint;
  expenseMinor: bigint;
  incomeNote: string;
  expenseNote: string;
  /** The net's words when the screen names it ("תזרים בסוף אוקטובר"); else the kind's (רווח צפוי, תזרים צפוי). */
  netLabel?: string;
  /** The row the sum starts from ("תזרים היום"), signed, in minor units. */
  start?: { label: string; minor: bigint };
  /** The net is the screen's figure: 17/500, in the text colour or the signal colour when negative. */
  strong?: boolean;
  /** The start and the strong net are profits (the company's year, FLOW-145): a positive one carries its +. */
  signed?: boolean;
  href?: string;
  caption?: string;
}) {
  const words = forecastWords(kind);
  const net = (start?.minor ?? 0n) + incomeMinor - expenseMinor;
  const netWords = netLabel ?? words.net;
  // The two figures share one size: the smaller one either needs to fit its column.
  const [fits, setFits] = useState<[number, number]>([0, 0]);
  const shared = Math.max(fits[0], fits[1]);
  const fitIncome = useCallback((step: number) => { setFits((held) => (held[0] === step ? held : [step, held[1]])); }, []);
  const fitExpense = useCallback((step: number) => { setFits((held) => (held[1] === step ? held : [held[0], step])); }, []);
  const body: ReactNode = (
    <>
      <span className="ui-fc-head">
        <span className="ui-fc-month">
          {title}
          <span className="ui-fc-tag">צפי</span>
        </span>
        {href == null ? (
          caption == null ? null : <span className="ui-fc-caption">{caption}</span>
        ) : (
          <span className="ui-fc-link">פירוט ועריכה<ChevronIcon size={16} /></span>
        )}
      </span>
      {start == null ? null : (
        <span className={cx("ui-fc-start", start.minor < 0n && "ui-fc-neg")}>
          <span>{start.label}</span>
          <Amount agorot={start.minor} currency={currency} direction={signed && start.minor > 0n ? "income" : undefined} />
        </span>
      )}
      <span className="ui-fc-cols">
        <span className={incomeMinor > 0n ? "ui-fc-col ui-amount-fit" : "ui-fc-col ui-amount-fit ui-fc-col-zero"}>
          <span className="ui-fc-label">{words.income}</span>
          <Amount agorot={incomeMinor} currency={currency} size="column" income onFit={fitIncome} minStep={shared} />
          <span className="ui-fc-label">{incomeNote}</span>
        </span>
        <span className="ui-fc-col ui-amount-fit">
          <span className="ui-fc-label">{words.expense}</span>
          <Amount agorot={expenseMinor} currency={currency} size="column" onFit={fitExpense} minStep={shared} />
          <span className="ui-fc-label">{expenseNote}</span>
        </span>
      </span>
      {strong ? (
        <span className={cx("ui-fc-net ui-fc-net-strong", net < 0n && "ui-fc-neg")}>
          <span>{netWords}</span>
          <Amount agorot={net} currency={currency} direction={signed && net > 0n ? "income" : undefined} />
        </span>
      ) : (
        <span className="ui-fc-net">
          <span>{netWords}</span>
          <Amount agorot={net} currency={currency} direction={net > 0n ? "income" : undefined} />
        </span>
      )}
    </>
  );
  if (href == null) return <div className="ui-fc-card">{body}</div>;
  return (
    <Link
      to={href}
      className="ui-fc-card ui-hit m-press"
      aria-label={`${forecastCardLabel({ title, kind, currency, incomeMinor, expenseMinor, net, netLabel: netWords })} – פירוט ועריכה`}
    >
      {body}
    </Link>
  );
}

/** One bar: solid, or in the month in progress the solid part under its dashed cap of what is still expected. */
function Bar({ side, px, aheadPx, inProgress }: { side: "in" | "out"; px: number; aheadPx: number; inProgress: boolean }) {
  const solid = <span className={`ui-fc-bar ui-fc-bar-${side}`} style={{ blockSize: `${String(px)}px` }} />;
  if (!inProgress) return solid;
  return (
    <span className={cx("ui-fc-stack", aheadPx > 0 && "ui-fc-stack-capped")}>
      {aheadPx > 0 ? <span className={`ui-fc-cap ui-fc-cap-${side}`} style={{ blockSize: `${String(aheadPx)}px` }} /> : null}
      {solid}
    </span>
  );
}

/** Past this many pairs (a year's twelve months) the columns close up, so the month labels keep apart at 320. */
const DENSE_BARS = 8;

function barClass(bar: ChartBar): string {
  return cx("ui-fc-month-bars", bar.forecast && "ui-fc-ahead", bar.inProgress && "ui-fc-now");
}

/**
 * The chart: two bars a month on one scale (income in the accent, expenses in the dim purple-grey), oldest
 * on the right as time runs right to left. Next month is dashed and unfilled; a month in progress is solid
 * so far with a dashed cap for what is still expected. Either one's label is in the accent. A screen reader
 * hears `label` once; `link` sits under the legend.
 */
export function MonthChart({
  kind,
  history,
  forecast,
  sub,
  label,
  link,
  title,
}: {
  kind: ForecastKind;
  /** Oldest first; the current month is to date, or in progress with what is still expected. */
  history: readonly ChartMonth[];
  /** Next month; or a year's months left (the company's year view), each dashed. */
  forecast: ChartMonth | readonly ChartMonth[] | null;
  sub: string;
  label: string;
  link?: { href: string; text: string };
  /** The title when the pairs are not months ("הכנסות והוצאות לפי שנה"); else the kind's. */
  title?: string;
}) {
  const words = forecastWords(kind);
  const bars = chartBars(history, forecast);
  const expected = bars.some((bar) => bar.forecast || bar.inProgress);
  return (
    <section className="ui-fc-chart">
      <span className="ui-fc-chart-head">
        <span className="ui-fc-chart-title">{title ?? words.chart}</span>
        <span className="ui-fc-label">{sub}</span>
      </span>
      <div role="img" aria-label={label} className={cx("ui-fc-bars", bars.length > DENSE_BARS && "ui-fc-bars-dense")} style={{ gridTemplateColumns: `repeat(${String(bars.length)}, minmax(0, 1fr))` }}>
        {bars.map((bar) => (
          <div key={bar.key} className={barClass(bar)}>
            <span className="ui-fc-pair">
              <Bar side="in" px={bar.incomePx} aheadPx={bar.incomeAheadPx} inProgress={bar.inProgress} />
              <Bar side="out" px={bar.expensePx} aheadPx={bar.expenseAheadPx} inProgress={bar.inProgress} />
            </span>
            <span className="ui-fc-bar-label">{bar.label}</span>
          </div>
        ))}
      </div>
      <span className="ui-fc-legend" aria-hidden="true">
        <span><span className="ui-fc-swatch ui-fc-bar-in" />{words.incomeShort}</span>
        <span><span className="ui-fc-swatch ui-fc-bar-out" />{words.expenseShort}</span>
        {expected ? <span><span className="ui-fc-swatch ui-fc-swatch-ahead" />צפי</span> : null}
      </span>
      {link == null ? null : (
        <Link to={link.href} className="ui-fc-chart-link ui-hit m-press">{link.text}<ChevronIcon size={16} /></Link>
      )}
    </section>
  );
}
