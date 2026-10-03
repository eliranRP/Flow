import { useId, type ReactNode, type Ref } from "react";
import { cx } from "./cx";

type ToggleProps = {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  /** Stays focusable. The caller ignores a second change while this is set. */
  busy?: boolean;
  /** Draws the switch as a grouped list row, with the icon in the same slot as SUMIT. */
  icon?: ReactNode;
  /** The checkbox. A recovered Jev retry moves focus here. */
  inputRef?: Ref<HTMLInputElement>;
  onChange: (checked: boolean) => void;
};

/** A 44px row. The switch is off, on, or disabled with not-allowed. */
export function Toggle({ label, hint, checked, disabled = false, busy = false, icon, inputRef, onChange }: ToggleProps) {
  const hintId = useId();
  const described = hint != null ? hintId : undefined;
  const row = icon != null;
  return (
    <label className={cx(row ? "ui-row ui-switch-row" : "ui-switch-row")}>
      {row ? (
        <span className="ui-row-main">
          <span className="ui-row-icon">{icon}</span>
          <span className="ui-row-text">
            <span className="ui-row-title">{label}</span>
            {hint != null ? (
              <span id={hintId} className="ui-row-hint t-hint">{hint}</span>
            ) : null}
          </span>
        </span>
      ) : (
        <span className="ui-switch-copy">
          <span className="ui-switch-label">{label}</span>
          {hint != null ? <span id={hintId} className="t-hint">{hint}</span> : null}
        </span>
      )}
      <input
        ref={inputRef}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-busy={busy || undefined}
        aria-label={label}
        aria-describedby={described}
        onChange={(event) => {
          if (disabled || busy) return;
          onChange(event.target.checked);
        }}
      />
      <span className="ui-switch" aria-hidden="true">
        <i />
      </span>
    </label>
  );
}
