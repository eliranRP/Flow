import { useRef, type KeyboardEvent } from "react";
import { cx } from "./cx";

type Option<T extends string> = { value: T; label: string };

type SegmentedControlProps<T extends string> = {
  label: string;
  /** Categories keeps the name for the group and does not print it under the title. */
  showLabel?: boolean;
  /** Categories uses the input radius. Other screens keep the segment token. */
  radius?: "segment" | "input";
  value: T;
  options: Array<Option<T>>;
  onChange: (value: T) => void;
};

/** Roving tabindex. Arrow keys follow the reading direction, so they reverse under dir=rtl. */
export function SegmentedControl<T extends string>({
  label,
  showLabel = true,
  radius = "segment",
  value,
  options,
  onChange,
}: SegmentedControlProps<T>) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const index = Math.max(0, options.findIndex((option) => option.value === value));

  function move(delta: number) {
    if (options.length === 0) return;
    const next = (index + delta + options.length) % options.length;
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    buttons.current[next]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    let delta = 0;
    if (event.key === "ArrowDown") delta = 1;
    else if (event.key === "ArrowUp") delta = -1;
    else if (event.key === "ArrowRight") delta = rtl ? -1 : 1;
    else if (event.key === "ArrowLeft") delta = rtl ? 1 : -1;
    else return;
    event.preventDefault();
    move(delta);
  }

  return (
    <div className="ui-field">
      {showLabel ? <span className="ui-field-label">{label}</span> : null}
    <div className={cx("ui-seg", radius === "input" && "ui-seg-input")} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
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
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            aria-label={option.label}
            onClick={() => {
              onChange(option.value);
            }}
          >
            <span className="ui-seg-label">{option.label}</span>
          </button>
        );
      })}
    </div>
    </div>
  );
}
