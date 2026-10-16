import type { ReactNode } from "react";
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

export type ProgressBarProps = ValueBarProps | JobBarProps;

/** Thin bars grow from the right on first render (FLOW-363, m-bar-grow). */
export function ProgressBar(props: ProgressBarProps) {
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

