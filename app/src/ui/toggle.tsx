import { useId, type ReactNode, type Ref } from "react";
import { useViewerNoteId } from "../use-is-viewer";
import { cx } from "./cx";

type ToggleProps = {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  /**
   * Something else decides the switch (FLOW-348 A): it looks disabled and ignores taps, but stays
   * focusable (`aria-disabled`), so focus moved to it after a retry does not fall to the page.
   */
  locked?: boolean;
  /** Stays focusable. The caller ignores a second change while this is set. */
  busy?: boolean;
  /** Draws the switch as a grouped list row, with the icon in the same slot as SUMIT. */
  icon?: ReactNode;
  /** The checkbox. A recovered Jev retry moves focus here. */
  inputRef?: Ref<HTMLInputElement>;
  /** The id of the line that says why the switch is disabled, when that is not the viewer note. */
  disabledNoteId?: string;
  onChange: (checked: boolean) => void;
};

/** A 44px row. The switch is off, on, or disabled with not-allowed. */
export function Toggle({ label, hint, checked, disabled = false, locked = false, busy = false, icon, inputRef, disabledNoteId, onChange }: ToggleProps) {
  const hintId = useId();
  const viewerNoteId = useViewerNoteId();
  const noteId = disabledNoteId ?? viewerNoteId;
  const describedIds = [hint != null ? hintId : null, disabled && noteId != null ? noteId : null].filter((id): id is string => id != null);
  const described = describedIds.length > 0 ? describedIds.join(" ") : undefined;
  const row = icon != null;
  return (
    <label className={cx(row ? "ui-row ui-switch-row" : "ui-switch-row")}>
      {row ? (
        <span className="ui-row-main">
          <span className="ui-row-icon">{icon}</span>
          <span className="ui-row-text">
            <span className="ui-row-title">{label}</span>
            {hint != null ? (
              <span id={hintId} className="ui-row-hint t-hint">{hint}</span>
            ) : null}
          </span>
        </span>
      ) : (
        <span className="ui-switch-copy">
          <span className="ui-switch-label" data-clip-ok="">{label}</span>
          {hint != null ? <span id={hintId} className="t-hint">{hint}</span> : null}
        </span>
      )}
      <input
        ref={inputRef}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-disabled={locked || undefined}
        aria-busy={busy || undefined}
        aria-label={label}
        aria-describedby={described}
        onChange={(event) => {
          if (disabled || locked || busy) return;
          onChange(event.target.checked);
        }}
      />
      <span className="ui-switch" aria-hidden="true">
        <i />
      </span>
    </label>
  );
}
