import type { ReactNode } from "react";

/**
 * A hint whose parts are joined by " · " (FLOW-415 design review): each part keeps its words together
 * and a narrow line wraps between whole parts. A separator never starts or ends a line: every part
 * after the first carries its "·" in a box at its start, and the box of a part that opens a line
 * sits in the clipped margin, so the break shows no dot. Screen readers skip the dots. A part wider
 * than the whole line wraps at its own spaces instead of being clipped (FLOW-429).
 */
export function HintParts({ text, parts }: { text?: string; parts?: readonly ReactNode[] }) {
  const items = parts ?? (text ?? "").split(" · ");
  return (
    <span className="ui-hint-wrap">
      <span className="ui-hint-wrap-in">
        {items.map((part, index) => (
          <span key={index} className="ui-hint-wrap-part">
            {index > 0 ? <span className="ui-hint-wrap-sep" aria-hidden="true"> · </span> : null}
            {part}
          </span>
        ))}
      </span>
    </span>
  );
}
