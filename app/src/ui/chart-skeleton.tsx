import { cx } from "./cx";

/**
 * FLOW-1139: a month chart's place while its months load, in the chart's own shape. The full chart (MonthChart's
 * card, .ui-fc-chart) is a title bar over six months, each a pair of bars on the chart's 108px scale and a label
 * under it. `mini` is the reports hub's 40px strip of ten bars (the P&L card's MonthBars). The blocks are
 * decorative: the page or card around it says what is loading. The caller decides when to show it.
 */
const PAIRS = [[56, 38], [70, 50], [46, 62], [82, 58], [64, 44], [90, 70]] as const;
const MINI = [40, 56, 48, 64, 52, 72, 60, 80, 68, 88] as const;

function Block({ height, className }: { height: number; className: string }) {
  return <span aria-hidden="true" className={cx("ui-skeleton-bar", className)} style={{ blockSize: `${String(height)}%` }} />;
}

export function ChartSkeleton({ mini = false }: { mini?: boolean }) {
  if (mini) {
    return (
      <span className="ui-chart-skel-mini" aria-hidden="true">
        {MINI.map((height, index) => <Block key={index} height={height} className="ui-chart-skel-mini-bar" />)}
      </span>
    );
  }
  return (
    <div className="ui-fc-chart ui-chart-skel" aria-hidden="true">
      <span aria-hidden="true" className="ui-skeleton-bar ui-chart-skel-title" />
      <div className="ui-chart-skel-months">
        {PAIRS.map(([income, expense], index) => (
          <span key={index} className="ui-chart-skel-month">
            <span className="ui-fc-pair">
              <Block height={income} className="ui-chart-skel-bar" />
              <Block height={expense} className="ui-chart-skel-bar" />
            </span>
            <span aria-hidden="true" className="ui-skeleton-bar ui-chart-skel-label" />
          </span>
        ))}
      </div>
    </div>
  );
}
