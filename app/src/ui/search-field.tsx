import { useId } from "react";
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
  const id = useId();
  return (
    <div className="ui-search">
      <SearchIcon />
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="search"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {value !== "" && !disabled ? (
        <button
          type="button"
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
