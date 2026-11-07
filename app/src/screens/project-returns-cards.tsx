import { useId, type MouseEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { resolveProjectKind } from "../project-list";
import { Amount } from "../ui/amount";
import type { BannerRow } from "../ui/banner";
import { FailureLine } from "../ui/empty-state";
import { GroupHead } from "../ui/group-head";
import { ChevronIcon } from "../ui/icons";
import { ListRow } from "../ui/list-row";
import { formatDisplay } from "../ui/date-math";
import { percentText, type PropertyReturns } from "./project-returns-data";
import { FLIP_GROUPS, RENT_GROUPS, anyMetricCaption, anyMetricTitle, anyMetricValue, type AnyMetricKey, type MetricGroup } from "./project-returns-deal";
import {
  BEFORE_FIRST_RENT,
  FEW_DAYS,
  HISTORY_HINT,
  LOSS_YEAR,
  MISSING_HISTORY,
  beforeFirstRent,
  cashOutMinor,
  coverLine,
  fewDays,
  fewDaysText,
  firstMissing,
  infiniteTotal,
  missingHint,
  purchaseRows,
  sellingText,
  type EditField,
  type FigureValue,
  type InfoKey,
  type Target,
} from "./project-returns-info";
import { AllCashOutMeta, FigureText, InfinityFigure, withParam, type Resolve, type RowAction } from "./project-returns-parts";

/* ------------------------------------------------------------------------------------------------
 * FLOW-1047 (boards V3-Investment, V3-Investment-Rent): the investment page's Overview parts. The band
 * by kind (a rental's total return, a renovation's expected profit), "חסר לחישוב" as attention cards,
 * the parts of the figure with their bar (each opening its calculation), and the metrics group.
 * ---------------------------------------------------------------------------------------------- */

/** A rental leads with its total return; a renovation with the profit it expects at the sale. */
export type InvestmentKind = "rent" | "flip";

/** BUILD-PLAN §5: the kind from the data the page has (a budget or an ARV is a renovation). */
export function investmentKind(signals: { overhead: boolean; budget: boolean; arv: boolean; value: boolean; rent: boolean }): InvestmentKind {
  return resolveProjectKind({ ...signals, type: null }) === "renovation" ? "flip" : "rent";
}

/** Opens a figure's ⓘ sheet; the control that opened it gets the focus back. */
export type OnInfo = (key: InfoKey, opener: HTMLElement) => void;

/** A source of return that is missing: appreciation waits for a value a year back, which no button adds. */
export function sourceValue(minor: bigint | null, r: PropertyReturns, needs: readonly EditField[]): FigureValue {
  if (minor != null) return { kind: "money", minor };
  if (needs.includes("value") && r.inputs.valueMinor != null && r.missing.includes("value_history")) {
    return { kind: "missing", add: null, note: MISSING_HISTORY };
  }
  const add = firstMissing(r, needs);
  // FLOW-470: a land the books suggest is added by its השתמש on the figures, the one action for it.
  if (add === "land" && r.inputs.landSuggestion != null) return { kind: "missing", add: null, note: missingHint(add) };
  return add == null ? { kind: "text", text: "לא מחושב" } : { kind: "missing", add };
}

/** Each part's share of the bar: positive parts only, in whole percent. */
export function barShares(parts: readonly { value: FigureValue }[]): number[] {
  const positive = parts.map((part) => (part.value.kind === "money" && part.value.minor > 0n ? Number(part.value.minor) : 0));
  const sum = positive.reduce((total, part) => total + part, 0);
  return positive.map((part) => (sum === 0 ? 0 : Math.round((part / sum) * 100)));
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

/** One part of the figure: its bar shade, its name and a line under it, its figure, and what it opens. */
export type Part = { key: string; label: string; hint: string; value: FigureValue; open: PartOpen; shade: number };
/** A link, an ⓘ sheet, or nothing (a viewer's missing input). */
type PartOpen = { kind: "target"; target: Target } | { kind: "info"; key: InfoKey } | null;

/** A rental's four sources: the cash flow and the principal open their pages, the other two their calculation sheet. */
export function rentParts(r: PropertyReturns): Part[] {
  const appreciation = sourceValue(r.sources.appreciationMinor, r, ["value"]);
  const tax = sourceValue(r.sources.taxSavingsMinor, r, ["purchase", "land", "tax_bracket"]);
  return [
    { key: "cash_flow", label: "תזרים", hint: "רווח תפעולי פחות הלוואה ושיפוץ", value: { kind: "money", minor: r.sources.cashFlowMinor }, open: { kind: "target", target: { kind: "statement" } }, shade: 1 },
    { key: "principal", label: "החזר קרן", hint: "החוב קטן", value: { kind: "money", minor: r.sources.principalMinor }, open: { kind: "target", target: { kind: "line", line: "principal" } }, shade: 2 },
    { key: "appreciation", label: "עליית ערך", hint: missingNote(appreciation) ?? "שווי היום מול שווי לפני שנה", value: appreciation, open: { kind: "info", key: "appreciation" }, shade: 3 },
    { key: "tax", label: "חיסכון מס", hint: missingNote(tax) ?? "פחת × מדרגת המס", value: tax, open: { kind: "info", key: "tax" }, shade: 4 },
  ];
}

/**
 * A renovation's profit (FLOW-1068): what it cost (the purchase, the renovation so far, the holding
 * costs and the costs of selling), and what is left at the ARV, the net profit.
 */
export function flipParts(r: PropertyReturns): Part[] {
  const [purchase] = purchaseRows(r, "", true);
  const rehab = r.inputs.rehabMinor;
  const net = r.deal.netProfitMinor;
  const selling = r.deal.sellingCostMinor;
  const profit: FigureValue = net != null ? { kind: "money", minor: net, income: net > 0n } : sourceValue(null, r, ["arv", "purchase"]);
  return [
    {
      key: "purchase",
      label: "מחיר קנייה",
      hint: r.inputs.purchaseSource === "lines" ? "מהתנועות · רכישה וסגירה" : r.inputs.purchaseMinor == null ? missingHint("purchase") : "מנתוני הנכס",
      // A loan taken over at closing is inside the price (decision 0246): the part is the whole purchase.
      value: r.inputs.purchaseMinor == null ? { kind: "missing", add: "purchase" } : { kind: "money", minor: -r.inputs.purchaseMinor },
      open: purchase?.target == null ? null : { kind: "target", target: purchase.target },
      shade: 1,
    },
    { key: "rehab", label: "שיפוץ עד היום", hint: "מחושב מההוצאות", value: rehab == null ? { kind: "text", text: "לא מחושב" } : { kind: "money", minor: -rehab }, open: { kind: "target", target: { kind: "part", part: "rehab" } }, shade: 2 },
    // No holding costs (all of them counted in the renovation): no part of ₪0.
    ...(r.deal.holdingMinor === 0n ? [] : [
      // FLOW-1071: the holding costs rehab does not count, opening their own lines (deal_holding), which add up to it.
      { key: "holding", label: "החזקה", hint: "ריבית ועלויות שלא נספרו בשיפוץ", value: { kind: "money", minor: r.deal.holdingMinor }, open: { kind: "target", target: { kind: "line", line: "deal_holding" } }, shade: 3 } satisfies Part,
    ]),
    {
      key: "selling",
      label: "עלויות מכירה",
      hint: `${sellingText(r)} מה־ARV · ${r.deal.sellingCostDefault ? "הערכה" : "שלך"} · עריכה`,
      value: selling == null ? { kind: "missing", add: "arv" } : { kind: "money", minor: -selling },
      // With no ARV the costs of selling wait for it: the part opens the ARV's sheet.
      open: { kind: "target", target: { kind: "edit", field: selling == null ? "arv" : "selling_cost" } },
      shade: 4,
    },
    { key: "profit", label: "רווח נקי צפוי", hint: missingNote(profit) ?? "מה שנשאר אחרי כל העלויות", value: profit, open: { kind: "target", target: { kind: "part", part: "profit" } }, shade: 5 },
  ];
}

/** The bar's shares for a renovation: each part's size against the ARV (the costs drawn as their size). */
function flipShares(parts: readonly Part[]): number[] {
  const sizes = parts.map((part) => (part.value.kind === "money" ? Number(part.value.minor < 0n ? -part.value.minor : part.value.minor) : 0));
  const last = parts.length - 1;
  const profit = parts[last]?.value;
  // A loss draws no profit part: the costs alone fill the bar.
  if (profit?.kind === "money" && profit.minor < 0n) sizes[last] = 0;
  const sum = sizes.reduce((total, size) => total + size, 0);
  return sizes.map((size) => (sum === 0 ? 0 : Math.round((size / sum) * 100)));
}

function PartRow({ part, currency, resolve, onInfo, onAdd }: { part: Part; currency: string; resolve: Resolve; onInfo: OnInfo; onAdd: ((field: EditField) => void) | undefined }) {
  const add = part.value.kind === "missing" ? part.value.add : null;
  const body: ReactNode = (
    <>
      <span className={`ui-ret-swatch ui-ret-shade-${String(part.shade)}`} aria-hidden="true" />
      <span className="ui-pinv-row-text">
        <span className="ui-pinv-row-title">{part.label}</span>
        <span className="ui-pinv-hint">{part.hint}</span>
      </span>
      <span className="ui-pinv-value">
        {add != null && onAdd != null ? <span className="ui-ret-add">הוספה</span> : <FigureText value={part.value} currency={currency} />}
      </span>
      <span className="ui-pinv-chevron" aria-hidden="true"><ChevronIcon size={18} /></span>
    </>
  );
  // A missing input opens its sheet; else the part's page, or its calculation sheet.
  if (add != null && onAdd != null) {
    return <button type="button" className="ui-pinv-row ui-pinv-part m-press" onClick={() => { onAdd(add); }}>{body}</button>;
  }
  if (part.open?.kind === "info") {
    const key = part.open.key;
    return <button type="button" className="ui-pinv-row ui-pinv-part m-press" onClick={(event: MouseEvent<HTMLButtonElement>) => { onInfo(key, event.currentTarget); }}>{body}</button>;
  }
  const action: RowAction | null = part.open == null ? null : resolve(part.open.target);
  if (action == null) return <div className="ui-pinv-row ui-pinv-part">{body}</div>;
  if ("href" in action) return <Link to={action.href} className="ui-pinv-row ui-pinv-part m-press">{body}</Link>;
  return <button type="button" className="ui-pinv-row ui-pinv-part m-press" onClick={action.onClick}>{body}</button>;
}

/**
 * "ממה מורכבת התשואה" (a rental) or "מאיפה הרווח" (a renovation): the parts' bar, then each part, opening
 * its calculation. A viewer opens the pages and sheets that only read.
 */
export function PartsSection({ kind, returns: r, resolve, onInfo, onAdd }: {
  kind: InvestmentKind;
  returns: PropertyReturns;
  resolve: Resolve;
  onInfo: OnInfo;
  onAdd: ((field: EditField) => void) | undefined;
}) {
  const titleId = useId();
  const parts = kind === "rent" ? rentParts(r) : flipParts(r);
  const shares = kind === "rent" ? barShares(parts) : flipShares(parts);
  return (
    <section className="ui-pinv-card ui-pinv-parts" aria-labelledby={titleId}>
      <h2 id={titleId} className="ui-pinv-card-title">{kind === "rent" ? "ממה מורכבת התשואה" : "מאיפה הרווח"}</h2>
      {shares.some((share) => share > 0) ? (
        <div className="ui-ret-bar" role="img" aria-label={parts.map((part, index) => `${part.label} ${String(shares[index] ?? 0)}%`).join(", ")}>
          {parts.map((part, index) => (
            (shares[index] ?? 0) > 0 ? <span key={part.key} className={`ui-ret-shade-${String(part.shade)}`} style={{ flexGrow: shares[index] }} /> : null
          ))}
        </div>
      ) : null}
      <div className="ui-pinv-part-rows">
        {parts.map((part) => <PartRow key={part.key} part={part} currency={r.currency} resolve={resolve} onInfo={onInfo} onAdd={onAdd} />)}
      </div>
    </section>
  );
}

/** The band's big figure and the lines under it, by kind. */
export type BandFigure = { label: string; short: string; figure: ReactNode; sub: ReactNode; partial: string | null; /** The compact bar's figure, at its size; null with no figure. */ bar: ReactNode };

/** A rental: the year's total return on the money in the deal, or why there is no per-cent yet. */
export function rentBandFigure(r: PropertyReturns): BandFigure {
  const totalBp = r.sources.totalBp;
  const moneyIn = r.equity.moneyInMinor;
  const cashOut = cashOutMinor(r);
  const infinite = infiniteTotal(r);
  const cover = coverLine(r);
  const before = beforeFirstRent(r);
  // FLOW-473: the total scales from the first rent too, so below MIN_EARNING_DAYS it is no figure yet.
  const few = cashOut == null && totalBp != null && fewDays(r);
  const sources = rentParts(r).filter((part) => part.key === "appreciation" || part.key === "tax");
  const partial = (cashOut == null ? totalBp != null : !infinite) && !before && !few
    ? partialLine(sources.filter((source) => source.value.kind !== "money").map((source) => source.label))
    : null;
  let figure: ReactNode;
  if (infinite) figure = <InfinityFigure className="ui-num t-band" />;
  else if (cashOut != null && !before) figure = <span className="t-band"><Amount agorot={r.sources.totalMinor} currency={r.currency} loss /></span>;
  else if (before) figure = <span className="ui-pinv-band-note t-name">{BEFORE_FIRST_RENT}</span>;
  else if (few) figure = <span className="ui-pinv-band-note t-name">{FEW_DAYS}</span>;
  else if (totalBp != null) figure = <bdi dir="ltr" className="ui-num t-band">{percentText(totalBp)}</bdi>;
  else figure = <span className="ui-pinv-band-note t-name">{firstMissing(r, ["purchase"]) == null ? "לא מחושב" : "חסר"}</span>;
  let sub: ReactNode = null;
  // FLOW-469: a loss in a per-cent's place says it is one; with a negative cash flow, how long the cash out lasts.
  if (cashOut != null && !infinite && !before) sub = cover == null ? LOSS_YEAR : `${LOSS_YEAR} · ${cover}`;
  else if (cover != null) sub = cover;
  else if (cashOut != null) sub = <AllCashOutMeta minor={cashOut} currency={r.currency} />;
  else if (few) sub = fewDaysText(r);
  else if (totalBp != null && moneyIn != null && !before) {
    sub = <><Amount agorot={r.sources.totalMinor} currency={r.currency} />{" בשנה על "}<Amount agorot={moneyIn} currency={r.currency} /></>;
  }
  const bar = totalBp != null && !before && !few && cashOut == null ? <bdi dir="ltr" className="ui-num">{percentText(totalBp)}</bdi> : null;
  return { label: "תשואה כוללת · שנה · על הכסף בעסקה", short: "תשואה כוללת", figure, sub, partial, bar };
}

/** A renovation (FLOW-1068): the net profit the sale at the ARV leaves, and its ROI on the cash in the deal. */
export function flipBandFigure(r: PropertyReturns): BandFigure {
  const net = r.deal.netProfitMinor;
  const missing = firstMissing(r, ["arv", "purchase"]);
  const figure: ReactNode = net != null
    ? <Amount agorot={net} currency={r.currency} loss={net < 0n} size="hero" compact />
    : <span className="ui-pinv-band-note t-name">{missing == null ? "לא מחושב" : "חסר"}</span>;
  const roi = anyMetricValue("flip-roi", r);
  const sub: ReactNode = net == null
    ? (missing == null ? "ARV פחות כל העלויות" : missingHint(missing))
    : roi.kind === "text" ? <>{/* An isolate, so the line stays right to left though it starts with Latin. */}<bdi dir="ltr">ROI</bdi>{" "}<bdi dir="ltr" className="ui-num">{roi.text}</bdi>{" על הכסף בעסקה"}</> : "ARV פחות כל העלויות";
  return {
    label: "רווח נקי צפוי במכירה",
    short: "רווח נקי צפוי",
    figure,
    sub,
    partial: null,
    bar: net == null ? null : <Amount agorot={net} currency={r.currency} loss={net < 0n} presentation="detail" />,
  };
}

/** The two rows under the band's figure: what each shows and what it opens. */
export type BandRow = { key: string; label: string; value: FigureValue; open: PartOpen };

export function bandRows(kind: InvestmentKind, r: PropertyReturns): BandRow[] {
  if (kind === "rent") {
    return [
      { key: "money-in", label: "כסף בעסקה", value: sourceValue(r.equity.moneyInMinor, r, ["purchase"]), open: { kind: "target", target: { kind: "part", part: "money-in" } } },
      { key: "equity", label: "הון עצמי היום", value: sourceValue(r.equity.todayMinor, r, ["value"]), open: { kind: "info", key: "equity_today" } },
    ];
  }
  return [
    { key: "arv", label: "שווי אחרי שיפוץ (ARV)", value: r.inputs.arvMinor == null ? { kind: "missing", add: "arv" } : { kind: "money", minor: r.inputs.arvMinor }, open: { kind: "target", target: { kind: "edit", field: "arv" } } },
    { key: "money-in", label: "כסף בעסקה", value: sourceValue(r.equity.moneyInMinor, r, ["purchase"]), open: { kind: "target", target: { kind: "part", part: "money-in" } } },
  ];
}

/** A band row: a link, a button, or (a viewer's input) a plain line. */
export function BandRowLink({ row, currency, resolve, onInfo, readOnly }: { row: BandRow; currency: string; resolve: Resolve; onInfo: OnInfo; readOnly: boolean }) {
  const body: ReactNode = (
    <>
      <span className="ui-pinv-band-row-label">{row.label}</span>
      <span className="ui-pinv-band-row-amount"><FigureText value={row.value.kind === "missing" ? { kind: "missing", add: null, note: "חסר" } : row.value} currency={currency} /></span>
    </>
  );
  if (row.open?.kind === "info") {
    const key = row.open.key;
    return <button type="button" className="ui-band-row-link ui-pinv-band-row m-press" onClick={(event: MouseEvent<HTMLButtonElement>) => { onInfo(key, event.currentTarget); }}>{body}</button>;
  }
  const target = row.open?.target;
  const action = target == null || (readOnly && target.kind === "edit") ? null : resolve(target);
  if (action == null) return <div className="ui-band-row-link ui-pinv-band-row">{body}</div>;
  if ("href" in action) return <Link to={action.href} className="ui-band-row-link ui-pinv-band-row m-press">{body}</Link>;
  return <button type="button" className="ui-band-row-link ui-pinv-band-row m-press" onClick={action.onClick}>{body}</button>;
}

/** What a missing input is for, on its card: the figure it lets the page work out. */
const MISSING_TITLES: Record<EditField, string> = {
  purchase: "חסר מחיר רכישה לחישוב התשואה",
  value: "חסר שווי היום לעליית ערך ולהון העצמי",
  land: "חסר שווי הקרקע לחישוב הפחת",
  tax_bracket: "חסרה מדרגת מס לחיסכון מס",
  arv: "חסר ARV לחישוב הרווח הצפוי",
  units: "חסר מספר יחידות",
  selling_cost: "חסרות עלויות מכירה",
};

/** FLOW-1097: what each card names under 360px, with its tag ("חסר"); what it is for is in its title. */
const MISSING_SHORT: Record<EditField, [short: string, tag: string]> = {
  purchase: ["מחיר רכישה", "חסר"],
  value: ["שווי היום", "חסר"],
  land: ["שווי הקרקע", "חסר"],
  tax_bracket: ["מדרגת מס", "חסרה"],
  arv: ["ARV", "חסר"],
  units: ["מספר יחידות", "חסר"],
  selling_cost: ["עלויות מכירה", "חסרות"],
};

/**
 * FLOW-1047: "חסר לחישוב" as attention cards, each opening its input's sheet (`?edit=`), each hidden on
 * this device until what it counts changes. A viewer adds nothing, so has none.
 */
export function investmentAttentionRows(kind: InvestmentKind, r: PropertyReturns, base: string, search: string, readOnly: boolean): BannerRow[] {
  if (readOnly) return [];
  const icon = <span className="ui-pinv-attn-dot" aria-hidden="true" />;
  const row = (field: EditField, dismissKey: string, title = MISSING_TITLES[field], [short, tag] = MISSING_SHORT[field]): BannerRow => ({
    id: `missing-${field}`,
    to: `${base}${withParam(search, "edit", field)}`,
    title,
    short,
    tag,
    icon,
    dismissKey,
  });
  const rows: BannerRow[] = [];
  if (kind === "flip") {
    // Board V3-Investment: a typed ARV is the owner's estimate, and the profit rests on it, so the card asks to check it.
    if (r.inputs.arvMinor == null) rows.push(row("arv", "arv"));
    else rows.push({ ...row("arv", `estimate:${String(r.inputs.arvMinor)}`, "ARV מבוסס על הערכה שלכם", ["ARV", "הערכה"]), id: "arv-estimate" });
    if (r.inputs.purchaseMinor == null) rows.push(row("purchase", "purchase", "חסר מחיר רכישה לחישוב הרווח"));
    return rows;
  }
  for (const input of r.missing) {
    if (input === "value_history") {
      // One value alone: appreciation needs a second one, so the card asks to update it.
      const date = r.inputs.valueDate;
      rows.push(row("value", `history:${date ?? ""}`, date == null ? "עדכון שווי נוסף לעליית ערך" : `שווי עודכן ב־${formatDisplay(date)} · עדכון נוסף לעליית ערך`, ["עדכון שווי", date == null ? "חסר" : formatDisplay(date)]));
    } else if (input === "land") {
      // FLOW-470: a land the books suggest is taken with its השתמש on the property's figures.
      if (r.inputs.landSuggestion == null) rows.push(row("land", "land"));
    } else {
      rows.push(row(input, input));
    }
  }
  return rows;
}

function MetricRow({ metric, r, href, onAdd }: { metric: AnyMetricKey; r: PropertyReturns; href: string; onAdd: ((field: EditField) => void) | undefined }) {
  const value = anyMetricValue(metric, r);
  // FLOW-459: a missing input shows only הוספה; the hint says what is missing.
  const add = value.kind === "missing" && onAdd != null ? value.add : null;
  const negative = (value.kind === "money" && value.minor < 0n) || (value.kind === "text" && value.text.startsWith("−"));
  const body: ReactNode = (
    <>
      <span className="ui-pinv-row-text">
        <span className="ui-pinv-row-title">{anyMetricTitle(metric)}</span>
        <span className="ui-pinv-hint">{add == null ? anyMetricCaption(metric, r) : missingHint(add)}</span>
      </span>
      <span className={negative ? "ui-pinv-value ui-ret-fixed-metric ui-loss" : "ui-pinv-value ui-ret-fixed-metric"}>
        {add == null ? <FigureText value={value} currency={r.currency} loss /> : <span className="ui-ret-add">הוספה</span>}
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

function MetricSection({ group, r, base, search, onAdd }: { group: MetricGroup; r: PropertyReturns; base: string; search: string; onAdd: ((field: EditField) => void) | undefined }) {
  const titleId = useId();
  return (
    <section className="ui-month ui-pinv-group" aria-labelledby={titleId}>
      <GroupHead id={titleId} title={group.title} summary="" />
      {group.metrics.map((metric) => (
        <MetricRow key={metric} metric={metric} r={r} href={`${base}/metric/${metric}${search}`} onAdd={onAdd} />
      ))}
    </section>
  );
}

/**
 * "מדדים" (FLOW-1068, boards V3-Investment and V3-Investment-Rent): today's numbers, no targets, in
 * groups by kind: a rental's return, risk and price, a renovation's return and price. Each opens its
 * calculation page.
 */
export function MetricsGroup({ kind, returns: r, base, search, onAdd }: { kind: InvestmentKind; returns: PropertyReturns; base: string; search: string; onAdd: ((field: EditField) => void) | undefined }) {
  const groups = kind === "rent" ? RENT_GROUPS : FLIP_GROUPS;
  return (
    <>
      {groups.map((group) => <MetricSection key={group.key} group={group} r={r} base={base} search={search} onAdd={onAdd} />)}
    </>
  );
}

/** The returns' parts while they load: one card of skeleton rows. */
export function ReturnsCardsSkeleton() {
  return (
    <section className="ui-pinv-card ui-pinv-parts" aria-busy="true">
      <p className="sr-only" role="status">טוען…</p>
      <ListRow variant="skeleton" layout="inset" />
      <ListRow variant="skeleton" layout="inset" />
      <ListRow variant="skeleton" layout="inset" />
    </section>
  );
}

/** The returns read failed: one line with נסו שוב, in the parts' place. */
export function ReturnsCardsFailed({ offline, onRetry }: { offline: boolean; onRetry: () => void }) {
  return (
    <section className="ui-pinv-card ui-pinv-parts" aria-label="ממה מורכבת התשואה">
      <FailureLine offline={offline} onRetry={onRetry} />
    </section>
  );
}
