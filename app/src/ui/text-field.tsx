import { useId, type InputHTMLAttributes } from "react";
import { cx } from "./cx";
import { flowControlName } from "./field-name";
import { holdFieldPointer } from "./field-pointer";

type TextFieldProps = {
  label: string;
  error?: string;
  /** Keeps the message line when there is no error, so the form does not jump. */
  reserveMessage?: boolean;
  /** Digits sit on the same edge as an amount. */
  numeric?: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "className">;

export function TextField({
  label,
  error,
  reserveMessage = false,
  id,
  name,
  autoComplete,
  autoCorrect,
  autoCapitalize,
  spellCheck,
  numeric = false,
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
        className={numeric ? "ui-field-control ui-num-field" : "ui-field-control"}
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
      {error || reserveMessage ? (
        <span id={errorId} className={reserveMessage ? "ui-field-message ui-field-message-slot" : "ui-field-message"}>
          {error ?? ""}
        </span>
      ) : null}
    </div>
  );
}
