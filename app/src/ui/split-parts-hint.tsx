import { HintParts } from "./hint-parts";

export type SplitHintPart = { name: string; amount: string };

/**
 * FLOW-432 (design lead, option A): a split line's row hint names the parts its list counts, then
 * the whole line, so the row's figure reads as their sum: "חשמל $171.76 · מים וביוב $183.10 ·
 * מתוך $2,054.86 · 07/10". More than two parts: the first, then "ועוד N". One part: its name only,
 * since the row's figure is its amount. Whole parts wrap to at most three lines (two part names with
 * cents rarely share a line at 390); the date goes last, so it is the first to go. Amounts use tabular figures.
 */
export function SplitPartsHint({
  parts,
  total,
  date,
}: {
  parts: readonly SplitHintPart[];
  total: string;
  date?: string;
}) {
  const named = parts.length > 2 ? parts.slice(0, 1) : parts;
  const items = [
    ...named.map((part, index) =>
      parts.length === 1 ? (
        part.name
      ) : (
        <span key={index}>
          {part.name} <SplitAmount text={part.amount} />
        </span>
      ),
    ),
    ...(parts.length > 2 ? [`ועוד ${String(parts.length - 1)}`] : []),
    <span key="total">
      מתוך <SplitAmount text={total} />
    </span>,
    ...(date ? [date] : []),
  ];
  return <HintParts parts={items} maxLines={3} />;
}

function SplitAmount({ text }: { text: string }) {
  return (
    <bdi dir="ltr" className="ui-split-hint-amount">
      {text}
    </bdi>
  );
}
