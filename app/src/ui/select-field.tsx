import { useId, type SelectHTMLAttributes } from "react";

type Option = { value: string; label: string };

type SelectFieldProps = {
  label: string;
  options: Option[];
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, "className" | "children">;

export function SelectField({ label, options, id, ...rest }: SelectFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <div className="ui-field">
      <label className="ui-field-label" htmlFor={fieldId}>
        {label}
      </label>
      <select id={fieldId} className="ui-field-control" {...rest}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
