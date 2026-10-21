import { useState } from "react";
import { fromOptions, type FromChoice } from "../mercury-connections";
import { useSheetHistory } from "../ui/back";
import { Button } from "../ui/button";
import { DateSheet } from "../ui/date-sheet";
import { formatDisplay } from "../ui/date-math";
import { CalendarIcon } from "../ui/icons";
import { ListRow } from "../ui/list-row";
import { Sheet } from "../ui/sheet";

/**
 * מאיזה תאריך לייבא (FLOW-938, the board's SettingsMercuryFrom): radio rows for מההתחלה, מתחילת השנה,
 * מתחילת החודש and מתאריך (editing adds מהיום first, a new account's default). A tap applies and closes;
 * מתאריך opens the day under it with אישור.
 */
export function MercuryFromSheet({
  open,
  onOpenChange,
  editing,
  choice,
  date,
  onChoose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The edit list: the start of accounts checked now, with מהיום. */
  editing: boolean;
  choice: FromChoice;
  /** The day מתאריך holds (YYYY-MM-DD). */
  date: string;
  onChoose: (choice: FromChoice, date: string) => void;
}) {
  const setOpen = useSheetHistory("mercury-from", open, onOpenChange);
  const [dateOpen, setDateOpen] = useState(false);
  // מתאריך is picked in the sheet before אישור applies it.
  const [picking, setPicking] = useState<string | null>(null);
  const shown: FromChoice = picking != null ? "date" : choice;
  const day = picking ?? date;
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => { if (!next) setPicking(null); setOpen(next); }}
      title="מאיזה תאריך לייבא"
      subtitle={editing ? "לחשבונות שסימנתם עכשיו" : "לכל החשבונות שסימנתם"}
      panelClassName="ui-sheet-choice"
      action={shown === "date" ? (
        <Button full onClick={() => { onChoose("date", day); setPicking(null); setOpen(false); }}>אישור</Button>
      ) : undefined}
    >
      <div role="radiogroup" aria-label="מאיזה תאריך לייבא" className="ui-choice-sheet">
        {fromOptions(editing, day).map((option) => (
          <ListRow
            control="radio"
            key={option.value}
            title={option.label}
            description={option.note}
            value={option.value}
            selected={option.value === shown}
            onSelect={() => {
              if (option.value === "date") {
                setPicking(day);
                return;
              }
              setPicking(null);
              onChoose(option.value, date);
              setOpen(false);
            }}
          />
        ))}
      </div>
      {shown === "date" ? (
        <div className="ui-field">
          <button
            type="button"
            className="ui-field-control ui-date-field"
            aria-label={`מתאריך: ${formatDisplay(day)}`}
            aria-haspopup="dialog"
            onClick={() => { setDateOpen(true); }}
          >
            <bdi className="ui-num" dir="ltr">{formatDisplay(day)}</bdi>
            <CalendarIcon size={20} />
          </button>
        </div>
      ) : null}
      <p className="ui-settings-note">Mercury שומר עד 24 חודשים אחורה. אפשר להקדים את התאריך גם אחר כך; מה שכבר נכנס לא נכפל.</p>
      <DateSheet
        open={dateOpen}
        onOpenChange={setDateOpen}
        title="מתאריך"
        value={day}
        shortcuts={false}
        onApply={(next) => { setPicking(next); }}
      />
    </Sheet>
  );
}
