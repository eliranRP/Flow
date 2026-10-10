/**
 * A hint whose parts are joined by " · " (FLOW-351): each part keeps its words together and carries
 * the "·" before it, so a narrow line breaks before a separator and never ends on one.
 */
export function HintParts({ text }: { text: string }) {
  const parts = text.split(" · ");
  return (
    <>
      {parts.map((part, index) => (
        <span key={`${String(index)}:${part}`} className="ui-nowrap">
          {index > 0 ? `· ${part}` : part}
        </span>
      )).flatMap((span, index) => (index > 0 ? [" ", span] : [span]))}
    </>
  );
}
