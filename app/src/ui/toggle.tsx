type ToggleProps = {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
};

export function Toggle({ label, hint, checked, onChange, disabled = false }: ToggleProps) {
  return (
    <button
      type="button"
      className="ui-toggle"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        onChange(!checked);
      }}
    >
      <span>
        <span className="ui-row-title">{label}</span>
        {hint ? <span className="ui-row-hint block">{hint}</span> : null}
      </span>
      <span className="ui-switch" data-on={checked ? "true" : "false"} aria-hidden="true">
        <span className="ui-knob" />
      </span>
    </button>
  );
}
