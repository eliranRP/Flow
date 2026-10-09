/**
 * FLOW-309: one number of the queue counter ("1 מתוך 12"). Digits are tabular, and the box reserves
 * `digits` zeros (a hidden `::before`, so the text stays the number alone), so 9→10 and 99→100 grow
 * inside a box that doesn't move. The digits hug "מתוך": the index sits at its box's left edge, the
 * total at its right edge.
 */
export function ReviewCount({ value, digits, side }: { value: number; digits: number; side: "index" | "total" }) {
  const text = String(value);
  return (
    <bdi
      className="ui-num ui-review-count"
      dir="ltr"
      data-side={side}
      data-reserve={digits > text.length ? "0".repeat(digits) : undefined}
    >
      <span>{text}</span>
    </bdi>
  );
}

/** Digits to reserve: the total's, and at least two so a total of 9 reaching 10 doesn't move either. */
export function reviewCountDigits(total: number): number {
  return Math.max(2, String(total).length);
}
