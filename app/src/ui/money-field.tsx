import { useId, type CSSProperties } from "react";
import { flowControlName } from "./field-name";
import { holdFieldMouse, holdFieldPointer } from "./field-pointer";

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
  const fieldId = flowControlName("flow-amount", generated, id);
  const errorId = `${fieldId}-error`;
  const shown = grouped(value);
  const shellStyle = { "--money-digits": `${shown.length}ch` } as CSSProperties;
  return (
    <div className={error ? "ui-field ui-field-error" : "ui-field"}>
      <label className="ui-field-label" htmlFor={fieldId}>
        {label}
      </label>
      <div
        className="ui-money-field ui-field-control"
        style={shellStyle}
        data-vaul-no-drag=""
        onPointerDown={holdFieldPointer}
        onMouseDown={holdFieldMouse}
      >
        <span className="ui-money-prefix" aria-hidden="true">
          ₪
        </span>
        <input
          id={fieldId}
          name={fieldId}
          dir="ltr"
          inputMode="decimal"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          type="text"
          value={shown}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onPointerDown={holdFieldPointer}
          onChange={(event) => {
            onValueChange(digitsOnly(event.target.value));
          }}
        />
      </div>
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
  /** Stable id. Callers pass split-pct-{projectId} so the field is not a contact. */
  id?: string;
  name?: string;
  error?: string;
  disabled?: boolean;
  /** The last row in a split uses "done". */
  enterKeyHint?: "next" | "done";
};

/** One decimal. "33.3" stays "33.3"; a second digit is dropped. */
function percentDigits(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, "");
  const [whole, frac] = cleaned.split(".");
  if (frac == null) return whole ?? "";
  return `${whole ?? ""}.${frac.slice(0, 1)}`;
}

/** A percent share. The suffix sits in the padding, so 100 never shares the digit box. */
export function PercentField({
  label,
  value,
  onValueChange,
  hideLabel = false,
  id,
  name,
  error,
  disabled = false,
  enterKeyHint = "next",
}: PercentFieldProps) {
  const generated = useId();
  const fieldId = id ?? flowControlName("split-pct", generated);
  const fieldName = name ?? fieldId;
  const errorId = `${fieldId}-error`;
  return (
    <div className={error ? "ui-field ui-field-error ui-percent-field" : "ui-field ui-percent-field"}>
      <label className={hideLabel ? "sr-only" : "ui-field-label"} htmlFor={fieldId}>
        {label}
      </label>
      <div
        className="ui-money-field ui-field-control ui-percent-control"
        data-vaul-no-drag=""
        onPointerDown={holdFieldPointer}
        onMouseDown={holdFieldMouse}
      >
        <span className="ui-percent-suffix" aria-hidden="true">
          %
        </span>
        <input
          id={fieldId}
          name={fieldName}
          dir="ltr"
          inputMode="decimal"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint={enterKeyHint}
          disabled={disabled}
          type="text"
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onPointerDown={holdFieldPointer}
          onFocus={(event) => {
            event.currentTarget.select();
          }}
          onChange={(event) => {
            onValueChange(percentDigits(event.target.value));
          }}
        />
      </div>
      {error ? (
        <span id={errorId} className="ui-field-message">
          {error}
        </span>
      ) : null}
    </div>
  );
}
