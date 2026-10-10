import { HintParts } from "./hint-parts";

export type SplitHintPart = { name: string; amount: string };

/**
 * FLOW-432 (design lead, option A): a split line's row hint names the parts its list counts, then
 * the whole line, so the row's figure reads as their sum: "חשמל $171.76 · מים וביוב $183.10", then
 * "מתוך $2,054.86 · 07/10" on a line of its own. More than two parts: the first, then "ועוד N", on
 * one line whose name ellipsizes. One part: its name only, since the row's figure is its amount.
 * The date shares the מתוך line or drops; it never sits alone. Amounts use tabular figures.
 */
export function SplitPartsHint({ parts, total, date }: { parts: readonly SplitHintPart[]; total: string; date?: string }) {
  const [first] = parts;
  return (
    <span className="ui-split-hint">
      {first == null ? null : parts.length === 1 ? (
        <span className="ui-split-hint-line">{first.name}</span>
      ) : parts.length === 2 ? (
        <HintParts parts={parts.map((part, index) => <PartText key={index} part={part} />)} />
      ) : (
        <span className="ui-split-hint-line">
          <span className="ui-split-hint-name">{first.name}</span>
          <span className="ui-split-hint-more">
            {"\u00a0"}
            <SplitAmount text={first.amount} />
            {` · ועוד ${String(parts.length - 1)}`}
          </span>
        </span>
      )}
      <HintParts
        parts={[
          <span key="total">
            מתוך <SplitAmount text={total} />
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
    <span>
      {part.name} <SplitAmount text={part.amount} />
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
