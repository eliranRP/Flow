type RadioRowProps = {
  label: string;
  hint?: string;
  selected: boolean;
  onSelect: () => void;
};

export function RadioRow({ label, hint, selected, onSelect }: RadioRowProps) {
  return (
    <button type="button" className="ui-radio-row" role="radio" aria-checked={selected} onClick={onSelect}>
      <span className="ui-row-text">
        <span className="ui-row-title">{label}</span>
        {hint ? <span className="ui-row-hint">{hint}</span> : null}
      </span>
      <span className="ui-radio" data-on={selected ? "true" : "false"} aria-hidden="true">
        {selected ? "✓" : ""}
      </span>
    </button>
  );
}
