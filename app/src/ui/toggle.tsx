import type { ReactNode } from "react";

type ToggleProps = {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
};

/** A 44px row. The switch is off, on, or disabled with not-allowed. */
export function Toggle({ label, hint, checked, disabled = false, onChange }: ToggleProps) {
  return (
    <label className="ui-switch-row">
      <span className="ui-switch-copy">
        <span className="ui-switch-label" data-clip-ok="">{label}</span>
        {hint ? <span className="t-hint">{hint}</span> : null}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
      <span className="ui-switch" aria-hidden="true">
        <i />
      </span>
    </label>
  );
}
