import { useId, type InputHTMLAttributes } from "react";

type MoneyFieldProps = {
  label: string;
  error?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "inputMode" | "type">;

function grouped(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, "");
  if (cleaned === "") return "";
  const [whole, frac] = cleaned.split(".");
  const withCommas = (whole ?? "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac == null ? withCommas : `${withCommas}.${frac.slice(0, 2)}`;
}

/** Whole or decimal shekels, before VAT. The ₪ sits with the digits. */
export function MoneyField({ label, error, id, onBlur, onChange, ...rest }: MoneyFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  const errorId = `${fieldId}-error`;
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
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={onChange}
            onBlur={(event) => {
              const next = grouped(event.currentTarget.value);
              if (next !== event.currentTarget.value) {
                event.currentTarget.value = next;
                onChange?.(event);
              }
              onBlur?.(event);
            }}
            {...rest}
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
