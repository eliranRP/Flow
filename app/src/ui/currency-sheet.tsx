import { useEffect, useRef, type RefObject } from "react";
import { useSheetHistory } from "./back";
import { RadioRow } from "./radio-row";
import { Sheet } from "./sheet";

/** The currencies a company can keep its books in (decision 0147). */
export const CURRENCY_CHOICES = [
  { value: "ILS", label: "₪ שקל" },
  { value: "USD", label: "$ דולר" },
] as const;

export type CurrencyChoice = (typeof CURRENCY_CHOICES)[number]["value"];

export const CURRENCY_SHEET_NOTE =
  "המטבע הזה מוצג ראשון, ובו מתחילים פרויקטים והלוואות חדשים. הסכומים לא מומרים: תנועות במטבע אחר מוצגות בשורה משלהן.";

/** "₪ שקל" for a known currency, else the code itself. */
export function currencyChoiceLabel(currency: string): string {
  return CURRENCY_CHOICES.find((choice) => choice.value === currency)?.label ?? currency;
}

/**
 * The company currency sheet (FLOW-504): two radio rows that apply on tap, like the period sheet.
 * The tapped row spins while it saves and the other row waits; a close during the save waits too.
 */
export function CurrencySheet({
  open,
  onOpenChange,
  value,
  saving,
  onPick,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The stored currency. */
  value: string;
  /** The currency being written, or null. */
  saving: CurrencyChoice | null;
  /**
   * A tap on the current currency only closes the sheet. `close` closes it through the sheet's
   * history entry once the save has settled, so Back is not left on a dead step.
   */
  onPick: (currency: CurrencyChoice, close: () => void) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  // Set by `close`: the save has settled, so Back's popstate must not wait on a stale `saving`.
  const closing = useRef(false);
  useEffect(() => {
    if (open) closing.current = false;
  }, [open]);
  const setOpen = useSheetHistory("company-currency", open, onOpenChange, () => closing.current || saving == null);
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && saving != null) return;
        setOpen(next);
      }}
      title="מטבע העסק"
      returnFocusRef={returnFocusRef}
    >
      <div role="radiogroup" aria-label="מטבע העסק">
        {CURRENCY_CHOICES.map((choice) => (
          <RadioRow
            key={choice.value}
            label={choice.label}
            selected={saving == null && choice.value === value}
            busy={saving === choice.value}
            disabled={saving != null && saving !== choice.value}
            onSelect={() => {
              if (choice.value === value) {
                setOpen(false);
                return;
              }
              onPick(choice.value, () => {
                closing.current = true;
                setOpen(false);
              });
            }}
          />
        ))}
      </div>
      <p className="t-hint ui-pick-note">{CURRENCY_SHEET_NOTE}</p>
    </Sheet>
  );
}
