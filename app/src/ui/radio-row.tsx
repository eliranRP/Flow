import { useId, type ReactNode } from "react";

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
  /** Live result under the title. Split uses this. */
  description?: ReactNode;
  /** The radio sits on the start side. Split uses this; the period sheet keeps the end. */
  marker?: "start" | "end";
  disabled?: boolean;
  /** Replaces the description while the row cannot be chosen. */
  disabledReason?: string;
  /** The row is writing. The cursor is progress and the check stays. */
  busy?: boolean;
  selected: boolean;
  onSelect: () => void;
};

export function RadioRow({
  label,
  hint,
  code,
  date,
  tag,
  layout,
  description,
  marker = "end",
  disabled = false,
  disabledReason,
  busy = false,
  selected,
  onSelect,
}: RadioRowProps) {
  const picker = layout === "picker" || code != null || date != null || tag != null;
  const descId = useId();
  const off = disabled || disabledReason != null;
  const sub = off && disabledReason ? disabledReason : description;
  const radio = (
    <span className="ui-radio" data-on={selected ? "true" : "false"} aria-hidden="true">
      {selected ? "✓" : ""}
    </span>
  );
  const text = picker ? (
    <span className="ui-pick-name">
      <span className="ui-pick-label">{label}</span>
      {tag ? <span className="ui-suggest-tag">{tag}</span> : null}
    </span>
  ) : (
    <span className="ui-row-text">
      <span className="ui-row-title">{label}</span>
      {hint ? <span className="ui-row-hint">{hint}</span> : null}
      {sub ? <span className="ui-radio-desc" id={descId}>{sub}</span> : null}
    </span>
  );
  return (
    <button
      type="button"
      className={picker ? "ui-radio-row ui-pick-row" : marker === "start" ? "ui-radio-row ui-radio-start" : "ui-radio-row"}
      role="radio"
      aria-checked={selected}
      aria-disabled={off || busy || undefined}
      aria-busy={busy || undefined}
      aria-label={label}
      aria-describedby={sub ? descId : undefined}
      disabled={off || busy}
      onClick={() => {
        if (!off && !busy) onSelect();
      }}
    >
      {marker === "start" ? radio : null}
      {text}
      {code ? <bdi className="ui-pick-code" dir="ltr">{code}</bdi> : null}
      {date ? <span className="ui-pick-date">{date}</span> : null}
      {marker === "start" ? null : radio}
    </button>
  );
}
