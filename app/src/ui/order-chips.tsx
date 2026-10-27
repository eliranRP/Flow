import type { KeyboardEvent } from "react";
import { cx } from "./cx";
import { onRadioArrow } from "./segmented-control";

/**
 * A page's order chips (FLOW-965, shared with the profit pages in FLOW-969): one choice, so a radiogroup with one
 * tab stop. The arrows are the shared radiogroup's (FLOW-966); Home and End jump to the first and the last order.
 * The chips are 44px (03-controls.css, `.ui-order-chips`); `className` lays the row out on its page.
 */
export function OrderChips<T extends string>({
  value,
  options,
  onChange,
  className,
  label = "סדר",
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (next: T) => void;
  className?: string;
  label?: string;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Home" && event.key !== "End") {
      onRadioArrow(event);
      return;
    }
    const radios = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    const target = event.key === "Home" ? radios[0] : radios.at(-1);
    if (!target) return;
    event.preventDefault();
    target.focus();
    target.click();
  }
  return (
    <div className={cx("ui-order-chips", className)} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="ui-chip ui-chip-choice"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          onClick={() => { onChange(option.value); }}
        >
          <span className="ui-chip-label" data-clip-ok="">{option.label}</span>
        </button>
      ))}
    </div>
  );
}
