import { cx } from "./cx";
import { WEEKDAY_HEADS, dayLabel, monthCells, weeksOf } from "./date-math";

type MonthGridProps = {
  label: string;
  year: number;
  month: number;
  today: string;
  value?: string | null;
  range?: { from: string; to: string } | null;
  onPick: (iso: string) => void;
};

/** One month. RangeSheet tints a span. A single chosen day uses the same grid. */
export function MonthGrid({ label, year, month, today, value, range, onPick }: MonthGridProps) {
  const cells = monthCells(year, month);
  const monthKey = String(month + 1).padStart(2, "0");
  return (
    <div className="ui-cal" role="grid" aria-label={label}>
      <div className="ui-cal-row" role="row">
        {WEEKDAY_HEADS.map((head) => (
          <span key={head} className="ui-cal-head" role="columnheader">
            {head}
          </span>
        ))}
      </div>
      {weeksOf(cells).map((week) => (
        <div key={week.join("-")} className="ui-cal-row" role="row">
          {week.map((iso) => {
            if (iso.slice(5, 7) !== monthKey) return <span key={iso} className="ui-day" />;
            const future = iso > today;
            const inRange = range != null && iso >= range.from && iso <= range.to;
            const edge = value === iso || (range != null && (iso === range.from || iso === range.to));
            return (
              <button
                key={iso}
                type="button"
                role="gridcell"
                className={cx("ui-day", inRange && "ui-day-range", edge && "ui-day-edge")}
                aria-label={dayLabel(iso)}
                aria-selected={edge}
                aria-current={iso === today ? "date" : undefined}
                disabled={future}
                onClick={() => {
                  onPick(iso);
                }}
              >
                <b>{Number(iso.slice(8, 10))}</b>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
