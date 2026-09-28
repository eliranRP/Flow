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
  label: string;
};

export function BudgetBar({ spentAgorot, budgetAgorot, label }: BudgetBarProps) {
  const over = budgetAgorot > 0n && spentAgorot > budgetAgorot;
  const ratio = budgetAgorot <= 0n ? 0 : Number(spentAgorot) / Number(budgetAgorot);
  const width = Math.min(100, Math.max(0, Math.round(ratio * 100)));
  return (
    <div>
      <p className="ui-field-label">
        {label}
        {over ? " · מעל התקציב" : ""}
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
        <bdi dir="ltr">{formatAmount(spentAgorot)}</bdi>
        {" / "}
        <bdi dir="ltr">{formatAmount(budgetAgorot)}</bdi>
      </p>
    </div>
  );
}
