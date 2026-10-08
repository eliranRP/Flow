import { cx } from "./cx";

/**
 * "▲ ברווח" or "▼ הפסד" on a project or month row (profit by period, plan §2). A loss is `bad`;
 * a profit stays muted and is never green (decision 0120). The triangle is hidden from readers,
 * so the word carries the meaning, not the colour.
 */
export function ProfitMark({ loss }: { loss: boolean }) {
  return (
    <span className={cx("ui-profit-mark", loss && "ui-profit-mark-loss")}>
      <span aria-hidden="true">{loss ? "▼" : "▲"} </span>
      {loss ? "הפסד" : "ברווח"}
    </span>
  );
}
