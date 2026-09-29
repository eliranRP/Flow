import type { ReactNode } from "react";

type CheckRowProps = {
  label: string;
  /** Live ₪ share. Secondary until the row is checked. */
  value?: ReactNode;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  /** A read-only result row. No checkbox. */
  readOnly?: boolean;
};

/** A checklist row. The whole row is the hit area, and the checkbox sits on the start side. */
export function CheckRow({ label, value, checked = false, onChange, disabled = false, readOnly = false }: CheckRowProps) {
  const figure = value ? (
    <bdi className={checked || readOnly ? "ui-num ui-check-value" : "ui-num ui-check-value ui-check-value-idle"} dir="ltr">
      {value}
    </bdi>
  ) : null;
  if (readOnly) {
    return (
      <div className="ui-check-row">
        <span className="ui-row-title">{label}</span>
        {figure}
      </div>
    );
  }
  return (
    <button
      type="button"
      className="ui-check-row"
      aria-label={label}
      aria-pressed={checked}
      disabled={disabled}
      onClick={() => {
        onChange?.(!checked);
      }}
    >
      <span className="ui-check" data-on={checked ? "true" : "false"} aria-hidden="true">
        {checked ? "✓" : ""}
      </span>
      <span className="ui-row-title">{label}</span>
      {figure}
    </button>
  );
}
