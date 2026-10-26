import { useRef, type KeyboardEvent } from "react";
import { cx } from "./cx";

type Option<T extends string> = {
  value: T;
  label: string;
  /** Drawn instead of the label under 360px. The label stays the accessible name. */
  short?: string;
  /** A number or percent ("90%"): drawn in an LTR bdi, as every number (DESIGN-RULES numbers rule). */
  numeric?: boolean;
  /** The accessible name when it says more than the label ("3 חודשים, חזרה להיום"). */
  name?: string;
};

type SegmentedControlProps<T extends string> = {
  label: string;
  /** Categories keeps the name for the group and does not print it under the title. */
  showLabel?: boolean;
  /** Categories uses the input radius. Other screens keep the segment token. */
  radius?: "segment" | "input";
  value: T;
  options: Array<Option<T>>;
  onChange: (value: T) => void;
  /** The hint under the control. The group points at it. */
  describedBy?: string;
  disabled?: boolean;
  /**
   * A save is running: the group says aria-busy and ignores taps and arrow keys, but stays
   * enabled, so the focused segment keeps focus (disabling it would send focus to the body).
   */
  busy?: boolean;
  /** The period bar sits on the violet band: a translucent track and white text (decision 0141). */
  tone?: "page" | "band";
  /** FLOW-965: a switch between views (a month's נכנס and יצא) is a tab list; a choice stays a radio group. */
  role?: "radio" | "tab";
};

/** The step an arrow key takes through a radiogroup: it follows the reading direction, so it reverses under dir=rtl. 0 for any other key. */
export function arrowDelta(event: KeyboardEvent<HTMLElement>): number {
  const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
  if (event.key === "ArrowDown") return 1;
  if (event.key === "ArrowUp") return -1;
  if (event.key === "ArrowRight") return rtl ? -1 : 1;
  if (event.key === "ArrowLeft") return rtl ? 1 : -1;
  return 0;
}

/**
 * A radiogroup of plain buttons (FLOW-966): an arrow key moves focus to the next radio in the group and
 * checks it, as a click would. Each radio's tabIndex keeps the group to one tab stop.
 */
export function onRadioArrow(event: KeyboardEvent<HTMLElement>) {
  const delta = arrowDelta(event);
  if (delta === 0) return;
  const radios = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)')];
  const at = radios.findIndex((radio) => radio === document.activeElement);
  if (at < 0) return;
  event.preventDefault();
  const next = radios[(at + delta + radios.length) % radios.length];
  next?.focus();
  next?.click();
}

/** Roving tabindex. Arrow keys follow the reading direction, so they reverse under dir=rtl. */
export function SegmentedControl<T extends string>({
  label,
  showLabel = true,
  radius = "segment",
  value,
  options,
  onChange,
  describedBy,
  disabled = false,
  busy = false,
  tone = "page",
  role = "radio",
}: SegmentedControlProps<T>) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const found = options.findIndex((option) => option.value === value);
  const index = Math.max(0, found);

  function move(delta: number) {
    if (options.length === 0 || busy) return;
    const next = (index + delta + options.length) % options.length;
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    buttons.current[next]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const delta = arrowDelta(event);
    if (delta === 0) return;
    event.preventDefault();
    move(delta);
  }

  return (
    <div className="ui-field">
      {showLabel ? <span className="ui-field-label">{label}</span> : null}
      <div
        className={cx("ui-seg", radius === "input" && "ui-seg-input", tone === "band" && "ui-seg-band")}
        role={role === "tab" ? "tablist" : "radiogroup"}
        aria-label={label}
        aria-describedby={describedBy}
        aria-disabled={disabled || undefined}
        aria-busy={busy || undefined}
        onKeyDown={disabled ? undefined : onKeyDown}
      >
      {options.map((option, optionIndex) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              buttons.current[optionIndex] = node;
            }}
            type="button"
            className="ui-seg-btn"
            role={role}
            aria-checked={role === "radio" ? selected : undefined}
            aria-selected={role === "tab" ? selected : undefined}
            // With no option selected (a custom period), the first one keeps the group's tab stop.
            tabIndex={selected || (found < 0 && optionIndex === 0) ? 0 : -1}
            aria-label={option.name ?? option.label}
            disabled={disabled}
            onClick={() => {
              if (disabled || busy) return;
              onChange(option.value);
            }}
          >
            <span className="ui-seg-label" data-clip-ok="">
              {option.numeric === true ? <bdi className="ui-num" dir="ltr">{option.label}</bdi> : option.short == null ? option.label : (
                <>
                  <span className="ui-seg-long">{option.label}</span>
                  <span className="ui-seg-short" aria-hidden="true">{option.short}</span>
                </>
              )}
            </span>
          </button>
        );
      })}
    </div>
    </div>
  );
}
