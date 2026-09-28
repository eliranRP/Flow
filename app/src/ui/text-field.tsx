import { useId, type InputHTMLAttributes } from "react";
import { cx } from "./cx";

type TextFieldProps = {
  label: string;
  error?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "className">;

export function TextField({ label, error, id, ...rest }: TextFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  const errorId = `${fieldId}-error`;
  return (
    <div className={cx("ui-field", error && "ui-field-error")}>
      <label className="ui-field-label" htmlFor={fieldId}>
        {label}
      </label>
      <input
        id={fieldId}
        className="ui-field-control"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...rest}
      />
      {error ? (
        <span id={errorId} className="ui-field-message">
          {error}
        </span>
      ) : null}
    </div>
  );
}
