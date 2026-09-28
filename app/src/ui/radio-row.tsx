type RadioRowProps = {
  label: string;
  hint?: string;
  /** Project code, kept on one line. */
  code?: string;
  /** Relative last use, at the inline end. */
  date?: string;
  /** Tint after the name. The suggestion row uses "הצעה". */
  tag?: string;
  /** Name, code, and date on one line. The change picker uses this. */
  layout?: "picker";
  selected: boolean;
  onSelect: () => void;
};

export function RadioRow({ label, hint, code, date, tag, layout, selected, onSelect }: RadioRowProps) {
  const picker = layout === "picker" || code != null || date != null || tag != null;
  return (
    <button
      type="button"
      className={picker ? "ui-radio-row ui-pick-row" : "ui-radio-row"}
      role="radio"
      aria-checked={selected}
      aria-label={picker ? label : undefined}
      onClick={onSelect}
    >
      {picker ? (
        <span className="ui-pick-name">
          <span className="ui-pick-label">{label}</span>
          {tag ? <span className="ui-suggest-tag">{tag}</span> : null}
        </span>
      ) : (
        <span className="ui-row-text">
          <span className="ui-row-title">{label}</span>
          {hint ? <span className="ui-row-hint">{hint}</span> : null}
        </span>
      )}
      {code ? <bdi className="ui-pick-code" dir="ltr">{code}</bdi> : null}
      {date ? <span className="ui-pick-date">{date}</span> : null}
      <span className="ui-radio" data-on={selected ? "true" : "false"} aria-hidden="true">
        {selected ? "✓" : ""}
      </span>
    </button>
  );
}
