import { useId, type InputHTMLAttributes } from "react";
import { cx } from "./cx";
import { flowControlName } from "./field-name";
import { holdFieldPointer } from "./field-pointer";

type TextFieldProps = {
  label: string;
  error?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "className">;

export function TextField({
  label,
  error,
  id,
  name,
  autoComplete,
  autoCorrect,
  autoCapitalize,
  spellCheck,
  onPointerDown,
  ...rest
}: TextFieldProps) {
  const generated = useId();
  const fieldId = flowControlName("flow-text", generated, id);
  const fieldName = flowControlName("flow-text", generated, typeof name === "string" ? name : fieldId);
  const errorId = `${fieldId}-error`;
  return (
    <div className={cx("ui-field", error && "ui-field-error")}>
      <label className="ui-field-label" htmlFor={fieldId}>
        {label}
      </label>
      <input
        id={fieldId}
        name={fieldName}
        className="ui-field-control"
        autoComplete={autoComplete ?? "off"}
        autoCorrect={autoCorrect ?? "off"}
        autoCapitalize={autoCapitalize ?? "none"}
        spellCheck={spellCheck ?? false}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...rest}
        onPointerDown={(event) => {
          holdFieldPointer(event);
          onPointerDown?.(event);
        }}
      />
      {error ? (
        <span id={errorId} className="ui-field-message">
          {error}
        </span>
      ) : null}
    </div>
  );
}
