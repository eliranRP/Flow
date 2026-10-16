import { useId, type Ref } from "react";
import { flowControlName } from "./field-name";
import { holdFieldPointer } from "./field-pointer";
import { CloseIcon, SearchIcon } from "./icons";

type SearchFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  /** The transaction search moves focus here itself, after the title took it (FLOW-323). */
  inputRef?: Ref<HTMLInputElement>;
  maxLength?: number;
  /** Results are loading: a spinner sits at the end, the clear button hides, and the box is aria-busy. */
  busy?: boolean;
};

export function SearchField({
  label,
  value,
  onChange,
  placeholder = "למשל: הרצל",
  autoFocus = false,
  disabled = false,
  inputRef,
  maxLength,
  busy = false,
}: SearchFieldProps) {
  const generated = useId();
  const id = flowControlName("flow-search", generated);
  return (
    <div className="ui-search" aria-busy={busy || undefined}>
      <label className="ui-search-field" htmlFor={id} onPointerDown={holdFieldPointer}>
        <span className="ui-search-icon" aria-hidden="true">
          <SearchIcon size={18} stroke={1.8} />
        </span>
        <span className="sr-only">{label}</span>
        <input
          ref={inputRef}
          id={id}
          name={id}
          type="search"
          inputMode="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          value={value}
          placeholder={placeholder}
          autoFocus={autoFocus}
          disabled={disabled}
          maxLength={maxLength}
          onPointerDown={holdFieldPointer}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
        {busy ? <span className="ui-spinner ui-search-spinner" aria-hidden="true" /> : null}
      </label>
      {value !== "" && !disabled && !busy ? (
        <button
          type="button"
          className="ui-search-clear"
          aria-label="ניקוי"
          onClick={() => {
            onChange("");
          }}
        >
          <CloseIcon />
        </button>
      ) : null}
    </div>
  );
}
