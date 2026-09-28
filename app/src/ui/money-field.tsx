import { useId } from "react";

type MoneyFieldProps = {
  label: string;
  value: string;
  onValueChange: (raw: string) => void;
  error?: string;
  id?: string;
  disabled?: boolean;
};

function digitsOnly(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, "");
  const [whole, frac] = cleaned.split(".");
  if (frac == null) return whole ?? "";
  return `${whole ?? ""}.${frac.slice(0, 2)}`;
}

function grouped(raw: string): string {
  if (raw === "") return "";
  const [whole, frac] = raw.split(".");
  const withCommas = (whole ?? "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac == null ? withCommas : `${withCommas}.${frac}`;
}

/**
 * The stored value is digits. Grouping is display-only, so a blur cannot
 * hand the parent a comma that the agorot parser rejects.
 */
export function MoneyField({ label, value, onValueChange, error, id, disabled = false }: MoneyFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  const errorId = `${fieldId}-error`;
  const shown = grouped(value);
  return (
    <div className={error ? "ui-field ui-field-error" : "ui-field"}>
      <label className="ui-field-label" htmlFor={fieldId}>
        {label}
      </label>
      <span className="ui-money-field ui-field-control">
        <span className="ui-money-ltr" dir="ltr">
          <span className="ui-money-prefix" aria-hidden="true">
            ₪
          </span>
          <input
            id={fieldId}
            dir="ltr"
            inputMode="decimal"
            type="text"
            value={shown}
            disabled={disabled}
            size={Math.max(shown.length, 1)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => {
              onValueChange(digitsOnly(event.target.value));
            }}
          />
        </span>
      </span>
      {error ? (
        <span id={errorId} className="ui-field-message">
          {error}
        </span>
      ) : null}
    </div>
  );
}

type PercentFieldProps = {
  label: string;
  value: string;
  onValueChange: (raw: string) => void;
  /** The row already names the project. The label stays for the input. */
  hideLabel?: boolean;
};

/** A percent share. The stored value is digits, the same way MoneyField stores an amount. */
export function PercentField({ label, value, onValueChange, hideLabel = false }: PercentFieldProps) {
  const fieldId = useId();
  return (
    <div className="ui-field ui-percent-field">
      <label className={hideLabel ? "sr-only" : "ui-field-label"} htmlFor={fieldId}>
        {label}
      </label>
      <span className="ui-money-field ui-field-control ui-percent-control">
        <span className="ui-money-ltr" dir="ltr">
          <input
            id={fieldId}
            dir="ltr"
            inputMode="decimal"
            type="text"
            value={value}
            size={Math.max(value.length, 1)}
            onChange={(event) => {
              onValueChange(digitsOnly(event.target.value));
            }}
          />
          <span className="ui-money-prefix" aria-hidden="true">
            %
          </span>
        </span>
      </span>
    </div>
  );
}
