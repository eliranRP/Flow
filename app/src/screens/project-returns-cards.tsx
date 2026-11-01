import { useId, type MouseEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Amount } from "../ui/amount";
import { FailureLine } from "../ui/empty-state";
import { IconButton } from "../ui/icon-button";
import { ChevronIcon, InfoIcon } from "../ui/icons";
import { ListRow } from "../ui/list-row";
import { percentText, shareOfMoneyIn, type PropertyReturns } from "./project-returns-data";
import {
  HISTORY_HINT,
  MISSING_HISTORY,
  METRIC_KEYS,
  METRIC_TITLES,
  firstMissing,
  metricCaption,
  metricValue,
  type EditField,
  type FigureValue,
  type InfoKey,
  type MetricKey,
} from "./project-returns-info";
import { FigureText, MissingFigure } from "./project-returns-parts";

/* ------------------------------------------------------------------------------------------------
 * FLOW-451 (board ConceptATotalReturn): the page's three returns cards. The year's total return on
 * the money in the deal and its four sources; the equity in the property; today's metrics. Each
 * figure's ⓘ opens its sheet; a figure whose input is missing reads "חסר" and offers הוספה.
 * ---------------------------------------------------------------------------------------------- */

type CardProps = {
  returns: PropertyReturns;
  /** The investment page's path ("/projects/p1/investment"), and the preview flag. */
  base: string;
  search: string;
  /** Opens a figure's ⓘ sheet; the button that opened it gets the focus back. */
  onInfo: (key: InfoKey, opener: HTMLElement) => void;
  /** Opens an input's edit sheet; absent for a viewer. */
  onAdd: ((field: EditField) => void) | undefined;
};

function InfoButton({ label, infoKey, onInfo }: { label: string; infoKey: InfoKey; onInfo: CardProps["onInfo"] }) {
  return (
    <IconButton
      label={`איך מחושב: ${label}`}
      className="ui-ret-info-btn"
      onClick={(event: MouseEvent<HTMLButtonElement>) => { onInfo(infoKey, event.currentTarget); }}
    >
      <InfoIcon size={18} />
    </IconButton>
  );
}

/** A figure on a card: the amount, or "חסר" with הוספה for its first missing input. */
function CardFigure({ value, currency, onAdd, loss = false }: { value: FigureValue; currency: string; onAdd: CardProps["onAdd"]; loss?: boolean }) {
  if (value.kind !== "missing") return <FigureText value={value} currency={currency} loss={loss} />;
  const add = value.add;
  return <MissingFigure note={value.note} onAdd={onAdd == null || add == null ? undefined : () => { onAdd(add); }} />;
}

/** A source of return that is missing: appreciation waits for a value a year back, which no button adds. */
function sourceValue(minor: bigint | null, r: PropertyReturns, needs: readonly EditField[]): FigureValue {
  if (minor != null) return { kind: "money", minor };
  if (needs.includes("value") && r.inputs.valueMinor != null && r.missing.includes("value_history")) {
    return { kind: "missing", add: null, note: MISSING_HISTORY };
  }
  const add = firstMissing(r, needs);
  return add == null ? { kind: "text", text: "לא מחושב" } : { kind: "missing", add };
}

type Source = { key: InfoKey; label: string; value: FigureValue; shade: number; hint?: string };

function sourcesOf(r: PropertyReturns): Source[] {
  const appreciation = sourceValue(r.sources.appreciationMinor, r, ["value"]);
  return [
    { key: "cash_flow", label: "תזרים", value: { kind: "money", minor: r.sources.cashFlowMinor }, shade: 1 },
    { key: "principal", label: "החזר קרן", value: { kind: "money", minor: r.sources.principalMinor }, shade: 2 },
    {
      key: "appreciation",
      label: "עליית ערך",
      value: appreciation,
      shade: 3,
      hint: appreciation.kind === "missing" && appreciation.add == null ? HISTORY_HINT : undefined,
    },
    { key: "tax", label: "חיסכון מס", value: sourceValue(r.sources.taxSavingsMinor, r, ["purchase", "land", "tax_bracket"]), shade: 4 },
  ];
}

/** Each source's share of the bar: positive parts only, in whole percent. */
export function barShares(sources: readonly { value: FigureValue }[]): number[] {
  const parts = sources.map((source) => (source.value.kind === "money" && source.value.minor > 0n ? Number(source.value.minor) : 0));
  const sum = parts.reduce((total, part) => total + part, 0);
  return parts.map((part) => (sum === 0 ? 0 : Math.round((part / sum) * 100)));
}

/** "תשואה כוללת · שנה": the total on the money in the deal, its four sources and their bar. */
export function TotalReturnCard({ returns: r, base, search, onInfo, onAdd }: CardProps) {
  const titleId = useId();
  const sources = sourcesOf(r);
  const shares = barShares(sources);
  const moneyIn = r.equity.moneyInMinor;
  const totalBp = r.sources.totalBp;
  const totalMissing = firstMissing(r, ["purchase"]);
  return (
    <section className="ui-pinv-card ui-ret-card" aria-labelledby={titleId}>
      <div className="ui-ret-card-head">
        <h2 id={titleId} className="ui-ret-card-title">תשואה כוללת · שנה</h2>
        <Link to={`${base}/returns${search}`} className="ui-ret-link">איך מחושב</Link>
      </div>
      <div className="ui-ret-total">
        {totalBp != null ? (
          <bdi dir="ltr" className={totalBp < 0 ? "ui-num t-detail ui-loss" : "ui-num t-detail"}>{percentText(totalBp)}</bdi>
        ) : totalMissing != null ? (
          <MissingFigure onAdd={onAdd == null ? undefined : () => { onAdd(totalMissing); }} />
        ) : (
          <span className="ui-ret-missing">לא מחושב</span>
        )}
        {moneyIn == null ? null : (
          <span className="ui-ret-total-on">{"על "}<Amount agorot={moneyIn} currency={r.currency} />{" בעסקה"}</span>
        )}
      </div>
      {shares.some((share) => share > 0) ? (
        <div className="ui-ret-bar" role="img" aria-label={sources.map((source, index) => `${source.label} ${String(shares[index] ?? 0)}%`).join(", ")}>
          {sources.map((source, index) => (
            (shares[index] ?? 0) > 0 ? <span key={source.key} className={`ui-ret-shade-${String(source.shade)}`} style={{ flexGrow: shares[index] }} /> : null
          ))}
        </div>
      ) : null}
      <div className="ui-ret-sources">
        {sources.map((source) => {
          const share = source.value.kind === "money" ? shareOfMoneyIn(source.value.minor, moneyIn, r.days) : null;
          return (
            <div key={source.key} className="ui-ret-source">
              <div className="ui-ret-source-line">
                <span className={`ui-ret-swatch ui-ret-shade-${String(source.shade)}`} aria-hidden="true" />
                <span className="ui-ret-source-label">{source.label}</span>
                <InfoButton label={source.label} infoKey={source.key} onInfo={onInfo} />
                <span className="ui-ret-source-value"><CardFigure value={source.value} currency={r.currency} onAdd={onAdd} /></span>
                <span className="ui-ret-source-share">{share == null ? null : <bdi dir="ltr" className="ui-num">{percentText(share)}</bdi>}</span>
              </div>
              {source.hint == null ? null : <p className="ui-ret-source-hint">{source.hint}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function EquityRow({ label, caption, infoKey, value, currency, onInfo, onAdd }: {
  label: string;
  caption: string;
  infoKey: InfoKey;
  value: FigureValue;
  currency: string;
  onInfo: CardProps["onInfo"];
  onAdd: CardProps["onAdd"];
}) {
  return (
    <div className="ui-pinv-row ui-ret-row-static">
      <span className="ui-pinv-row-text">
        <span className="ui-ret-row-title">
          <span className="ui-pinv-row-title">{label}</span>
          <InfoButton label={label} infoKey={infoKey} onInfo={onInfo} />
        </span>
        <span className="ui-pinv-hint">{caption}</span>
      </span>
      <span className="ui-pinv-value"><CardFigure value={value} currency={currency} onAdd={onAdd} /></span>
    </div>
  );
}

function equityValue(minor: bigint | null, r: PropertyReturns, needs: readonly EditField[]): FigureValue {
  if (minor != null) return { kind: "money", minor };
  const add = firstMissing(r, needs);
  return add == null ? { kind: "text", text: "לא מחושב" } : { kind: "missing", add };
}

/** "הון בנכס": equity today, the forced equity, and the money in the deal. */
export function EquityInPropertyCard({ returns: r, onInfo, onAdd }: CardProps) {
  return (
    <section className="ui-pinv-card" aria-label="הון בנכס">
      <h2 className="ui-pinv-card-title">הון בנכס</h2>
      <EquityRow label="הון עצמי היום" caption="שווי היום פחות הלוואות" infoKey="equity_today" value={equityValue(r.equity.todayMinor, r, ["value"])} currency={r.currency} onInfo={onInfo} onAdd={onAdd} />
      <EquityRow label="השבחה צפויה" caption="ARV פחות קנייה ושיפוץ" infoKey="forced" value={equityValue(r.equity.forcedMinor, r, ["arv", "purchase"])} currency={r.currency} onInfo={onInfo} onAdd={onAdd} />
      <EquityRow label="כסף בעסקה" caption="קנייה ושיפוץ פחות הלוואות" infoKey="money_in" value={equityValue(r.equity.moneyInMinor, r, ["purchase"])} currency={r.currency} onInfo={onInfo} onAdd={onAdd} />
    </section>
  );
}

function MetricRow({ metric, r, href, onAdd }: { metric: MetricKey; r: PropertyReturns; href: string; onAdd: CardProps["onAdd"] }) {
  const value = metricValue(metric, r);
  const body: ReactNode = (
    <>
      <span className="ui-pinv-row-text">
        <span className="ui-pinv-row-title">{METRIC_TITLES[metric]}</span>
        <span className="ui-pinv-hint">{metricCaption(metric, r)}</span>
      </span>
      <span className="ui-pinv-value"><FigureText value={value} currency={r.currency} addText={value.kind === "missing" && onAdd != null} /></span>
      <span className="ui-pinv-chevron" aria-hidden="true"><ChevronIcon size={18} /></span>
    </>
  );
  // A missing input opens its sheet from the row; otherwise the row opens the metric's page.
  if (value.kind === "missing" && value.add != null && onAdd != null) {
    const add = value.add;
    return <button type="button" className="ui-pinv-row m-press" onClick={() => { onAdd(add); }}>{body}</button>;
  }
  return <Link to={href} className="ui-pinv-row m-press">{body}</Link>;
}

/** "מדדים": today's numbers only, no targets. Each opens its page. */
export function MetricsCard({ returns: r, base, search, onAdd }: CardProps) {
  return (
    <section className="ui-pinv-card" aria-label="מדדים">
      <h2 className="ui-pinv-card-title">מדדים</h2>
      {METRIC_KEYS.map((metric) => (
        <MetricRow key={metric} metric={metric} r={r} href={`${base}/metric/${metric}${search}`} onAdd={onAdd} />
      ))}
    </section>
  );
}

/** The returns cards while they load: one card of skeleton rows. */
export function ReturnsCardsSkeleton() {
  return (
    <section className="ui-pinv-card ui-ret-card" aria-busy="true">
      <p className="sr-only" role="status">טוען…</p>
      <ListRow variant="skeleton" layout="inset" />
      <ListRow variant="skeleton" layout="inset" />
      <ListRow variant="skeleton" layout="inset" />
    </section>
  );
}

/** The returns read failed: one line with נסו שוב, in the card's place. */
export function ReturnsCardsFailed({ offline, onRetry }: { offline: boolean; onRetry: () => void }) {
  return (
    <section className="ui-pinv-card ui-ret-card" aria-label="תשואה כוללת">
      <FailureLine offline={offline} onRetry={onRetry} />
    </section>
  );
}
