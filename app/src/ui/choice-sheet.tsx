import { useEffect, useRef, type RefObject } from "react";
import { useSheetHistory } from "./back";
import { RadioRow } from "./radio-row";
import { Sheet } from "./sheet";

/** A choice sheet's own words: its history entry, title, the note under the rows (if any), and the rows. */
export type ChoiceSheetCopy<T extends string> = {
  historyKey: string;
  title: string;
  /** Under the title, in its column (the board's "רק בטלפון הזה"). */
  subtitle?: string;
  note?: string;
  choices: ReadonlyArray<{ value: T; label: string; description?: string }>;
};

export type ChoiceSheetProps<T extends string, V extends string = T> = {
  copy: ChoiceSheetCopy<T>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The stored choice. */
  value: V;
  /** The choice being written, or null. */
  saving: T | null;
  /**
   * A tap on the current choice only closes the sheet. `close` closes it through the sheet's
   * history entry once the save has settled, so Back is not left on a dead step.
   */
  onPick: (choice: T, close: () => void) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

/**
 * A sheet of radio rows that apply on tap (FLOW-103, FLOW-504, FLOW-415). The tapped row spins
 * while it saves and the other rows wait. A close during the save waits for it: the sheet is busy.
 */
export function ChoiceSheet<T extends string, V extends string = T>({
  copy,
  open,
  onOpenChange,
  value,
  saving,
  onPick,
  returnFocusRef,
}: ChoiceSheetProps<T, V>) {
  // Set by `close`: the save has settled, so Back's popstate must not wait on a stale `saving`.
  const closing = useRef(false);
  /** The sheet's own close: a success close and a dismiss both go through it, so the save's wait applies. */
  const requestSheetClose = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (open) closing.current = false;
  }, [open]);
  const stored: string = value;
  const setOpen = useSheetHistory(copy.historyKey, open, onOpenChange, () => closing.current || saving == null);
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={copy.title}
      subtitle={copy.subtitle}
      returnFocusRef={returnFocusRef}
      busy={saving != null}
      onRequestClose={requestSheetClose}
    >
      <div role="radiogroup" aria-label={copy.title} className="ui-choice-sheet">
        {copy.choices.map((choice) => (
          <RadioRow
            key={choice.value}
            label={choice.label}
            description={choice.description}
            value={choice.value}
            selected={saving == null && choice.value === stored}
            busy={saving === choice.value}
            disabled={saving != null && saving !== choice.value}
            onSelect={() => {
              if (choice.value === stored) {
                setOpen(false);
                return;
              }
              onPick(choice.value, () => {
                closing.current = true;
                requestSheetClose.current?.();
              });
            }}
          />
        ))}
      </div>
      {copy.note ? <p className="t-hint ui-pick-note">{copy.note}</p> : null}
    </Sheet>
  );
}
