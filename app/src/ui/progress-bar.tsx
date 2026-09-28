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
      <p className="ui-field-label">{label}</p>
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

/** Decision 0060: the bar stops at 100% in the danger colour. The overage is a line of text. */
export function BudgetBar({ spentAgorot, budgetAgorot, label = "תקציב" }: BudgetBarProps) {
  const over = budgetAgorot > 0n && spentAgorot > budgetAgorot;
  const ratio = budgetAgorot <= 0n ? 0 : Number(spentAgorot) / Number(budgetAgorot);
  const width = Math.min(100, Math.max(0, Math.round(ratio * 100)));
  const overage = over ? spentAgorot - budgetAgorot : 0n;
  return (
    <div>
      <p className="flex items-baseline justify-between gap-3">
        <span className="t-title-3">{label}</span>
        <span className="t-hint">
          <bdi dir="ltr">{formatAmount(spentAgorot)}</bdi>
          {" מתוך "}
          <bdi dir="ltr">{formatAmount(budgetAgorot)}</bdi>
        </span>
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
        <bdi dir="ltr">{`נוצלו ${String(width)}%`}</bdi> מהתקציב
      </p>
      {over ? (
        <p className="ui-overage t-hint">
          מעל התקציב ב־<bdi dir="ltr">{formatAmount(overage)}</bdi>
        </p>
      ) : null}
    </div>
  );
}
