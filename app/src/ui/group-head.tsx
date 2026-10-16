import type { ReactNode } from "react";

/**
 * A sticky group head (FLOW-334, FLOW-347): the group's name, and under it its line count and its
 * sums in muted meta, start-aligned. It pins under the month bar's offset (`--month-sticky-top`), so a
 * scroll box that is not the page can move it.
 */
export function GroupHead({ id, title, count, children }: { id: string; title: string; count: string; children: ReactNode }) {
  return (
    <div className="ui-month-head ui-group-head">
      <h2 className="ui-month-title ui-group-title t-heading" id={id}>{title}</h2>
      <p className="ui-month-totals t-label">
        <span className="ui-group-count">{count}</span>
        {children}
      </p>
    </div>
  );
}
