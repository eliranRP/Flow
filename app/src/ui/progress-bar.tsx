import type { ReactNode } from "react";
import { formatAmount } from "./amount";
import { Button } from "./button";
import { CheckIcon } from "./icons";

type ValueBarProps = {
  /** bar: a labelled bar over its label. thin: a 6px bar beside its caption. */
  variant?: "bar" | "thin";
  value: number;
  max?: number;
  label: string;
  caption?: ReactNode;
};

type SplitBarProps = {
  /** Spent against a budget, with the used percent and any overrun in words. */
  variant: "split";
  spentAgorot: bigint;
  budgetAgorot: bigint;
  label: string;
};

export type JobStep = { label: string; state: "done" | "doing" | "todo" };

/**
 * A long known job, such as the first sync or an import (FLOW-371): an 8px bar, a count, the step
 * list, and always a way to leave. Leaving does not stop the job.
 */
type JobBarProps = {
  variant: "job";
  value: number;
  max: number;
  label: string;
  /** The count line, e.g. "120 מתוך כ־340 תנועות". The caller formats it. */
  count: string;
  steps: JobStep[];
  onLeave: () => void;
  /** The leave button's label. The job goes on in the background. */
  leaveLabel?: string;
};

export type ProgressBarProps = ValueBarProps | SplitBarProps | JobBarProps;

/** Thin bars grow from the right on first render (FLOW-363, m-bar-grow). */
export function ProgressBar(props: ProgressBarProps) {
  if (props.variant === "split") return <SplitBar {...props} />;
  if (props.variant === "job") return <JobBar {...props} />;
  return <ValueBar {...props} />;
}

function JobBar({ value, max, label, count, steps, onLeave, leaveLabel = "המשך לבית בינתיים" }: JobBarProps) {
  const safeMax = max <= 0 ? 1 : max;
  const ratio = Math.min(1, Math.max(0, value / safeMax));
  return (
    <div className="ui-job">
      <p className="ui-job-count t-hint">{count}</p>
      <div
        className="ui-job-bar ui-bar"
        role="meter"
        aria-label={label}
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="ui-bar-grow m-bar-grow">
          <div className="ui-bar-fill" style={{ transform: `scaleX(${String(ratio)})` }} />
        </div>
      </div>
      <ol className="ui-job-steps">
        {steps.map((step) => (
          <li key={step.label} className="ui-job-step" data-state={step.state} aria-current={step.state === "doing" ? "step" : undefined}>
            <span className="ui-job-mark" aria-hidden="true">
              {step.state === "done" ? <CheckIcon /> : null}
              {step.state === "doing" ? <span className="ui-spinner" /> : null}
              {step.state === "todo" ? <span className="ui-job-ring" /> : null}
            </span>
            {step.label}
          </li>
        ))}
      </ol>
      <Button variant="secondary" onClick={onLeave}>
        {leaveLabel}
      </Button>
    </div>
  );
}

function ValueBar({ variant = "bar", value, max = 100, label, caption }: ValueBarProps) {
  const safeMax = max <= 0 ? 1 : max;
  const ratio = Math.min(1, Math.max(0, value / safeMax));
  const percent = Math.round(ratio * 100);
  const bar = (
    <div
      className="ui-bar"
      role="meter"
      aria-label={label}
      aria-valuenow={variant === "bar" ? percent : value}
      aria-valuemin={0}
      aria-valuemax={variant === "bar" ? 100 : safeMax}
    >
      <div className="ui-bar-grow m-bar-grow">
        <div className="ui-bar-fill" style={{ transform: `scaleX(${String(ratio)})` }} />
      </div>
    </div>
  );
  if (variant === "thin") {
    return (
      <div className="ui-meter-row">
        {bar}
        {caption}
      </div>
    );
  }
  return (
    <div>
      <p className="ui-meter-label t-hint">{label}</p>
      {bar}
      {caption}
    </div>
  );
}

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
function SplitBar({ spentAgorot, budgetAgorot, label }: SplitBarProps) {
  const over = budgetAgorot > 0n && spentAgorot > budgetAgorot;
  const used = budgetUsedPercent(spentAgorot, budgetAgorot);
  const width = Math.min(100, used);
  const overage = over ? spentAgorot - budgetAgorot : 0n;
  return (
    <div className="ui-budget">
      <div className="ui-budget-head">
        <p className="ui-budget-title t-title-3">{label}</p>
        <p className="ui-budget-amounts t-hint">
          <bdi dir="ltr">{formatAmount(spentAgorot)}</bdi>
          <span>מתוך</span>
          <bdi dir="ltr">{formatAmount(budgetAgorot)}</bdi>
        </p>
      </div>
      <div
        className="ui-bar"
        role="meter"
        aria-label={over ? `${label}, מעל התקציב` : label}
        aria-valuenow={width}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="ui-bar-grow m-bar-grow">
          <div
            className="ui-bar-fill"
            data-over={over ? "true" : "false"}
            style={{ transform: `scaleX(${String(width / 100)})` }}
          />
        </div>
      </div>
      <p className="ui-row-hint">
        נוצלו <bdi dir="ltr">{String(used)}%</bdi> מהתקציב
      </p>
      {over ? (
        <p className="ui-overage t-hint">
          מעל התקציב ב־<bdi dir="ltr">{formatAmount(overage)}</bdi>
        </p>
      ) : null}
    </div>
  );
}
