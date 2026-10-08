import { useId, type CSSProperties, type KeyboardEventHandler } from "react";
import { flowControlName } from "./field-name";
import { holdFieldMouse, holdFieldPointer } from "./field-pointer";

type MoneyFieldProps = {
  label: string;
  /** The row already names the part. The label stays for the input (FLOW-325). */
  hideLabel?: boolean;
  value: string;
  onValueChange: (raw: string) => void;
  error?: string;
  id?: string;
  disabled?: boolean;
  /** Defaults to ₪. A dollar loan passes $. */
  prefix?: string;
  /** A leading minus stays, so the form can show an error instead of dropping it. */
  keepMinus?: boolean;
  /** Keeps the message line when there is no error, so the form does not jump. */
  reserveMessage?: boolean;
  enterKeyHint?: "next" | "done";
  onBlur?: () => void;
  onFocus?: () => void;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
};

function digitsOnly(raw: string, keepMinus: boolean): string {
  const negative = keepMinus && raw.trim().startsWith("-");
  const cleaned = raw.replace(/[^\d.]/g, "");
  const [whole, frac] = cleaned.split(".");
  const body = frac == null ? (whole ?? "") : `${whole ?? ""}.${frac.slice(0, 2)}`;
  if (!negative) return body;
  return body === "" ? "-" : `-${body}`;
}

function grouped(raw: string): string {
  if (raw === "" || raw === "-") return raw;
  const negative = raw.startsWith("-");
  const body = negative ? raw.slice(1) : raw;
  const [whole, frac] = body.split(".");
  const withCommas = (whole ?? "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const shown = frac == null ? withCommas : `${withCommas}.${frac}`;
  return negative ? `-${shown}` : shown;
}

/**
 * The stored value is digits. Grouping is display-only, so a blur cannot
 * hand the parent a comma that the agorot parser rejects.
 */
export function MoneyField({
  label,
  hideLabel = false,
  value,
  onValueChange,
  error,
  id,
  disabled = false,
  prefix = "₪",
  keepMinus = false,
  reserveMessage = false,
  enterKeyHint = "next",
  onBlur,
  onFocus,
  onKeyDown,
}: MoneyFieldProps) {
  const generated = useId();
  const fieldId = flowControlName("flow-amount", generated, id);
  const errorId = `${fieldId}-error`;
  const shown = grouped(value);
  const shellStyle = { "--money-digits": `${String(shown.length)}ch` } as CSSProperties;
  return (
    <div className={error ? "ui-field ui-field-error" : "ui-field"}>
      <label className={hideLabel ? "sr-only" : "ui-field-label"} htmlFor={fieldId}>
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
          {prefix}
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
          enterKeyHint={enterKeyHint}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onPointerDown={holdFieldPointer}
          onFocus={onFocus}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          onChange={(event) => {
            onValueChange(digitsOnly(event.target.value, keepMinus));
          }}
        />
      </div>
      {error || reserveMessage ? (
        <span id={errorId} className={reserveMessage ? "ui-field-message ui-field-message-slot" : "ui-field-message"}>
          {error ?? ""}
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
  /** Split shares keep one decimal. A loan rate can keep four, so 11.2042 stays. */
  decimals?: number;
  /** A leading minus stays, so the form can show an error instead of dropping it. */
  keepMinus?: boolean;
  /** Keeps the message line when there is no error, so the form does not jump. */
  reserveMessage?: boolean;
  onBlur?: () => void;
};

/** "33.3" stays "33.3" at one decimal. Extra digits are dropped. */
function percentDigits(raw: string, places: number, keepMinus: boolean): string {
  const negative = keepMinus && raw.trim().startsWith("-");
  const cleaned = raw.replace(/[^\d.]/g, "");
  const [whole, frac] = cleaned.split(".");
  const body = frac == null ? (whole ?? "") : `${whole ?? ""}.${frac.slice(0, places)}`;
  if (!negative) return body;
  return body === "" ? "-" : `-${body}`;
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
  decimals = 1,
  keepMinus = false,
  reserveMessage = false,
  onBlur,
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
          onBlur={onBlur}
          onChange={(event) => {
            onValueChange(percentDigits(event.target.value, decimals, keepMinus));
          }}
        />
      </div>
      {error || reserveMessage ? (
        <span id={errorId} className={reserveMessage ? "ui-field-message ui-field-message-slot" : "ui-field-message"}>
          {error ?? ""}
        </span>
      ) : null}
    </div>
  );
}
