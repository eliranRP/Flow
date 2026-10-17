import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from "react";
import { cx } from "./cx";
import { flowControlName } from "./field-name";
import { holdFieldPointer } from "./field-pointer";

type TextFieldProps = {
  label: string;
  ref?: Ref<HTMLInputElement>;
  error?: string;
  /** Keeps the message line when there is no error, so the form does not jump. */
  reserveMessage?: boolean;
  /** Digits sit on the same edge as an amount. */
  numeric?: boolean;
  /** Under the field, in the message line, while there is no error (FLOW-139d). */
  hint?: ReactNode;
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
  readOnly = false,
  hint,
  onPointerDown,
  ...rest
}: TextFieldProps) {
  const generated = useId();
  const fieldId = flowControlName("flow-text", generated, id);
  const fieldName = flowControlName("flow-text", generated, typeof name === "string" ? name : fieldId);
  const errorId = `${fieldId}-error`;
  return (
    <div className={cx("ui-field", error && "ui-field-error", readOnly && "ui-field-readonly")}>
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
        readOnly={readOnly}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...rest}
        onPointerDown={(event) => {
          holdFieldPointer(event);
          onPointerDown?.(event);
        }}
      />
      {error || reserveMessage || hint ? (
        <span id={errorId} className={error ? "ui-field-message" : hint ? "ui-field-hint" : "ui-field-message ui-field-message-slot"}>
          {error ?? hint ?? ""}
        </span>
      ) : null}
    </div>
  );
}
