import { HintParts } from "./hint-parts";
import "./split-parts-hint.css";

export type SplitHintPart = { name: string; amount: string };

/**
 * FLOW-432 (design lead, option A): a split line's row hint names the parts its list counts, then
 * the whole line, so the row's figure reads as their sum: "חשמל $171.76 · מים וביוב $183.10", then
 * "מתוך $2,054.86 · 07/10" on a line of its own. More than two parts: the first, then "ועוד N", on
 * one line whose name ellipsizes. One part: its name only, since the row's figure is its amount.
 * The date shares the מתוך line or drops; it never sits alone. Amounts use tabular figures.
 * FLOW-425: amounts are never cut. Only names ellipsize; with "ועוד N", the first part's amount
 * drops before its name goes under about 3em. The מתוך line drops its date first; in a column too
 * narrow even for its total, the word "מתוך" ellipsizes, never the total.
 */
export function SplitPartsHint({ parts, total, date }: { parts: readonly SplitHintPart[]; total: string; date?: string }) {
  const [first] = parts;
  return (
    <span className="ui-split-hint">
      {first == null ? null : parts.length === 1 ? (
        <span className="ui-split-hint-line">
          <span className="ui-split-hint-name">{first.name}</span>
        </span>
      ) : parts.length === 2 ? (
        <HintParts parts={parts.map((part, index) => <PartText key={index} part={part} />)} />
      ) : (
        <span className="ui-split-hint-line">
          <span className="ui-split-hint-first">
            <span className="ui-split-hint-name">{first.name}</span>
            <PartAmount text={first.amount} />
          </span>
          <span className="ui-split-hint-more">{`\u00a0· ועוד ${String(parts.length - 1)}`}</span>
        </span>
      )}
      <HintParts
        parts={[
          <span key="total" className="ui-split-hint-part">
            <span className="ui-split-hint-name">מתוך</span>
            <PartAmount text={total} />
          </span>,
          ...(date ? [date] : []),
        ]}
        maxLines={1}
      />
    </span>
  );
}

function PartText({ part }: { part: SplitHintPart }) {
  return (
    <span className="ui-split-hint-part">
      <span className="ui-split-hint-name">{part.name}</span>
      <PartAmount text={part.amount} />
    </span>
  );
}

/** The space rides with the amount, so a name that ellipsizes ends at the edge, not at a gap. */
function PartAmount({ text }: { text: string }) {
  return (
    <span className="ui-split-hint-part-amount">
      {"\u00a0"}
      <SplitAmount text={text} />
    </span>
  );
}

function SplitAmount({ text }: { text: string }) {
  return (
    <bdi dir="ltr" className="ui-split-hint-amount">
      {text}
    </bdi>
  );
}
