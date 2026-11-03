import { useId, type MouseEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Amount } from "../ui/amount";
import { FailureLine } from "../ui/empty-state";
import { IconButton } from "../ui/icon-button";
import { ChevronIcon, InfoIcon } from "../ui/icons";
import { ListRow } from "../ui/list-row";
import { percentText, type PropertyReturns } from "./project-returns-data";
import {
  BEFORE_FIRST_RENT,
  FIELD_NAMES,
  HISTORY_HINT,
  MISSING_HISTORY,
  METRIC_KEYS,
  METRIC_TITLES,
  beforeFirstRent,
  cashOutMinor,
  coverLine,
  infiniteTotal,
  firstMissing,
  metricCaption,
  metricValue,
  missingHint,
  type EditField,
  type FigureValue,
  type InfoKey,
  type MetricKey,
} from "./project-returns-info";
import { LearnButton } from "./project-returns-learn-sheet";
import { AllCashOutMeta, FigureText, InfinityFigure, MissingFigure } from "./project-returns-parts";

/* ------------------------------------------------------------------------------------------------
 * FLOW-451 (board ConceptATotalReturn): the page's returns cards. The year's total return on the
 * money in the deal, its four sources and, below them, the equity in the property (FLOW-459: one
 * card); then today's metrics. Only a source has an ⓘ; an equity row opens its sheet itself. A figure
 * whose input is missing offers הוספה, and the hint line says what is missing.
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

/** A source of return that is missing: appreciation waits for a value a year back, which no button adds. */
function sourceValue(minor: bigint | null, r: PropertyReturns, needs: readonly EditField[]): FigureValue {
  if (minor != null) return { kind: "money", minor };
  if (needs.includes("value") && r.inputs.valueMinor != null && r.missing.includes("value_history")) {
    return { kind: "missing", add: null, note: MISSING_HISTORY };
  }
  const add = firstMissing(r, needs);
  return add == null ? { kind: "text", text: "לא מחושב" } : { kind: "missing", add };
}

type Source = { key: InfoKey; label: string; value: FigureValue; shade: number };

function sourcesOf(r: PropertyReturns): Source[] {
  return [
    { key: "cash_flow", label: "תזרים", value: { kind: "money", minor: r.sources.cashFlowMinor }, shade: 1 },
    { key: "principal", label: "החזר קרן", value: { kind: "money", minor: r.sources.principalMinor }, shade: 2 },
    { key: "appreciation", label: "עליית ערך", value: sourceValue(r.sources.appreciationMinor, r, ["value"]), shade: 3 },
    { key: "tax", label: "חיסכון מס", value: sourceValue(r.sources.taxSavingsMinor, r, ["purchase", "land", "tax_bracket"]), shade: 4 },
  ];
}

/** Each source's share of the bar: positive parts only, in whole percent. */
export function barShares(sources: readonly { value: FigureValue }[]): number[] {
  const parts = sources.map((source) => (source.value.kind === "money" && source.value.minor > 0n ? Number(source.value.minor) : 0));
  const sum = parts.reduce((total, part) => total + part, 0);
  return parts.map((part) => (sum === 0 ? 0 : Math.round((part / sum) * 100)));
}

/** "חלקי · חסרים עליית ערך וחיסכון מס": a total that leaves out a source never passes as final (FLOW-458). */
export function partialLine(labels: readonly string[]): string | null {
  const last = labels.at(-1);
  if (last == null) return null;
  if (labels.length === 1) return `חלקי · חסר ${last}`;
  return `חלקי · חסרים ${labels.slice(0, -1).join(", ")} ו${last}`;
}

/** A missing figure's hint: what is missing (FLOW-458: on the hint line, so the label keeps its line). */
function missingNote(value: FigureValue): string | null {
  if (value.kind !== "missing") return null;
  if (value.add != null) return missingHint(value.add);
  return value.note === MISSING_HISTORY ? `${MISSING_HISTORY}. ${HISTORY_HINT}` : (value.note ?? "חסר");
}

/** A figure in a card's amount column: the amount, or הוספה when an input is missing (the hint says which). */
function SourceFigure({ value, currency, onAdd }: { value: FigureValue; currency: string; onAdd: CardProps["onAdd"] }) {
  if (value.kind !== "missing") return <FigureText value={value} currency={currency} />;
  const add = value.add;
  if (add == null || onAdd == null) return null;
  return <button type="button" className="ui-ret-add" aria-label={`הוספה: ${FIELD_NAMES[add]}`} onClick={() => { onAdd(add); }}>הוספה</button>;
}

function equityValue(minor: bigint | null, r: PropertyReturns, needs: readonly EditField[]): FigureValue {
  if (minor != null) return { kind: "money", minor };
  const add = firstMissing(r, needs);
  return add == null ? { kind: "text", text: "לא מחושב" } : { kind: "missing", add };
}

/** An equity row: the row opens its sheet; with an input missing (and an owner), it opens that input's. */
function EquityRow({ label, infoKey, value, currency, onInfo, onAdd }: {
  label: string;
  infoKey: InfoKey;
  value: FigureValue;
  currency: string;
  onInfo: CardProps["onInfo"];
  onAdd: CardProps["onAdd"];
}) {
  const add = value.kind === "missing" && onAdd != null ? value.add : null;
  return (
    <button
      type="button"
      className="ui-ret-equity-row m-press"
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        if (add != null && onAdd != null) onAdd(add);
        else onInfo(infoKey, event.currentTarget);
      }}
    >
      <span className="ui-ret-equity-text">
        <span className="ui-ret-equity-label">{label}</span>
        {add == null ? null : <span className="ui-ret-equity-hint">{missingHint(add)}</span>}
      </span>
      <span className="ui-ret-equity-value">
        {add == null ? <FigureText value={value} currency={currency} /> : <span className="ui-ret-add">הוספה</span>}
      </span>
      <span className="ui-ret-go" aria-hidden="true"><ChevronIcon size={18} /></span>
    </button>
  );
}

/**
 * "תשואה כוללת · שנה": the total on the money in the deal, its four sources and their bar, then the
 * equity in the property (FLOW-459: one card, the money in the deal named once, in its row).
 */
export function TotalReturnCard({ returns: r, base, search, onInfo, onAdd }: CardProps) {
  const titleId = useId();
  const equityId = useId();
  const sources = sourcesOf(r);
  const shares = barShares(sources);
  const moneyIn = r.equity.moneyInMinor;
  const totalBp = r.sources.totalBp;
  const totalMissing = firstMissing(r, ["purchase"]);
  const cashOut = cashOutMinor(r);
  const infinite = infiniteTotal(r);
  const cover = coverLine(r);
  const before = beforeFirstRent(r);
  const partial = (cashOut == null ? totalBp != null : !infinite) && !before
    ? partialLine(sources.filter((source) => source.value.kind !== "money").map((source) => source.label))
    : null;
  return (
    <section className="ui-pinv-card ui-ret-card" aria-labelledby={titleId}>
      <div className="ui-ret-card-head">
        <h2 id={titleId} className="ui-ret-card-title">תשואה כוללת · שנה</h2>
        {/* FLOW-462: how to read the total, beside its title. */}
        <LearnButton learnKey="total" title="תשואה כוללת" />
        <Link to={`${base}/returns${search}`} className="ui-ret-link">איך מחושב</Link>
      </div>
      <div className="ui-ret-total">
        {infinite ? (
          // All the cash came out and the deal gains: no per-cent figure, and no signal colour, a good state.
          <InfinityFigure className="ui-num t-detail" />
        ) : cashOut != null && !before ? (
          // FLOW-1025: all the cash out but losing money: the loss, not ∞.
          <span className="t-detail"><Amount agorot={r.sources.totalMinor} currency={r.currency} loss /></span>
        ) : before ? (
          // No rent yet: a per-cent of the money in says nothing (FLOW-454). The amounts stay.
          <span className="ui-ret-note">{BEFORE_FIRST_RENT}</span>
        ) : totalBp != null ? (
          <bdi dir="ltr" className={totalBp < 0 ? "ui-num t-detail ui-loss" : "ui-num t-detail"}>{percentText(totalBp)}</bdi>
        ) : totalMissing != null ? (
          <MissingFigure addLabel={`הוספה: ${FIELD_NAMES[totalMissing]}`} onAdd={onAdd == null ? undefined : () => { onAdd(totalMissing); }} />
        ) : (
          <span className="ui-ret-missing">לא מחושב</span>
        )}
        {cashOut != null ? (
          <span className="ui-ret-total-on">
            <AllCashOutMeta minor={cashOut} currency={r.currency} />
            {cover == null ? null : <>{" · "}{cover}</>}
          </span>
        ) : moneyIn == null ? null : (
          <span className="ui-ret-total-on">על הכסף בעסקה</span>
        )}
        {partial == null ? null : <p className="ui-ret-partial">{partial}</p>}
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
          // FLOW-454: fixed tracks (dot | label | ⓘ and the gap | amount), so every row's amount sits in
          // the same column. FLOW-458: what is missing goes on the hint line, so the label keeps one line.
          const note = missingNote(source.value);
          return (
            <div key={source.key} className="ui-ret-source">
              <span className={`ui-ret-swatch ui-ret-shade-${String(source.shade)}`} aria-hidden="true" />
              <span className="ui-ret-source-label">{source.label}</span>
              <InfoButton label={source.label} infoKey={source.key} onInfo={onInfo} />
              <span className="ui-ret-source-value">
                <SourceFigure value={source.value} currency={r.currency} onAdd={onAdd} />
              </span>
              {note == null ? null : <p className="ui-ret-source-hint">{note}</p>}
            </div>
          );
        })}
      </div>
      <div className="ui-ret-equity" role="group" aria-labelledby={equityId}>
        <h3 id={equityId} className="ui-ret-sub">הון בנכס</h3>
        <EquityRow label="הון עצמי היום" infoKey="equity_today" value={equityValue(r.equity.todayMinor, r, ["value"])} currency={r.currency} onInfo={onInfo} onAdd={onAdd} />
        <EquityRow label="השבחה צפויה" infoKey="forced" value={equityValue(r.equity.forcedMinor, r, ["arv", "purchase"])} currency={r.currency} onInfo={onInfo} onAdd={onAdd} />
        <EquityRow label="כסף בעסקה" infoKey="money_in" value={equityValue(moneyIn, r, ["purchase"])} currency={r.currency} onInfo={onInfo} onAdd={onAdd} />
      </div>
    </section>
  );
}

function MetricRow({ metric, r, href, onAdd }: { metric: MetricKey; r: PropertyReturns; href: string; onAdd: CardProps["onAdd"] }) {
  const value = metricValue(metric, r);
  // FLOW-459: a missing input shows only הוספה; the hint says what is missing.
  const add = value.kind === "missing" && onAdd != null ? value.add : null;
  const body: ReactNode = (
    <>
      <span className="ui-pinv-row-text">
        <span className="ui-pinv-row-title">{METRIC_TITLES[metric]}</span>
        <span className="ui-pinv-hint">{add == null ? metricCaption(metric, r) : missingHint(add)}</span>
      </span>
      <span className="ui-pinv-value ui-ret-fixed-metric">
        {add == null ? <FigureText value={value} currency={r.currency} /> : <span className="ui-ret-add">הוספה</span>}
      </span>
      <span className="ui-pinv-chevron" aria-hidden="true"><ChevronIcon size={18} /></span>
    </>
  );
  // A missing input opens its sheet from the row; otherwise the row opens the metric's page.
  if (add != null && onAdd != null) {
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
