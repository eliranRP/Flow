import { useId, type InputHTMLAttributes } from "react";

type MoneyFieldProps = {
  label: string;
  error?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "inputMode" | "type">;

/** Whole or decimal shekels, before VAT. The ₪ sits before the digits. */
export function MoneyField({ label, error, id, ...rest }: MoneyFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  const errorId = `${fieldId}-error`;
  return (
    <div className={error ? "ui-field ui-field-error" : "ui-field"}>
      <label className="ui-field-label" htmlFor={fieldId}>
        {label}
      </label>
      <span className="ui-money-field ui-field-control">
        <span className="ui-money-prefix" aria-hidden="true">
          ₪
        </span>
        <input
          id={fieldId}
          dir="ltr"
          inputMode="decimal"
          type="text"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          {...rest}
        />
      </span>
      <span className="ui-field-label">לפני מע״מ</span>
      {error ? (
        <span id={errorId} className="ui-field-message">
          {error}
        </span>
      ) : null}
    </div>
  );
}
