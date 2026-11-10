import { useId } from "react";
import { PlusIcon } from "./icons";
import { MinusIcon } from "./icons-later";

/**
 * FLOW-106: a whole number from `min` to `max` with − and + (44px targets). The value is read as a
 * spinbutton, so arrow keys step it too. An end that can't go further is disabled.
 */
export function Stepper({
  label,
  value,
  min,
  max,
  hint,
  valueText,
  disabled = false,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  /** One line of dates or numbers under the label, such as the dates the value covers; drawn LTR. */
  hint?: string;
  /** The value in words with its unit, such as "10 שנים" (FLOW-1149); shown and read instead of the bare number. */
  valueText?: (value: number) => string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const labelId = useId();
  const hintId = useId();
  const step = (delta: number) => {
    const next = Math.min(max, Math.max(min, value + delta));
    if (!disabled && next !== value) onChange(next);
  };
  return (
    <div className="ui-stepper" data-disabled={disabled ? "true" : undefined}>
      <span className="ui-stepper-copy">
        <span id={labelId} className="t-line2">{label}</span>
        {hint ? <span id={hintId} className="t-caption t-muted ui-stepper-hint"><bdi className="ui-num" dir="ltr">{hint}</bdi></span> : null}
      </span>
      <span className="ui-stepper-controls">
        <button
          type="button"
          className="ui-stepper-btn ui-hit"
          aria-label={`פחות, ${label}`}
          disabled={disabled || value <= min}
          onClick={() => { step(-1); }}
        >
          <MinusIcon />
        </button>
        <span
          className={valueText ? "ui-stepper-value" : "ui-stepper-value ui-num"}
          role="spinbutton"
          tabIndex={disabled ? -1 : 0}
          aria-labelledby={labelId}
          aria-describedby={hint ? hintId : undefined}
          aria-valuenow={value}
          aria-valuetext={valueText?.(value)}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-disabled={disabled || undefined}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp" || event.key === "ArrowRight") { event.preventDefault(); step(1); }
            if (event.key === "ArrowDown" || event.key === "ArrowLeft") { event.preventDefault(); step(-1); }
            if (event.key === "Home") { event.preventDefault(); step(min - value); }
            if (event.key === "End") { event.preventDefault(); step(max - value); }
          }}
        >
          {valueText ? valueText(value) : value}
        </span>
        <button
          type="button"
          className="ui-stepper-btn ui-hit"
          aria-label={`יותר, ${label}`}
          disabled={disabled || value >= max}
          onClick={() => { step(1); }}
        >
          <PlusIcon size={20} stroke={2.2} />
        </button>
      </span>
    </div>
  );
}
