import { formatAmount } from "./big-number";

type ProgressBarProps = {
  value: number;
  max?: number;
  label: string;
};

export function ProgressBar({ value, max = 100, label }: ProgressBarProps) {
  const safeMax = max <= 0 ? 1 : max;
  const ratio = Math.min(1, Math.max(0, value / safeMax));
  const percent = Math.round(ratio * 100);
  return (
    <div>
      <p className="ui-meter-label t-hint">{label}</p>
      <div className="ui-bar" role="meter" aria-label={label} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className="ui-bar-fill" style={{ width: `${String(percent)}%` }} />
      </div>
    </div>
  );
}

type BudgetBarProps = {
  spentAgorot: bigint;
  budgetAgorot: bigint;
  label?: string;
};

/**
 * Floors the used percent. 99.9% stays 99, and 100 appears only when the budget
 * is actually fully used. Over budget keeps the real percent (120 stays 120).
 */
export function budgetUsedPercent(spentAgorot: bigint, budgetAgorot: bigint): number {
  if (budgetAgorot <= 0n || spentAgorot <= 0n) return 0;
  const percent = Number((spentAgorot * 100n) / budgetAgorot);
  if (spentAgorot >= budgetAgorot) return Math.max(100, percent);
  return percent;
}

/** Decision 0060: the bar stops at 100% in the danger colour. The overage is a line of text. */
export function BudgetBar({ spentAgorot, budgetAgorot, label = "תקציב" }: BudgetBarProps) {
  const over = budgetAgorot > 0n && spentAgorot > budgetAgorot;
  const used = budgetUsedPercent(spentAgorot, budgetAgorot);
  const width = Math.min(100, used);
  const overage = over ? spentAgorot - budgetAgorot : 0n;
  return (
    <div className="ui-budget">
      <p className="ui-budget-title t-title-3">{label}</p>
      <p className="ui-budget-amounts t-hint">
        <bdi dir="ltr">{formatAmount(spentAgorot)}</bdi>
        <span>מתוך</span>
        <bdi dir="ltr">{formatAmount(budgetAgorot)}</bdi>
      </p>
      <div
        className="ui-bar"
        role="meter"
        aria-label={over ? `${label}, מעל התקציב` : label}
        aria-valuenow={width}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="ui-bar-fill" data-over={over ? "true" : "false"} style={{ width: `${String(width)}%` }} />
      </div>
      <p className="ui-row-hint">
        <bdi dir="ltr">{`נוצלו ${String(used)}%`}</bdi> מהתקציב
      </p>
      {over ? (
        <p className="ui-overage t-hint">
          מעל התקציב ב־<bdi dir="ltr">{formatAmount(overage)}</bdi>
        </p>
      ) : null}
    </div>
  );
}
