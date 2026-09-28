type CheckboxProps = {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
};

export function Checkbox({ label, checked, onChange, disabled = false }: CheckboxProps) {
  return (
    <label className="ui-toggle">
      <span>{label}</span>
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
      <span className="ui-check" data-on={checked ? "true" : "false"} aria-hidden="true">
        {checked ? "✓" : ""}
      </span>
    </label>
  );
}
