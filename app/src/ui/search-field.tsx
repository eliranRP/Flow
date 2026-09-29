import { useId } from "react";
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
};

export function SearchField({
  label,
  value,
  onChange,
  placeholder = "למשל: הרצל",
  autoFocus = false,
  disabled = false,
}: SearchFieldProps) {
  const generated = useId();
  const id = flowControlName("flow-search", generated);
  return (
    <div className="ui-search">
      <label className="ui-search-field" htmlFor={id} onPointerDown={holdFieldPointer}>
        <span className="ui-search-icon" aria-hidden="true">
          <SearchIcon />
        </span>
        <span className="sr-only">{label}</span>
        <input
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
          onPointerDown={holdFieldPointer}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      </label>
      {value !== "" && !disabled ? (
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
