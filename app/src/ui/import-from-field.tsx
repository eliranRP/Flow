import { useState } from "react";
import { DateSheet } from "./date-sheet";
import { formatDisplay, israelToday } from "./date-math";
import { CalendarIcon } from "./icons";
import { SegmentedControl } from "./segmented-control";

type ImportMode = "start" | "date";

/** The date מתאריך starts on: the 1st of January this year (Israel time). */
export function importFromDefault(now = new Date()): string {
  return `${israelToday(now).slice(0, 4)}-01-01`;
}

/**
 * "ייבוא מ" in the connect sheets (FLOW-505 B): מההתחלה or מתאריך, with the day under it while
 * מתאריך is on. `value` null means from the start; otherwise YYYY-MM-DD, never in the future.
 */
export function ImportFromField({
  value,
  onChange,
  disabled = false,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}) {
  const [dateOpen, setDateOpen] = useState(false);
  // The last day picked comes back when מתאריך is chosen again.
  const [lastDate, setLastDate] = useState(value ?? importFromDefault());
  // A stored date that arrives or changes while the field stays mounted becomes the one to come back to.
  if (value != null && value !== lastDate) setLastDate(value);
  const mode: ImportMode = value == null ? "start" : "date";
  return (
    <>
      {/* FLOW-350: the control keeps the fields' reserved message line, so the rhythm stays even. */}
      <div className="ui-field">
        <SegmentedControl<ImportMode>
          label="ייבוא מ"
          value={mode}
          busy={disabled}
          options={[
            { value: "start", label: "מההתחלה" },
            { value: "date", label: "מתאריך" },
          ]}
          onChange={(next) => { onChange(next === "start" ? null : lastDate); }}
        />
        <span className="ui-field-message ui-field-message-slot" aria-hidden="true" />
      </div>
      {value == null ? null : (
        <div className="ui-field">
          <button
            type="button"
            className="ui-field-control ui-date-field"
            aria-label={`תאריך ייבוא: ${formatDisplay(value)}`}
            aria-haspopup="dialog"
            disabled={disabled}
            onClick={() => { setDateOpen(true); }}
          >
            <bdi className="ui-num" dir="ltr">{formatDisplay(value)}</bdi>
            <CalendarIcon size={20} />
          </button>
          {/* Same rhythm as the fields above it, which reserve their message line. */}
          <span className="ui-field-message ui-field-message-slot" aria-hidden="true" />
        </div>
      )}
      <DateSheet
        open={dateOpen}
        onOpenChange={setDateOpen}
        title="ייבוא מתאריך"
        value={value ?? lastDate}
        shortcuts={false}
        disabled={disabled}
        onApply={onChange}
      />
    </>
  );
}
