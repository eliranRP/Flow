/**
 * A hint whose parts are joined by " · " (FLOW-415 design review): each part keeps its words together
 * and the "·" ends the part before it, so a narrow line wraps between whole parts and never starts
 * with a separator.
 */
export function HintParts({ text }: { text: string }) {
  const parts = text.split(" · ");
  return (
    <>
      {parts.flatMap((part, index) => {
        const span = (
          <span key={`${String(index)}:${part}`} className="ui-nowrap">
            {index < parts.length - 1 ? `${part} ·` : part}
          </span>
        );
        return index > 0 ? [" ", span] : [span];
      })}
    </>
  );
}
