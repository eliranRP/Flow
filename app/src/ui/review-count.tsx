/**
 * FLOW-309: one number of the queue counter ("1 מתוך 12"). Digits are tabular, and the box reserves
 * `digits` zeros (a hidden `::before`, so the text stays the number alone), so the index going 9→10 or 99→100
 * grows inside a box that doesn't move. The digits hug "מתוך": the index sits at its box's left edge, the
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

/**
 * Digits to reserve: the total's. The index never passes the total, so it never moves the counter;
 * only the total itself crossing 9→10 or 99→100 (new lines arriving) widens it, which is rare.
 */
export function reviewCountDigits(total: number): number {
  return String(total).length;
}
