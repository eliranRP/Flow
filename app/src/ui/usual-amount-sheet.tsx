import { useEffect, useRef, useState, type RefObject } from "react";
import { parseAmountMinor } from "../add-entry";
import { currencyMark, draftOf, formatDraft } from "../project-next-edit";
import { Button } from "./button";
import { ForecastAmountField } from "./forecast-edit-parts";
import { Sheet } from "./sheet";

/**
 * Decision 0189: the charge page's usual-amount sheet. One amount field (the forecast edit page's), שמירה,
 * and "חזרה לחישוב" when the owner set the amount. The screen writes; this only draws and checks the field.
 */
export function UsualAmountSheet({
  open,
  onOpenChange,
  name,
  currency,
  income,
  usual,
  owner,
  busy,
  onSave,
  onReset,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  currency: string;
  income: boolean;
  /** The usual amount the page shows, unsigned minor units. */
  usual: bigint;
  /** The owner set it: the sheet offers "חזרה לחישוב". */
  owner: boolean;
  busy: boolean;
  onSave: (minor: number) => void;
  onReset: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const [draft, setDraft] = useState(() => draftOf(usual));
  const [missing, setMissing] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  // Each open starts from the amount the page shows.
  useEffect(() => {
    if (!open) return;
    setDraft(draftOf(usual));
    setMissing(false);
  }, [open, usual]);

  function save() {
    const minor = parseAmountMinor(draft);
    if (minor == null) {
      setMissing(true);
      field.current?.focus();
      return;
    }
    onSave(minor);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="הסכום הרגיל"
      hint={`כמה ${name} ${income ? "מכניס" : "עולה"} בדרך כלל. התחזית, ההתראות והשינויים ישוו אליו.`}
      busy={busy}
      returnFocusRef={returnFocusRef}
    >
      <ForecastAmountField
        value={draft}
        onChange={(text) => {
          setDraft(formatDraft(text));
          setMissing(false);
        }}
        mark={currencyMark(currency)}
        sign={income ? "+" : "−"}
        income={income}
        label="הסכום הרגיל"
        inputRef={field}
      />
      {missing ? <p className="ui-fe-error" role="alert">כתבו סכום</p> : null}
      <Button full busy={busy} onClick={save}>
        שמירה
      </Button>
      {owner ? (
        <Button variant="link" quiet full disabled={busy} onClick={onReset}>
          חזרה לחישוב
        </Button>
      ) : null}
    </Sheet>
  );
}
