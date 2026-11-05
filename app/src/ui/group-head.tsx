import type { ReactNode } from "react";

type GroupHeadProps =
  | { id: string; title: string; count: string; children: ReactNode; summary?: undefined }
  | {
      id: string;
      title: string;
      /**
       * FLOW-1043: one line, the title at the start and this at the end in meta secondary ("6 · $512 יצא"),
       * with a hairline under it. Its sticky top follows the compact bar and its dock.
       */
      summary: ReactNode;
      count?: undefined;
      children?: undefined;
    };

/**
 * A sticky group head (FLOW-334, FLOW-347): the group's name, and under it its line count and its
 * sums in muted meta, start-aligned. It pins under the month bar's offset (`--month-sticky-top`), so a
 * scroll box that is not the page can move it. With `summary` it is the v3 one-line head (FLOW-1043).
 */
export function GroupHead({ id, title, count, children, summary }: GroupHeadProps) {
  if (summary != null) {
    return (
      <div className="ui-month-head ui-group-head ui-group-head-line">
        <h2 className="ui-month-title ui-group-title t-section" id={id}>{title}</h2>
        <p className="ui-group-summary t-meta">{summary}</p>
      </div>
    );
  }
  return (
    <div className="ui-month-head ui-group-head">
      <h2 className="ui-month-title ui-group-title t-sheet" id={id}>{title}</h2>
      <p className="ui-month-totals t-line2">
        <span className="ui-group-count">{count}</span>
        {children}
      </p>
    </div>
  );
}
